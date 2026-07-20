import { AsyncLocalStorage } from "node:async_hooks";
import type { ActorContext, StickyScope } from "@sticky/contracts";
import { destructiveConfirmationSchema, recurrenceScheduleSchema, stickyColorSchema, updateWorkspacePreferencesSchema } from "@sticky/contracts";
import { requireDestructiveConfirmation, requireScope, resolveReminderTime, StickyDomainError, zonedDateKeyAt } from "@sticky/domain";
import { createMcpHonoApp } from "@modelcontextprotocol/hono";
import { McpServer, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { start } from "workflow/api";
import { z } from "zod";
import { idempotent } from "./idempotency";
import { authenticateRequest, getRuntime } from "./runtime";
import {
  createGoogleCalendarEvent,
  createGoogleTask,
  createGoogleTaskList,
  deleteGoogleCalendarEvent,
  deleteGoogleTask,
  deleteGoogleTaskList,
  listGoogleCalendarEvents,
  listGoogleCalendars,
  listGoogleTaskLists,
  listGoogleTasks,
  updateGoogleCalendarEvent,
  updateGoogleTask,
  updateGoogleTaskList,
} from "./services/google";
import { executeGoogleTaskTransfer, previewGoogleTaskTransfer } from "./services/google-task-transfer";
import { dailyAgendaSettingsSchema, getDailyAgendaSettings, sendDailyAgendaTest, updateDailyAgendaSettings } from "./services/daily-agenda-settings";
import { outboxWorkflow } from "./workflows/outbox";
import { reminderWorkflow } from "./workflows/reminder";

const actorStorage = new AsyncLocalStorage<ActorContext>();

function actor(): ActorContext {
  const value = actorStorage.getStore();
  if (!value) throw new StickyDomainError("unauthorized", "MCP request context is missing.", 401);
  return value;
}

function result(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value as Record<string, unknown>,
  };
}

function nextDate(date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

export function moveListId(
  listIds: string[],
  listId: string,
  relativeToListId: string,
  position: "before" | "after",
): string[] {
  if (listId === relativeToListId) {
    throw new StickyDomainError("validation_error", "Choose two different Sticky lists.", 422);
  }
  if (!listIds.includes(listId) || !listIds.includes(relativeToListId)) {
    throw new StickyDomainError("not_found", "One of those Sticky lists was not found on the active board.", 404);
  }

  const reordered = listIds.filter((id) => id !== listId);
  const targetIndex = reordered.indexOf(relativeToListId);
  reordered.splice(targetIndex + (position === "after" ? 1 : 0), 0, listId);
  return reordered;
}

export function moveSubtaskId(
  subtaskIds: string[],
  subtaskId: string,
  relativeToSubtaskId: string,
  position: "before" | "after",
): string[] {
  if (subtaskId === relativeToSubtaskId) {
    throw new StickyDomainError("validation_error", "Choose two different Sticky subtasks.", 422);
  }
  if (!subtaskIds.includes(subtaskId) || !subtaskIds.includes(relativeToSubtaskId)) {
    throw new StickyDomainError("not_found", "One of those Sticky subtasks was not found under the parent task.", 404);
  }

  const reordered = subtaskIds.filter((id) => id !== subtaskId);
  const targetIndex = reordered.indexOf(relativeToSubtaskId);
  reordered.splice(targetIndex + (position === "after" ? 1 : 0), 0, subtaskId);
  return reordered;
}

export function moveTaskId(
  taskIds: string[],
  taskId: string,
  relativeToTaskId: string,
  position: "before" | "after",
): string[] {
  if (taskId === relativeToTaskId) {
    throw new StickyDomainError("validation_error", "Choose two different Sticky tasks.", 422);
  }
  if (!taskIds.includes(taskId) || !taskIds.includes(relativeToTaskId)) {
    throw new StickyDomainError("not_found", "One of those active Sticky tasks was not found in the list.", 404);
  }
  const reordered = taskIds.filter((id) => id !== taskId);
  const targetIndex = reordered.indexOf(relativeToTaskId);
  reordered.splice(targetIndex + (position === "after" ? 1 : 0), 0, taskId);
  return reordered;
}

function zonedMidnight(date: string, timeZone: string) {
  const target = Date.parse(`${date}T00:00:00Z`);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  let instant = target;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const values = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
    const renderedAsUtc = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      Number(values.second),
    );
    instant += target - renderedAsUtc;
  }
  return new Date(instant).toISOString();
}

async function mutationResult<T>(tool: string, input: unknown, operation: (current: ActorContext) => Promise<T>, scope: StickyScope = "tasks:write") {
  const current = actor();
  requireScope(current, scope);
  console.info("Sticky MCP mutation started", { tool, actorId: current.actorId, requestId: current.requestId });
  try {
    const execution = await idempotent(current, `mcp:${tool}`, input, () => operation(current));
    if (!execution.replayed && process.env.WORKFLOW_ENABLED !== "false") {
      await start(outboxWorkflow, [current.userId]);
    }
    console.info("Sticky MCP mutation completed", { tool, actorId: current.actorId, requestId: current.requestId, replayed: execution.replayed });
    return result(execution.value);
  } catch (error) {
    console.error("Sticky MCP mutation failed", {
      tool,
      actorId: current.actorId,
      requestId: current.requestId,
      error: error instanceof Error ? error.message : String(error),
      details: error instanceof StickyDomainError ? error.details : undefined,
    });
    throw error;
  }
}

async function externalMutationResult<T>(tool: string, input: unknown, operation: (current: ActorContext) => Promise<T>, scope: StickyScope) {
  const current = actor();
  requireScope(current, scope);
  console.info("Sticky MCP external mutation started", { tool, actorId: current.actorId, requestId: current.requestId });
  try {
    const execution = await idempotent(current, `mcp:${tool}`, input, () => operation(current));
    console.info("Sticky MCP external mutation completed", { tool, actorId: current.actorId, requestId: current.requestId, replayed: execution.replayed });
    return result(execution.value);
  } catch (error) {
    console.error("Sticky MCP external mutation failed", {
      tool,
      actorId: current.actorId,
      requestId: current.requestId,
      error: error instanceof Error ? error.message : String(error),
      details: error instanceof StickyDomainError ? error.details : undefined,
    });
    throw error;
  }
}

async function scheduleReminderWorkflow(reminder: { id: string; remindAt: string }) {
  if (process.env.WORKFLOW_ENABLED === "false") return null;
  const run = await start(reminderWorkflow, [reminder.id, reminder.remindAt]);
  await getRuntime().db.from("task_reminders").update({ workflow_run_id: run.runId }).eq("id", reminder.id);
  return run.runId;
}

function registerTools(server: McpServer, options: { includeDirectGoogle: boolean }) {
  const id = z.uuid();
  const version = z.int().positive();
  const destructive = z.object({ confirmed: z.literal(true), summary: z.string().min(5).max(240) });
  const googleCalendarEventInput = z.discriminatedUnion("allDay", [
    z.object({ calendarId: z.string().min(1).max(1_000), title: z.string().trim().min(1).max(1_000), details: z.string().max(20_000).default(""), location: z.string().max(500).default(""), timezone: z.string().default("America/Chicago"), attendeeEmails: z.array(z.email()).max(200).optional(), recurrence: z.array(z.string().trim().min(1).max(2_000)).max(100).optional(), transparency: z.enum(["opaque", "transparent"]).optional(), sendUpdates: z.enum(["all", "externalOnly", "none"]).default("none"), allDay: z.literal(false), startAt: z.iso.datetime({ offset: true }), endAt: z.iso.datetime({ offset: true }) }),
    z.object({ calendarId: z.string().min(1).max(1_000), title: z.string().trim().min(1).max(1_000), details: z.string().max(20_000).default(""), location: z.string().max(500).default(""), timezone: z.string().default("America/Chicago"), attendeeEmails: z.array(z.email()).max(200).optional(), recurrence: z.array(z.string().trim().min(1).max(2_000)).max(100).optional(), transparency: z.enum(["opaque", "transparent"]).optional(), sendUpdates: z.enum(["all", "externalOnly", "none"]).default("none"), allDay: z.literal(true), startDate: z.iso.date(), endDate: z.iso.date() }),
  ]);
  const googleCalendarEventUpdateInput = z.discriminatedUnion("allDay", [
    z.object({ calendarId: z.string().min(1).max(1_000), eventId: z.string().min(1).max(1_000), title: z.string().trim().min(1).max(1_000), details: z.string().max(20_000).default(""), location: z.string().max(500).default(""), timezone: z.string().default("America/Chicago"), attendeeEmails: z.array(z.email()).max(200).optional(), recurrence: z.array(z.string().trim().min(1).max(2_000)).max(100).optional(), transparency: z.enum(["opaque", "transparent"]).optional(), sendUpdates: z.enum(["all", "externalOnly", "none"]).default("none"), allDay: z.literal(false), startAt: z.iso.datetime({ offset: true }), endAt: z.iso.datetime({ offset: true }) }),
    z.object({ calendarId: z.string().min(1).max(1_000), eventId: z.string().min(1).max(1_000), title: z.string().trim().min(1).max(1_000), details: z.string().max(20_000).default(""), location: z.string().max(500).default(""), timezone: z.string().default("America/Chicago"), attendeeEmails: z.array(z.email()).max(200).optional(), recurrence: z.array(z.string().trim().min(1).max(2_000)).max(100).optional(), transparency: z.enum(["opaque", "transparent"]).optional(), sendUpdates: z.enum(["all", "externalOnly", "none"]).default("none"), allDay: z.literal(true), startDate: z.iso.date(), endDate: z.iso.date() }),
  ]);

  server.registerTool("list_lists", { description: "List the user's active or archived Sticky lists.", inputSchema: z.object({ includeArchived: z.boolean().default(false) }), annotations: { readOnlyHint: true } },
    async ({ includeArchived }) => { const current = actor(); requireScope(current, "tasks:read"); return result({ lists: await getRuntime().repository.listLists(current, includeArchived) }); });

  server.registerTool("list_tasks", { description: "List Sticky tasks, optionally within one list.", inputSchema: z.object({ listId: id.optional(), includeCompleted: z.boolean().default(false) }), annotations: { readOnlyHint: true } },
    async (input) => { const current = actor(); requireScope(current, "tasks:read"); return result({ tasks: await getRuntime().repository.listTasks(current, input) }); });

  server.registerTool("search_tasks", { description: "Search task titles and details across Sticky.", inputSchema: z.object({ query: z.string().trim().min(1).max(180), includeCompleted: z.boolean().default(true) }), annotations: { readOnlyHint: true } },
    async (input) => { const current = actor(); requireScope(current, "tasks:read"); return result({ tasks: await getRuntime().repository.listTasks(current, input) }); });

  server.registerTool("get_task", { description: "Get one Sticky task by id.", inputSchema: z.object({ taskId: id }), annotations: { readOnlyHint: true } },
    async ({ taskId }) => { const current = actor(); requireScope(current, "tasks:read"); return result({ task: await getRuntime().repository.getTask(current, taskId) }); });

  server.registerTool("get_workspace_snapshot", { description: "Read the complete current Sticky workspace in one call: lists, active and completed tasks, subtasks, recurrence rules, reminders, calendars, workspace preferences, and daily-agenda settings. Use this before a compound request that changes several kinds of Sticky data.", inputSchema: z.object({ includeArchivedLists: z.boolean().default(true) }), annotations: { readOnlyHint: true } },
    async ({ includeArchivedLists }) => {
      const current = actor();
      requireScope(current, "tasks:read"); requireScope(current, "calendar:read");
      const [lists, tasks, subtasks, recurrences, reminders, calendars, preferences, dailyAgenda] = await Promise.all([
        getRuntime().repository.listLists(current, includeArchivedLists),
        getRuntime().repository.listTasks(current, { includeCompleted: true }),
        getRuntime().repository.listSubtasks(current, undefined, true),
        getRuntime().repository.listTaskRecurrenceRules(current),
        getRuntime().repository.listReminders(current),
        getRuntime().repository.listCalendars(current, true),
        getRuntime().repository.getWorkspacePreferences(current),
        getDailyAgendaSettings(current.userId),
      ]);
      return result({ lists, tasks, subtasks, recurrences, reminders, calendars, preferences, dailyAgenda });
    });

  server.registerTool("list_task_recurrences", { description: "List Sticky task recurrence rules. A rule is attached to the current active occurrence and is separate from reminders. Optionally filter by one task id.", inputSchema: z.object({ taskId: id.optional() }), annotations: { readOnlyHint: true } },
    async ({ taskId }) => { const current = actor(); requireScope(current, "tasks:read"); return result({ recurrences: await getRuntime().repository.listTaskRecurrenceRules(current, taskId) }); });

  server.registerTool("list_subtasks", { description: "List the real Sticky subtasks under one task, including each subtask's own due date, completion state, order, and version. Use this before changing, completing, moving, or deleting a subtask. These are Sticky subtasks, never Google Tasks.", inputSchema: z.object({ taskId: id, includeCompleted: z.boolean().default(true) }), annotations: { readOnlyHint: true } },
    async ({ taskId, includeCompleted }) => { const current = actor(); requireScope(current, "tasks:read"); return result({ subtasks: await getRuntime().repository.listSubtasks(current, taskId, includeCompleted) }); });

  server.registerTool("get_subtask", { description: "Get one Sticky subtask by id, including its parent task id, due date, completion state, order, and version.", inputSchema: z.object({ subtaskId: id }), annotations: { readOnlyHint: true } },
    async ({ subtaskId }) => { const current = actor(); requireScope(current, "tasks:read"); return result({ subtask: await getRuntime().repository.getSubtask(current, subtaskId) }); });

  server.registerTool("list_reminders", { description: "List Sticky task reminders, optionally for one task. Recurrence and reminders are separate features.", inputSchema: z.object({ taskId: id.optional() }), annotations: { readOnlyHint: true } },
    async ({ taskId }) => { const current = actor(); requireScope(current, "tasks:read"); return result({ reminders: await getRuntime().repository.listReminders(current, taskId) }); });

  server.registerTool("get_workspace_preferences", { description: "Read the user's persisted Sticky workspace preferences, including completed-pile state, density, theme, board style, task filter, and task sorting.", inputSchema: z.object({}), annotations: { readOnlyHint: true } },
    async () => { const current = actor(); requireScope(current, "tasks:read"); return result({ preferences: await getRuntime().repository.getWorkspacePreferences(current) }); });

  server.registerTool("get_daily_agenda_settings", { description: "Read whether Sticky's daily Poke agenda is enabled, its delivery time and timezone, delivery readiness, and last send state.", inputSchema: z.object({}), annotations: { readOnlyHint: true } },
    async () => { const current = actor(); requireScope(current, "tasks:read"); return result({ settings: await getDailyAgendaSettings(current.userId) }); });

  server.registerTool("get_agenda", { description: "Get incomplete tasks due in an inclusive date range.", inputSchema: z.object({ from: z.iso.date(), to: z.iso.date() }), annotations: { readOnlyHint: true } },
    async ({ from, to }) => { const current = actor(); requireScope(current, "tasks:read"); const tasks = await getRuntime().repository.listTasks(current); return result({ tasks: tasks.filter((task) => task.dueDate && task.dueDate >= from && task.dueDate <= to) }); });

  server.registerTool("list_calendars", { description: "List the user's Sticky calendars and identify the default calendar.", inputSchema: z.object({ includeArchived: z.boolean().default(false) }), annotations: { readOnlyHint: true } },
    async ({ includeArchived }) => { const current = actor(); requireScope(current, "calendar:read"); return result({ calendars: await getRuntime().repository.listCalendars(current, includeArchived) }); });

  server.registerTool("list_calendar_events", { description: "List real Sticky calendar events that overlap a time range. These are time commitments, distinct from task due dates.", inputSchema: z.object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) }), annotations: { readOnlyHint: true } },
    async (range) => { const current = actor(); requireScope(current, "calendar:read"); return result({ events: await getRuntime().repository.listCalendarEvents(current, range) }); });

  server.registerTool("get_calendar_event", { description: "Get one Sticky calendar event by id, including its current record version.", inputSchema: z.object({ eventId: id }), annotations: { readOnlyHint: true } },
    async ({ eventId }) => { const current = actor(); requireScope(current, "calendar:read"); return result({ event: await getRuntime().repository.getCalendarEvent(current, eventId) }); });

  server.registerTool("get_daily_plan", { description: "Read one day of Sticky due tasks and calendar events together before planning or changing the day.", inputSchema: z.object({ date: z.iso.date(), timezone: z.string().refine((value) => { try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return true; } catch { return false; } }, "Use a valid IANA timezone.").default("America/Chicago") }), annotations: { readOnlyHint: true } },
    async ({ date, timezone }) => {
      const current = actor();
      requireScope(current, "tasks:read"); requireScope(current, "calendar:read");
      const from = zonedMidnight(date, timezone);
      const to = zonedMidnight(nextDate(date), timezone);
      const [tasks, events] = await Promise.all([
        getRuntime().repository.listTasks(current),
        getRuntime().repository.listCalendarEvents(current, { from, to }),
      ]);
      return result({ date, timezone, tasks: tasks.filter((task) => task.dueDate === date), events });
    });

  if (options.includeDirectGoogle) {
    server.registerTool("list_google_task_lists", { description: "List the user's live Google Tasks lists. Google data stays separate from Sticky and is never imported by this tool.", inputSchema: z.object({}), annotations: { readOnlyHint: true } },
      async () => { const current = actor(); requireScope(current, "tasks:read"); return result({ lists: await listGoogleTaskLists(current), source: "google_tasks" }); });

    server.registerTool("list_google_tasks", { description: "List tasks directly from one Google Tasks list without copying them into Sticky.", inputSchema: z.object({ taskListId: z.string().min(1).max(1_000), includeCompleted: z.boolean().default(false), includeHidden: z.boolean().default(false) }), annotations: { readOnlyHint: true } },
      async (input) => { const current = actor(); requireScope(current, "tasks:read"); return result({ tasks: await listGoogleTasks(current, input), source: "google_tasks" }); });

    server.registerTool("list_google_calendars", { description: "List the user's live Google calendars without copying them into Sticky Calendar.", inputSchema: z.object({}), annotations: { readOnlyHint: true } },
      async () => { const current = actor(); requireScope(current, "calendar:read"); return result({ calendars: await listGoogleCalendars(current), source: "google_calendar" }); });

    server.registerTool("list_google_calendar_events", { description: "List live Google Calendar events in a time range. This reads Google directly and does not create Sticky Calendar events.", inputSchema: z.object({ calendarId: z.string().min(1).max(1_000), from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }), query: z.string().trim().max(500).optional() }), annotations: { readOnlyHint: true } },
      async (input) => { const current = actor(); requireScope(current, "calendar:read"); return result({ events: await listGoogleCalendarEvents(current, input), source: "google_calendar" }); });
  }

  server.registerTool("preview_google_tasks_to_sticky", {
    description: "Preview one specific Google Tasks list -> one Sticky list transfer. This reads both sides, copies nothing, and returns the exact confirmation needed for the separate copy or move tool. Never use it for routine Google work or automatic sync.",
    inputSchema: z.object({
      googleTaskList: z.string().trim().min(1).max(1_000).describe("Exact Google Tasks list name or id."),
      stickyList: z.string().trim().min(1).max(80).describe("Exact Sticky list name or id."),
      mode: z.enum(["copy", "move"]).default("copy"),
      includeCompleted: z.boolean().default(false),
      includeHidden: z.boolean().default(false),
    }),
    annotations: { readOnlyHint: true },
  }, async (input) => {
    const current = actor();
    requireScope(current, "tasks:read");
    return result(await previewGoogleTaskTransfer(current, input));
  });

  const confirmedTransfer = z.object({
    googleTaskListId: z.string().trim().min(1).max(1_000),
    stickyListId: id,
    includeCompleted: z.boolean().default(false),
    includeHidden: z.boolean().default(false),
    expectedTaskCount: z.int().min(1).max(500),
    sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    acknowledgedSeparateSystems: z.literal(true),
    confirmedAfterPreview: z.literal(true),
    confirmationPhrase: z.string().trim().min(10).max(240),
  });

  server.registerTool("copy_google_tasks_to_sticky", {
    description: "After preview_google_tasks_to_sticky and a new explicit user confirmation, copy that exact Google list snapshot into the chosen Sticky list once. Repeats are deduplicated. Google originals remain and no sync is enabled.",
    inputSchema: confirmedTransfer,
  }, async (input) => mutationResult("copy_google_tasks_to_sticky", input, async (current) => executeGoogleTaskTransfer(current, { ...input, mode: "copy" })));

  server.registerTool("move_google_tasks_to_sticky", {
    description: "After preview_google_tasks_to_sticky and explicit user approval to delete the Google originals, copy and verify every task in Sticky first, then delete the originals from Google. No sync is enabled.",
    inputSchema: confirmedTransfer.extend({ confirmedDeleteGoogleOriginals: z.literal(true) }),
    annotations: { destructiveHint: true },
  }, async (input) => {
    const current = actor();
    requireScope(current, "tasks:destructive");
    return mutationResult("move_google_tasks_to_sticky", input, async () => executeGoogleTaskTransfer(current, { ...input, mode: "move" }));
  });

  server.registerTool("create_list", { description: "Create a Sticky list.", inputSchema: z.object({ name: z.string().trim().min(1).max(80), color: stickyColorSchema.default("sun") }) },
    async (input) => mutationResult("create_list", input, async (current) => ({ list: await getRuntime().repository.createList(current, input) })));

  server.registerTool("update_list", { description: "Rename a Sticky list, change its color, show or hide it on the board, archive it, or restore it. The record version is optional; when omitted, Sticky safely reads the current version.", inputSchema: z.object({ listId: id, version: version.optional(), name: z.string().trim().min(1).max(80).optional(), color: stickyColorSchema.optional(), isVisibleOnBoard: z.boolean().optional(), archived: z.boolean().optional() }).refine((input) => [input.name, input.color, input.isVisibleOnBoard, input.archived].some((value) => value !== undefined), { message: "At least one list field must change." }) },
    async (input) => mutationResult("update_list", input, async (current) => {
      const existing = await getRuntime().repository.getList(current, input.listId);
      const { listId, ...patch } = input;
      return { list: await getRuntime().repository.updateList(current, listId, { ...patch, version: input.version ?? existing.version }) };
    }));

  server.registerTool("restore_list", { description: "Restore one archived Sticky list to the active board. The record version is optional.", inputSchema: z.object({ listId: id, version: version.optional() }) },
    async (input) => mutationResult("restore_list", input, async (current) => {
      const existing = await getRuntime().repository.getList(current, input.listId);
      return { list: await getRuntime().repository.updateList(current, input.listId, { version: input.version ?? existing.version, archived: false }) };
    }));

  server.registerTool("move_list", {
    description: "Move one active Sticky list immediately before or after another active Sticky list. Use position=before for requests such as move Jobs to the left of Internships. This changes Sticky only and never reorders Google Tasks lists.",
    inputSchema: z.object({
      listId: id.describe("Sticky list to move. Resolve it with list_lists first."),
      relativeToListId: id.describe("Sticky list that the moved list should sit beside."),
      position: z.enum(["before", "after"]).describe("before means immediately left; after means immediately right."),
    }),
  }, async (input) => mutationResult("move_list", input, async (current) => {
    const lists = await getRuntime().repository.listLists(current);
    const listIds = moveListId(lists.map((list) => list.id), input.listId, input.relativeToListId, input.position);
    return { lists: await getRuntime().repository.reorderLists(current, listIds) };
  }));

  server.registerTool("reorder_lists", {
    description: "Set the complete left-to-right order of all active Sticky lists. Pass every active list id exactly once in the desired order. This changes Sticky only and never reorders Google Tasks lists.",
    inputSchema: z.object({
      listIds: z.array(id).min(1).max(200).describe("Every active Sticky list id, in exact left-to-right order. Read list_lists first."),
    }),
  }, async (input) => mutationResult("reorder_lists", input, async (current) => ({
    lists: await getRuntime().repository.reorderLists(current, input.listIds),
  })));

  server.registerTool("create_task", { description: "Create a Sticky task and either all of its Sticky subtasks or its recurrence in the same call. For a repeating task, set recurrence and make startsOn the first due date; dueTime is the local occurrence time. Use daysOfWeek 0=Sunday through 6=Saturday. Never substitute a reminder for recurrence. Repeating tasks cannot have subtasks. When color is omitted, Sticky uses the target list's color.", inputSchema: z.object({ listId: id, title: z.string().trim().min(1).max(180), details: z.string().max(20_000).default(""), color: stickyColorSchema.optional(), dueDate: z.iso.date().nullable().default(null), dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/).nullable().default(null), timezone: z.string().default("America/Chicago"), subtasks: z.array(z.object({ title: z.string().trim().min(1).max(160), dueDate: z.iso.date().nullable().default(null) })).max(100).default([]), recurrence: recurrenceScheduleSchema.nullable().default(null) }).superRefine((input, context) => {
    if (input.recurrence && input.subtasks.length > 0) context.addIssue({ code: "custom", path: ["subtasks"], message: "A repeating Sticky task cannot have subtasks." });
  }) },
    async (input) => mutationResult("create_task", input, async (current) => {
      const list = await getRuntime().repository.getList(current, input.listId);
      const taskInput = {
        ...input,
        dueDate: input.recurrence?.startsOn ?? input.dueDate,
        timezone: input.recurrence?.timezone ?? input.timezone,
        color: input.color ?? list.color,
      };
      if (input.subtasks.length) return getRuntime().repository.createTaskWithSubtasks(current, taskInput);
      const task = await getRuntime().repository.createTask(current, taskInput);
      if (!input.recurrence) return { task, subtasks: [], recurrence: null };
      try {
        const recurrence = await getRuntime().repository.setTaskRecurrence(current, task.id, input.recurrence, input.dueTime);
        return { task: await getRuntime().repository.getTask(current, task.id), subtasks: [], recurrence };
      } catch (error) {
        try {
          await getRuntime().repository.deleteTask(current, task.id);
        } catch (cleanupError) {
          console.error("Sticky could not clean up a task after recurrence creation failed", {
            taskId: task.id,
            cleanupError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          });
        }
        throw error;
      }
    }));

  server.registerTool("set_task_recurrence", { description: "Create or replace the recurrence on an existing active Sticky task. This schedules its first occurrence on schedule.startsOn, preserves its current due time unless dueTime is supplied, and supports daily, weekly, monthly, yearly, or custom repetition. Use daysOfWeek 0=Sunday through 6=Saturday. This is recurrence, not a reminder; recurring tasks cannot have subtasks.", inputSchema: z.object({ taskId: id, schedule: recurrenceScheduleSchema, dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/).nullable().optional() }) },
    async ({ taskId, schedule, dueTime }) => mutationResult("set_task_recurrence", { taskId, schedule, dueTime }, async (current) => ({
      recurrence: await getRuntime().repository.setTaskRecurrence(current, taskId, schedule, dueTime),
      task: await getRuntime().repository.getTask(current, taskId),
    })));

  server.registerTool("set_task_recurrence_paused", { description: "Pause or resume a Sticky task's recurrence without deleting the task or its schedule.", inputSchema: z.object({ taskId: id, paused: z.boolean() }) },
    async (input) => mutationResult("set_task_recurrence_paused", input, async (current) => ({ recurrence: await getRuntime().repository.setTaskRecurrencePaused(current, input.taskId, input.paused) })));

  server.registerTool("remove_task_recurrence", { description: "Stop a Sticky task from repeating by deleting only its recurrence rule. The current task remains. Use only when the user explicitly asks to stop or remove repetition.", inputSchema: z.object({ taskId: id }), annotations: { destructiveHint: true } },
    async (input) => mutationResult("remove_task_recurrence", input, async (current) => { await getRuntime().repository.removeTaskRecurrence(current, input.taskId); return { removed: true, taskId: input.taskId }; }));

  server.registerTool("advance_recurring_tasks", { description: "Catch overdue recurring Sticky tasks up to their next valid occurrence on or after a target date. Omit taskIds to catch up every overdue recurrence; omit throughDate to use today in each rule's timezone. Returns exactly which tasks advanced and which were already current or ended.", inputSchema: z.object({ taskIds: z.array(id).max(500).optional(), throughDate: z.iso.date().optional() }) },
    async (input) => mutationResult("advance_recurring_tasks", input, async (current) => {
      const rules = await getRuntime().repository.listTaskRecurrenceRules(current);
      const requested = input.taskIds ? new Set(input.taskIds) : null;
      if (requested) {
        const available = new Set(rules.map((rule) => rule.taskId));
        const missing = [...requested].filter((taskId) => !available.has(taskId));
        if (missing.length) throw new StickyDomainError("not_found", "One or more requested tasks do not have a recurrence rule.", 404, { taskIds: missing });
      }
      const results = [];
      for (const rule of rules) {
        if (requested && !requested.has(rule.taskId)) continue;
        const throughDate = input.throughDate ?? zonedDateKeyAt(new Date(), rule.timezone);
        results.push(await getRuntime().repository.advanceRecurringTask(current, rule.taskId, throughDate));
      }
      return {
        advanced: results.filter((item) => item.advanced),
        unchanged: results.filter((item) => !item.advanced).map((item) => ({ task: item.task, recurrence: item.recurrence })),
      };
    }));

  if (options.includeDirectGoogle) {
    server.registerTool("create_google_task", { description: "Create a task directly in Google Tasks. This never creates a Sticky task.", inputSchema: z.object({ taskListId: z.string().min(1).max(1_000), title: z.string().trim().min(1).max(1_000), notes: z.string().max(20_000).default(""), dueDate: z.iso.date().nullable().default(null), parentId: z.string().min(1).max(1_000).optional(), previousId: z.string().min(1).max(1_000).optional() }) },
      async (input) => externalMutationResult("create_google_task", input, async (current) => ({ task: await createGoogleTask(current, input), source: "google_tasks" }), "tasks:write"));

    server.registerTool("create_google_task_list", { description: "Create a list directly in Google Tasks. This never creates a Sticky list.", inputSchema: z.object({ title: z.string().trim().min(1).max(1_000) }) },
      async ({ title }) => externalMutationResult("create_google_task_list", { title }, async (current) => ({ list: await createGoogleTaskList(current, title), source: "google_tasks" }), "tasks:write"));

    server.registerTool("update_google_task_list", { description: "Rename a list directly in Google Tasks. This never changes a Sticky list.", inputSchema: z.object({ taskListId: z.string().min(1).max(1_000), title: z.string().trim().min(1).max(1_000) }) },
      async (input) => externalMutationResult("update_google_task_list", input, async (current) => ({ list: await updateGoogleTaskList(current, input.taskListId, input.title), source: "google_tasks" }), "tasks:write"));

    server.registerTool("update_google_task", { description: "Update or complete a task directly in Google Tasks. This never changes a Sticky task.", inputSchema: z.object({ taskListId: z.string().min(1).max(1_000), taskId: z.string().min(1).max(1_000), title: z.string().trim().min(1).max(1_000).optional(), notes: z.string().max(20_000).optional(), dueDate: z.iso.date().nullable().optional(), completed: z.boolean().optional() }) },
      async (input) => externalMutationResult("update_google_task", input, async (current) => ({ task: await updateGoogleTask(current, input), source: "google_tasks" }), "tasks:write"));

    server.registerTool("complete_google_task", { description: "Mark one live Google Task complete. This never changes or creates a Sticky task.", inputSchema: z.object({ taskListId: z.string().min(1).max(1_000), taskId: z.string().min(1).max(1_000) }) },
      async (input) => externalMutationResult("complete_google_task", input, async (current) => ({ task: await updateGoogleTask(current, { ...input, completed: true }), source: "google_tasks" }), "tasks:write"));

    server.registerTool("restore_google_task", { description: "Restore one completed Google Task to active. This never changes or creates a Sticky task.", inputSchema: z.object({ taskListId: z.string().min(1).max(1_000), taskId: z.string().min(1).max(1_000) }) },
      async (input) => externalMutationResult("restore_google_task", input, async (current) => ({ task: await updateGoogleTask(current, { ...input, completed: false }), source: "google_tasks" }), "tasks:write"));

    server.registerTool("delete_google_task", { description: "Permanently delete a Google task. Requires explicit confirmation and never touches Sticky.", inputSchema: z.object({ taskListId: z.string().min(1).max(1_000), taskId: z.string().min(1).max(1_000), confirmation: destructive }), annotations: { destructiveHint: true } },
      async (input) => { const current = actor(); requireDestructiveConfirmation(current, input.confirmation, ["delete", "Google", input.taskId]); return externalMutationResult("delete_google_task", input, async () => deleteGoogleTask(current, input.taskListId, input.taskId), "tasks:write"); });

    server.registerTool("delete_google_task_list", { description: "Permanently delete a Google Tasks list and its tasks. Requires explicit confirmation and never touches Sticky.", inputSchema: z.object({ taskListId: z.string().min(1).max(1_000), confirmation: destructive }), annotations: { destructiveHint: true } },
      async (input) => { const current = actor(); requireDestructiveConfirmation(current, input.confirmation, ["delete", "Google", "list", input.taskListId]); return externalMutationResult("delete_google_task_list", input, async () => deleteGoogleTaskList(current, input.taskListId), "tasks:write"); });
  }

  server.registerTool("create_calendar_event", { description: "Create a timed or all-day event in Sticky Calendar.", inputSchema: z.discriminatedUnion("allDay", [
    z.object({ calendarId: id.optional(), taskId: id.nullable().default(null), title: z.string().trim().min(1).max(240), details: z.string().max(20_000).default(""), location: z.string().max(500).default(""), allDay: z.literal(false), startAt: z.iso.datetime({ offset: true }), endAt: z.iso.datetime({ offset: true }), timezone: z.string().default("America/Chicago") }),
    z.object({ calendarId: id.optional(), taskId: id.nullable().default(null), title: z.string().trim().min(1).max(240), details: z.string().max(20_000).default(""), location: z.string().max(500).default(""), allDay: z.literal(true), startDate: z.iso.date(), endDate: z.iso.date(), timezone: z.string().default("America/Chicago") }),
  ]) },
    async (input) => mutationResult("create_calendar_event", input, async (current) => ({ event: await getRuntime().repository.createCalendarEvent(current, { ...input, recurrence: [], status: "confirmed", transparency: "opaque", color: null }) }), "calendar:write"));

  if (options.includeDirectGoogle) {
    server.registerTool("create_google_calendar_event", { description: "Create an event directly in Google Calendar. This never creates a Sticky Calendar event.", inputSchema: googleCalendarEventInput },
      async (input) => externalMutationResult("create_google_calendar_event", input, async (current) => ({ event: await createGoogleCalendarEvent(current, input), source: "google_calendar" }), "calendar:write"));

    server.registerTool("update_google_calendar_event", { description: "Update an event directly in Google Calendar. Supply its current schedule; Sticky Calendar remains unchanged.", inputSchema: googleCalendarEventUpdateInput },
      async (input) => externalMutationResult("update_google_calendar_event", input, async (current) => ({ event: await updateGoogleCalendarEvent(current, input), source: "google_calendar" }), "calendar:write"));

    server.registerTool("delete_google_calendar_event", { description: "Permanently delete a Google Calendar event. Requires explicit confirmation and never touches Sticky Calendar.", inputSchema: z.object({ calendarId: z.string().min(1).max(1_000), eventId: z.string().min(1).max(1_000), confirmation: destructive }), annotations: { destructiveHint: true } },
      async (input) => { const current = actor(); requireDestructiveConfirmation(current, input.confirmation, ["delete", "Google", input.eventId], "calendar:destructive"); return externalMutationResult("delete_google_calendar_event", input, async () => deleteGoogleCalendarEvent(current, input.calendarId, input.eventId), "calendar:write"); });
  }

  server.registerTool("update_calendar_event", { description: "Update any editable field on a Sticky calendar event. The record version is optional; when omitted, Sticky safely reads the current version.", inputSchema: z.object({ eventId: id, version: version.optional(), calendarId: id.optional(), taskId: id.nullable().optional(), title: z.string().trim().min(1).max(240).optional(), details: z.string().max(20_000).optional(), location: z.string().max(500).optional(), allDay: z.boolean().optional(), startAt: z.iso.datetime({ offset: true }).nullable().optional(), endAt: z.iso.datetime({ offset: true }).nullable().optional(), startDate: z.iso.date().nullable().optional(), endDate: z.iso.date().nullable().optional(), timezone: z.string().optional(), recurrence: z.array(z.string().trim().min(1).max(500)).max(20).optional(), status: z.enum(["confirmed", "tentative", "cancelled"]).optional(), transparency: z.enum(["opaque", "transparent"]).optional(), color: stickyColorSchema.nullable().optional() }) },
    async (input) => mutationResult("update_calendar_event", input, async (current) => {
      const existing = await getRuntime().repository.getCalendarEvent(current, input.eventId);
      const { eventId, ...patch } = input;
      return { event: await getRuntime().repository.updateCalendarEvent(current, eventId, { ...patch, version: input.version ?? existing.version }) };
    }, "calendar:write"));

  server.registerTool("time_block_task", { description: "Reserve time on Sticky Calendar for an existing task and link the event back to that task.", inputSchema: z.object({ taskId: id, startAt: z.iso.datetime({ offset: true }), durationMinutes: z.int().min(5).max(1_440).default(30), calendarId: id.optional(), location: z.string().max(500).default("") }) },
    async ({ taskId, ...input }) => mutationResult("time_block_task", { taskId, ...input }, async (current) => ({ event: await getRuntime().repository.timeBlockTask(current, taskId, input) }), "calendar:write"));

  server.registerTool("update_task", { description: "Update a Sticky task's title, details, color, due date, due time, or timezone. The record version is optional; when omitted, Sticky safely reads the current version.", inputSchema: z.object({ taskId: id, version: version.optional(), title: z.string().trim().min(1).max(180).optional(), details: z.string().max(20_000).optional(), color: stickyColorSchema.optional(), dueDate: z.iso.date().nullable().optional(), dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/).nullable().optional(), timezone: z.string().optional() }) },
    async (input) => mutationResult("update_task", input, async (current) => {
      const existing = await getRuntime().repository.getTask(current, input.taskId);
      const { taskId, ...patch } = input;
      return { task: await getRuntime().repository.updateTask(current, taskId, { ...patch, version: input.version ?? existing.version }) };
    }));

  server.registerTool("move_task", { description: "Move an active or completed task to another Sticky list. The record version is optional.", inputSchema: z.object({ taskId: id, targetListId: id, version: version.optional() }) },
    async (input) => mutationResult("move_task", input, async (current) => {
      const existing = await getRuntime().repository.getTask(current, input.taskId);
      return { task: await getRuntime().repository.moveTask(current, input.taskId, input.targetListId, input.version ?? existing.version) };
    }));

  server.registerTool("move_task_in_list", { description: "Move one active Sticky task immediately before or after another active task in the same list. Read list_tasks first. This changes custom order only.", inputSchema: z.object({ listId: id, taskId: id, relativeToTaskId: id, position: z.enum(["before", "after"]) }) },
    async (input) => mutationResult("move_task_in_list", input, async (current) => {
      const tasks = await getRuntime().repository.listTasks(current, { listId: input.listId });
      const taskIds = moveTaskId(tasks.map((task) => task.id), input.taskId, input.relativeToTaskId, input.position);
      return { tasks: await getRuntime().repository.reorderTasks(current, input.listId, taskIds) };
    }));

  server.registerTool("reorder_tasks", { description: "Set the complete top-to-bottom custom order of every active Sticky task in one list. Pass every active task id exactly once.", inputSchema: z.object({ listId: id, taskIds: z.array(id).min(1).max(1_000) }) },
    async (input) => mutationResult("reorder_tasks", input, async (current) => ({ tasks: await getRuntime().repository.reorderTasks(current, input.listId, input.taskIds) })));

  server.registerTool("duplicate_task", { description: "Duplicate a Sticky task into the same list. The copy keeps details, color, dates, times, and either its subtasks or its recurrence; copied subtasks are reset to active. A custom title is optional.", inputSchema: z.object({ taskId: id, title: z.string().trim().min(1).max(180).optional() }) },
    async (input) => mutationResult("duplicate_task", input, async (current) => getRuntime().repository.duplicateTask(current, input.taskId, input.title)));

  server.registerTool("complete_task", { description: "Mark a Sticky task complete. If it repeats, Sticky atomically creates the next scheduled occurrence and moves the recurrence rule to it. The record version is optional; when omitted, Sticky safely uses the current version.", inputSchema: z.object({ taskId: id, version: version.optional() }) },
    async (input) => mutationResult("complete_task", input, async (current) => {
      const currentVersion = input.version ?? (await getRuntime().repository.getTask(current, input.taskId)).version;
      return getRuntime().repository.completeTaskWithRecurrence(current, input.taskId, currentVersion);
    }));

  server.registerTool("undo_recurring_completion", { description: "Undo the most recent recurring-task completion using the completed task id and the generated next-task id returned by complete_task. Sticky deletes only that generated occurrence, restores the completed occurrence, and moves the recurrence rule back.", inputSchema: z.object({ completedTaskId: id, generatedTaskId: id }) },
    async (input) => mutationResult("undo_recurring_completion", input, async (current) => getRuntime().repository.undoRecurringCompletion(current, input.completedTaskId, input.generatedTaskId)));

  server.registerTool("restore_task", { description: "Restore a completed Sticky task. The record version is optional; when omitted, Sticky safely uses the current version.", inputSchema: z.object({ taskId: id, version: version.optional() }) },
    async (input) => mutationResult("restore_task", input, async (current) => {
      const currentVersion = input.version ?? (await getRuntime().repository.getTask(current, input.taskId)).version;
      return { task: await getRuntime().repository.setTaskCompleted(current, input.taskId, false, currentVersion) };
    }));

  server.registerTool("add_subtask", { description: "Create a real subtask under an existing non-recurring Sticky task. Use this whenever the user says add/create a subtask; never claim the integration cannot create subtasks and never redirect this request to Google Tasks. The subtask may have its own dueDate. If that date is later than the parent task, Sticky automatically extends the parent task due date.", inputSchema: z.object({ taskId: id, title: z.string().trim().min(1).max(160), dueDate: z.iso.date().nullable().default(null) }) },
    async (input) => mutationResult("add_subtask", input, async (current) => ({ subtask: await getRuntime().repository.createSubtask(current, input.taskId, input) })));

  server.registerTool("update_subtask", { description: "Rename or reschedule one existing Sticky subtask. Read list_subtasks first. A subtask has its own optional dueDate, and Sticky automatically keeps the parent task deadline on or after it.", inputSchema: z.object({ subtaskId: id, version: version.optional(), title: z.string().trim().min(1).max(160).optional(), dueDate: z.iso.date().nullable().optional() }) },
    async (input) => mutationResult("update_subtask", input, async (current) => {
      const existing = await getRuntime().repository.getSubtask(current, input.subtaskId);
      return { subtask: await getRuntime().repository.updateSubtask(current, input.subtaskId, { version: input.version ?? existing.version, title: input.title, dueDate: input.dueDate }) };
    }));

  server.registerTool("complete_subtask", { description: "Mark one Sticky subtask complete without completing its parent task. Read list_subtasks first. The record version is optional.", inputSchema: z.object({ subtaskId: id, version: version.optional() }) },
    async (input) => mutationResult("complete_subtask", input, async (current) => {
      const existing = await getRuntime().repository.getSubtask(current, input.subtaskId);
      return { subtask: await getRuntime().repository.setSubtaskCompleted(current, input.subtaskId, true, input.version ?? existing.version) };
    }));

  server.registerTool("restore_subtask", { description: "Restore one completed Sticky subtask without changing its parent task. Read list_subtasks first. The record version is optional.", inputSchema: z.object({ subtaskId: id, version: version.optional() }) },
    async (input) => mutationResult("restore_subtask", input, async (current) => {
      const existing = await getRuntime().repository.getSubtask(current, input.subtaskId);
      return { subtask: await getRuntime().repository.setSubtaskCompleted(current, input.subtaskId, false, input.version ?? existing.version) };
    }));

  server.registerTool("move_subtask", {
    description: "Move one Sticky subtask immediately before or after another subtask under the same parent task. Read list_subtasks first. This never changes Google Tasks.",
    inputSchema: z.object({ taskId: id, subtaskId: id, relativeToSubtaskId: id, position: z.enum(["before", "after"]) }),
  }, async (input) => mutationResult("move_subtask", input, async (current) => {
    const subtasks = await getRuntime().repository.listSubtasks(current, input.taskId, true);
    const subtaskIds = moveSubtaskId(subtasks.map((subtask) => subtask.id), input.subtaskId, input.relativeToSubtaskId, input.position);
    return { subtasks: await getRuntime().repository.reorderSubtasks(current, input.taskId, subtaskIds) };
  }));

  server.registerTool("reorder_subtasks", {
    description: "Set the complete top-to-bottom order of every Sticky subtask under one parent task. Pass every subtask id exactly once. This never changes Google Tasks.",
    inputSchema: z.object({ taskId: id, subtaskIds: z.array(id).min(1).max(500) }),
  }, async (input) => mutationResult("reorder_subtasks", input, async (current) => ({
    subtasks: await getRuntime().repository.reorderSubtasks(current, input.taskId, input.subtaskIds),
  })));

  server.registerTool("schedule_reminder", { description: "Schedule a web push, Poke, or combined reminder for a task.", inputSchema: z.object({ taskId: id, kind: z.enum(["absolute", "relative"]), remindAt: z.iso.datetime().optional(), relativeMinutes: z.int().positive().optional(), channels: z.array(z.enum(["push", "poke"])).min(1) }) },
    async ({ taskId, ...input }) => mutationResult("schedule_reminder", { taskId, ...input }, async (current) => {
      const task = await getRuntime().repository.getTask(current, taskId);
      const remindAt = resolveReminderTime(input, task);
      const reminder = await getRuntime().repository.createReminder(current, taskId, input, remindAt);
      return { reminder, workflowRunId: await scheduleReminderWorkflow(reminder) };
    }));

  server.registerTool("snooze_reminder", { description: "Move a reminder to a new absolute time.", inputSchema: z.object({ reminderId: id, version, remindAt: z.iso.datetime() }) },
    async (input) => mutationResult("snooze_reminder", input, async (current) => {
      const reminder = await getRuntime().repository.snoozeReminder(current, input.reminderId, input.version, input.remindAt);
      return { reminder, workflowRunId: await scheduleReminderWorkflow(reminder) };
    }));

  server.registerTool("update_workspace_preferences", { description: "Change persisted Sticky workspace preferences: completed-pile state, density, light/dark theme, pad/wood board style, task filter, or custom/due-date sorting. This changes the app's saved workspace presentation, not task data.", inputSchema: updateWorkspacePreferencesSchema },
    async (input) => mutationResult("update_workspace_preferences", input, async (current) => ({ preferences: await getRuntime().repository.updateWorkspacePreferences(current, input) })));

  server.registerTool("update_daily_agenda_settings", { description: "Enable or disable the daily Poke agenda and change its delivery time and IANA timezone. This is the same persisted schedule controlled from Sticky Settings.", inputSchema: dailyAgendaSettingsSchema },
    async (input) => mutationResult("update_daily_agenda_settings", input, async (current) => ({ settings: await updateDailyAgendaSettings(current.userId, input) })));

  server.registerTool("send_daily_agenda_test", { description: "Send the user's current Sticky daily agenda through the configured Poke delivery now as a test. The response reports delivery or the exact configuration reason it could not send.", inputSchema: z.object({}) },
    async (input) => mutationResult("send_daily_agenda_test", input, async (current) => ({ delivery: await sendDailyAgendaTest(current) })));

  server.registerTool("archive_list", { description: "Archive a list so it leaves the main board without deleting its tasks. The record version is optional.", inputSchema: z.object({ listId: id, version: version.optional() }) },
    async (input) => mutationResult("archive_list", input, async (current) => {
      const existing = await getRuntime().repository.getList(current, input.listId);
      return { list: await getRuntime().repository.updateList(current, input.listId, { version: input.version ?? existing.version, archived: true }) };
    }));

  server.registerTool("delete_task", { description: "Permanently delete a task. Requires explicit confirmation.", inputSchema: z.object({ taskId: id, confirmation: destructive }), annotations: { destructiveHint: true } },
    async (input) => { const current = actor(); destructiveConfirmationSchema.parse(input.confirmation); requireDestructiveConfirmation(current, input.confirmation, ["delete", input.taskId]); return mutationResult("delete_task", input, async () => { await getRuntime().repository.deleteTask(current, input.taskId); return { deleted: true, taskId: input.taskId }; }); });

  server.registerTool("delete_subtask", { description: "Permanently delete one Sticky subtask without deleting its parent task. Read list_subtasks first and require the user's explicit deletion request. This never deletes a Google Task.", inputSchema: z.object({ subtaskId: id, confirmation: destructive }), annotations: { destructiveHint: true } },
    async (input) => { const current = actor(); requireDestructiveConfirmation(current, input.confirmation, ["delete", input.subtaskId]); return mutationResult("delete_subtask", input, async () => { await getRuntime().repository.deleteSubtask(current, input.subtaskId); return { deleted: true, subtaskId: input.subtaskId }; }); });

  server.registerTool("delete_list", { description: "Permanently delete one Sticky list and every Sticky task, completed task, and subtask inside it. Read list_lists first. The user must explicitly request deletion; put the word delete and the exact Sticky list id in confirmation.summary. This never deletes a Google Tasks list, even when a Sticky task title mentions Google.", inputSchema: z.object({ listId: id, confirmation: destructive }), annotations: { destructiveHint: true } },
    async (input) => { const current = actor(); requireDestructiveConfirmation(current, input.confirmation, ["delete", input.listId]); return mutationResult("delete_list", input, async () => { await getRuntime().repository.deleteList(current, input.listId); return { deleted: true, listId: input.listId }; }); });

  server.registerTool("delete_calendar_event", { description: "Permanently delete a Sticky calendar event. Requires explicit confirmation.", inputSchema: z.object({ eventId: id, confirmation: destructive }), annotations: { destructiveHint: true } },
    async (input) => {
      const current = actor();
      requireDestructiveConfirmation(current, input.confirmation, ["delete", input.eventId], "calendar:destructive");
      return mutationResult("delete_calendar_event", input, async () => {
        await getRuntime().repository.deleteCalendarEvent(current, input.eventId);
        return { deleted: true, eventId: input.eventId };
      }, "calendar:write");
    });

  server.registerTool("clear_completed", { description: "Permanently delete all completed tasks in a list. Requires explicit confirmation.", inputSchema: z.object({ listId: id, confirmation: destructive }), annotations: { destructiveHint: true } },
    async (input) => { const current = actor(); requireDestructiveConfirmation(current, input.confirmation, ["clear", "completed", input.listId]); return mutationResult("clear_completed", input, async () => ({ deletedTaskIds: await getRuntime().repository.clearCompletedTasks(current, input.listId) })); });
}

export function createMcpApp() {
  const allowedHosts = ["sticky.yuvrajkashyap.com", "localhost", "127.0.0.1"];
  const app = createMcpHonoApp({ host: "0.0.0.0", allowedHosts, allowedOrigins: allowedHosts });
  app.use("*", async (c, next) => {
    const requestId = c.req.header("x-request-id")?.slice(0, 120) || crypto.randomUUID();
    const currentActor = await authenticateRequest(c.req.raw, requestId);
    if (currentActor.actorType !== "agent") throw new StickyDomainError("forbidden", "MCP requires an agent credential.", 403);
    currentActor.idempotencyKey = resolveMcpIdempotencyKey(
      currentActor.idempotencyKey,
      currentActor.credentialId,
      requestId,
    );
    await actorStorage.run(currentActor, next);
  });
  app.onError((error, c) => {
    console.error("Sticky MCP request failed", { error });
    const status = error instanceof StickyDomainError ? error.status : 500;
    const code = status === 401 ? -32001 : status === 403 ? -32003 : -32603;
    return c.json({ jsonrpc: "2.0", error: { code, message: error instanceof Error ? error.message : "MCP request failed" }, id: null }, status as 401);
  });
  app.get("/", (c) => c.body(null, 405, { Allow: "POST" }));
  app.all("/", async (c) => {
    const isPoke = actor().actorId.startsWith("poke:");
    const server = new McpServer(
      { name: isPoke ? "Sticky Focused Workspace" : "Sticky", version: "1.5.0" },
      {
        instructions: isPoke
          ? "Sticky is the user's canonical focused task and planning system. All meaningful server-backed actions available in the Sticky app are exposed here. Before claiming an action is unsupported, inspect the available tools; for compound requests, call get_workspace_snapshot, complete every requested part in order, and report each result. Use this server only for Sticky tasks, Sticky subtasks, recurring tasks, Sticky Calendar, reminders, daily-agenda settings, workspace preferences, and the guarded one-time Google Tasks-to-Sticky transfer tools. You can create, rename, recolor, show, hide, move, reorder, archive, restore, and explicitly delete Sticky lists. You can create, edit, recolor, move, reorder, duplicate, complete, restore, and explicitly delete Sticky tasks. Recurring Sticky tasks are first-class: create them by passing recurrence directly to create_task, or use set_task_recurrence on an existing active task. You can list, change, pause, resume, catch up, undo the latest recurring completion, and remove recurrence. Weekly days use 0=Sunday through 6=Saturday, startsOn is the first due date, dueTime is the local occurrence time, and the default timezone is America/Chicago. Recurrence and reminders are different: never replace a requested recurring task with a reminder or claim recurrence is unsupported. Completing a recurring task creates its next occurrence automatically. Repeating tasks cannot contain subtasks. When one request names a new non-recurring task and its subtasks, pass the subtasks directly to create_task so the whole hierarchy is created; never create only the parent, claim subtasks are unavailable, or redirect Sticky subtasks to Google Tasks. Sticky subtasks are first-class: you can list, inspect, add, rename, independently date, complete, restore, reorder, and delete them. Their due dates are scheduled steps, while the parent task due date is the final deadline and Sticky keeps it on or after the latest subtask. A title such as 'Google test' inside a Sticky list is still Sticky data and does not make the list a Google Tasks list. Use Poke's own Google integration for routine Google Tasks and Google Calendar reads or changes. Google and Sticky are separate systems: never sync, mirror, or import them automatically. A transfer must start with preview_google_tasks_to_sticky and must receive a new explicit user confirmation before the matching copy or move tool. Moving also requires explicit approval to delete Google originals after Sticky verifies every copy. Tasks and calendar events are distinct: due dates are deadlines while events reserve time. Read the relevant Sticky record before changing it. When the user explicitly asks to delete a named Sticky item in the current message, that request can supply the confirmation summary required by the matching destructive tool; never infer destructive approval. Credential, OAuth, bulk-import override, browser-permission, sign-out, and device-local navigation controls remain human-only."
          : "Sticky is the user's canonical focused task and planning system. This server exposes first-class Sticky tasks, subtasks, recurring tasks, calendar events, separate live Google tools, and a guarded one-time Google Tasks-to-Sticky transfer. Recurrence is separate from reminders: create repeating tasks with create_task.recurrence, use startsOn as the first due date, and use daysOfWeek 0=Sunday through 6=Saturday. Completing a recurring task creates its next occurrence. Repeating tasks cannot have subtasks. Never sync, import, mirror, or copy between Sticky and Google automatically. A transfer must start with preview_google_tasks_to_sticky and receive a new explicit user confirmation before the matching copy or move tool. Use Sticky tools for Sticky data and google-prefixed tools for Google data. Tasks and calendar events are distinct: due dates are deadlines while events reserve time. Read the relevant source before changing it and request explicit confirmation before destructive actions.",
      },
    );
    registerTools(server, { includeDirectGoogle: !isPoke });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    const parsedBody = (c as unknown as { get(key: string): unknown }).get("parsedBody");
    return transport.handleRequest(c.req.raw, { parsedBody });
  });
  return app;
}

export function resolveMcpIdempotencyKey(
  explicitKey: string | null,
  credentialId: string | null,
  requestId: string,
): string {
  if (explicitKey) return explicitKey;
  return `mcp:${credentialId}:${requestId}`;
}
