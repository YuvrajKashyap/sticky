import { AsyncLocalStorage } from "node:async_hooks";
import type { ActorContext, StickyScope } from "@sticky/contracts";
import { destructiveConfirmationSchema } from "@sticky/contracts";
import { requireDestructiveConfirmation, requireScope, resolveReminderTime, StickyDomainError } from "@sticky/domain";
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

function registerTools(server: McpServer) {
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

  server.registerTool("get_agenda", { description: "Get incomplete tasks due in an inclusive date range.", inputSchema: z.object({ from: z.iso.date(), to: z.iso.date() }), annotations: { readOnlyHint: true } },
    async ({ from, to }) => { const current = actor(); requireScope(current, "tasks:read"); const tasks = await getRuntime().repository.listTasks(current); return result({ tasks: tasks.filter((task) => task.dueDate && task.dueDate >= from && task.dueDate <= to) }); });

  server.registerTool("list_calendars", { description: "List the user's Sticky calendars and identify the default calendar.", inputSchema: z.object({ includeArchived: z.boolean().default(false) }), annotations: { readOnlyHint: true } },
    async ({ includeArchived }) => { const current = actor(); requireScope(current, "calendar:read"); return result({ calendars: await getRuntime().repository.listCalendars(current, includeArchived) }); });

  server.registerTool("list_calendar_events", { description: "List real Sticky calendar events that overlap a time range. These are time commitments, distinct from task due dates.", inputSchema: z.object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) }), annotations: { readOnlyHint: true } },
    async (range) => { const current = actor(); requireScope(current, "calendar:read"); return result({ events: await getRuntime().repository.listCalendarEvents(current, range) }); });

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

  server.registerTool("list_google_task_lists", { description: "List the user's live Google Tasks lists. Google data stays separate from Sticky and is never imported by this tool.", inputSchema: z.object({}), annotations: { readOnlyHint: true } },
    async () => { const current = actor(); requireScope(current, "tasks:read"); return result({ lists: await listGoogleTaskLists(current), source: "google_tasks" }); });

  server.registerTool("list_google_tasks", { description: "List tasks directly from one Google Tasks list without copying them into Sticky.", inputSchema: z.object({ taskListId: z.string().min(1).max(1_000), includeCompleted: z.boolean().default(false), includeHidden: z.boolean().default(false) }), annotations: { readOnlyHint: true } },
    async (input) => { const current = actor(); requireScope(current, "tasks:read"); return result({ tasks: await listGoogleTasks(current, input), source: "google_tasks" }); });

  server.registerTool("list_google_calendars", { description: "List the user's live Google calendars without copying them into Sticky Calendar.", inputSchema: z.object({}), annotations: { readOnlyHint: true } },
    async () => { const current = actor(); requireScope(current, "calendar:read"); return result({ calendars: await listGoogleCalendars(current), source: "google_calendar" }); });

  server.registerTool("list_google_calendar_events", { description: "List live Google Calendar events in a time range. This reads Google directly and does not create Sticky Calendar events.", inputSchema: z.object({ calendarId: z.string().min(1).max(1_000), from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }), query: z.string().trim().max(500).optional() }), annotations: { readOnlyHint: true } },
    async (input) => { const current = actor(); requireScope(current, "calendar:read"); return result({ events: await listGoogleCalendarEvents(current, input), source: "google_calendar" }); });

  server.registerTool("create_list", { description: "Create a Sticky list.", inputSchema: z.object({ name: z.string().trim().min(1).max(80), color: z.enum(["sun", "coral", "mint", "sky", "violet", "ink"]).default("sun") }) },
    async (input) => mutationResult("create_list", input, async (current) => ({ list: await getRuntime().repository.createList(current, input) })));

  server.registerTool("create_task", { description: "Create a task in a Sticky list.", inputSchema: z.object({ listId: id, title: z.string().trim().min(1).max(180), details: z.string().max(20_000).default(""), dueDate: z.iso.date().nullable().default(null), dueTime: z.string().nullable().default(null), timezone: z.string().default("America/Chicago") }) },
    async (input) => mutationResult("create_task", input, async (current) => ({ task: await getRuntime().repository.createTask(current, { ...input, color: "sun" }) })));

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

  server.registerTool("create_calendar_event", { description: "Create a timed or all-day event in Sticky Calendar.", inputSchema: z.discriminatedUnion("allDay", [
    z.object({ calendarId: id.optional(), taskId: id.nullable().default(null), title: z.string().trim().min(1).max(240), details: z.string().max(20_000).default(""), location: z.string().max(500).default(""), allDay: z.literal(false), startAt: z.iso.datetime({ offset: true }), endAt: z.iso.datetime({ offset: true }), timezone: z.string().default("America/Chicago") }),
    z.object({ calendarId: id.optional(), taskId: id.nullable().default(null), title: z.string().trim().min(1).max(240), details: z.string().max(20_000).default(""), location: z.string().max(500).default(""), allDay: z.literal(true), startDate: z.iso.date(), endDate: z.iso.date(), timezone: z.string().default("America/Chicago") }),
  ]) },
    async (input) => mutationResult("create_calendar_event", input, async (current) => ({ event: await getRuntime().repository.createCalendarEvent(current, { ...input, recurrence: [], status: "confirmed", transparency: "opaque", color: null }) }), "calendar:write"));

  server.registerTool("create_google_calendar_event", { description: "Create an event directly in Google Calendar. This never creates a Sticky Calendar event.", inputSchema: googleCalendarEventInput },
    async (input) => externalMutationResult("create_google_calendar_event", input, async (current) => ({ event: await createGoogleCalendarEvent(current, input), source: "google_calendar" }), "calendar:write"));

  server.registerTool("update_google_calendar_event", { description: "Update an event directly in Google Calendar. Supply its current schedule; Sticky Calendar remains unchanged.", inputSchema: googleCalendarEventUpdateInput },
    async (input) => externalMutationResult("update_google_calendar_event", input, async (current) => ({ event: await updateGoogleCalendarEvent(current, input), source: "google_calendar" }), "calendar:write"));

  server.registerTool("delete_google_calendar_event", { description: "Permanently delete a Google Calendar event. Requires explicit confirmation and never touches Sticky Calendar.", inputSchema: z.object({ calendarId: z.string().min(1).max(1_000), eventId: z.string().min(1).max(1_000), confirmation: destructive }), annotations: { destructiveHint: true } },
    async (input) => { const current = actor(); requireDestructiveConfirmation(current, input.confirmation, ["delete", "Google", input.eventId], "calendar:destructive"); return externalMutationResult("delete_google_calendar_event", input, async () => deleteGoogleCalendarEvent(current, input.calendarId, input.eventId), "calendar:write"); });

  server.registerTool("update_calendar_event", { description: "Update a Sticky calendar event using its current record version.", inputSchema: z.object({ eventId: id, version, title: z.string().trim().min(1).max(240).optional(), details: z.string().max(20_000).optional(), location: z.string().max(500).optional(), allDay: z.boolean().optional(), startAt: z.iso.datetime({ offset: true }).nullable().optional(), endAt: z.iso.datetime({ offset: true }).nullable().optional(), startDate: z.iso.date().nullable().optional(), endDate: z.iso.date().nullable().optional(), timezone: z.string().optional(), status: z.enum(["confirmed", "tentative", "cancelled"]).optional() }) },
    async ({ eventId, ...input }) => mutationResult("update_calendar_event", { eventId, ...input }, async (current) => ({ event: await getRuntime().repository.updateCalendarEvent(current, eventId, input) }), "calendar:write"));

  server.registerTool("time_block_task", { description: "Reserve time on Sticky Calendar for an existing task and link the event back to that task.", inputSchema: z.object({ taskId: id, startAt: z.iso.datetime({ offset: true }), durationMinutes: z.int().min(5).max(1_440).default(30), calendarId: id.optional(), location: z.string().max(500).default("") }) },
    async ({ taskId, ...input }) => mutationResult("time_block_task", { taskId, ...input }, async (current) => ({ event: await getRuntime().repository.timeBlockTask(current, taskId, input) }), "calendar:write"));

  server.registerTool("update_task", { description: "Update title, details, date, time, or timezone using the current record version.", inputSchema: z.object({ taskId: id, version, title: z.string().trim().min(1).max(180).optional(), details: z.string().max(20_000).optional(), dueDate: z.iso.date().nullable().optional(), dueTime: z.string().nullable().optional(), timezone: z.string().optional() }) },
    async ({ taskId, ...input }) => mutationResult("update_task", { taskId, ...input }, async (current) => ({ task: await getRuntime().repository.updateTask(current, taskId, input) })));

  server.registerTool("move_task", { description: "Move a task to another Sticky list.", inputSchema: z.object({ taskId: id, targetListId: id, version }) },
    async (input) => mutationResult("move_task", input, async (current) => ({ task: await getRuntime().repository.moveTask(current, input.taskId, input.targetListId, input.version) })));

  server.registerTool("complete_task", { description: "Mark a Sticky task complete. The record version is optional; when omitted, Sticky safely uses the current version.", inputSchema: z.object({ taskId: id, version: version.optional() }) },
    async (input) => mutationResult("complete_task", input, async (current) => {
      const currentVersion = input.version ?? (await getRuntime().repository.getTask(current, input.taskId)).version;
      return { task: await getRuntime().repository.setTaskCompleted(current, input.taskId, true, currentVersion) };
    }));

  server.registerTool("restore_task", { description: "Restore a completed Sticky task. The record version is optional; when omitted, Sticky safely uses the current version.", inputSchema: z.object({ taskId: id, version: version.optional() }) },
    async (input) => mutationResult("restore_task", input, async (current) => {
      const currentVersion = input.version ?? (await getRuntime().repository.getTask(current, input.taskId)).version;
      return { task: await getRuntime().repository.setTaskCompleted(current, input.taskId, false, currentVersion) };
    }));

  server.registerTool("add_subtask", { description: "Add a subtask to a non-recurring Sticky task.", inputSchema: z.object({ taskId: id, title: z.string().trim().min(1).max(160) }) },
    async (input) => mutationResult("add_subtask", input, async (current) => ({ subtask: await getRuntime().repository.createSubtask(current, input.taskId, { title: input.title }) })));

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

  server.registerTool("archive_list", { description: "Archive a list so it leaves the main board without deleting its tasks.", inputSchema: z.object({ listId: id, version }) },
    async (input) => mutationResult("archive_list", input, async (current) => ({ list: await getRuntime().repository.updateList(current, input.listId, { version: input.version, archived: true }) })));

  server.registerTool("delete_task", { description: "Permanently delete a task. Requires explicit confirmation.", inputSchema: z.object({ taskId: id, confirmation: destructive }), annotations: { destructiveHint: true } },
    async (input) => { const current = actor(); destructiveConfirmationSchema.parse(input.confirmation); requireDestructiveConfirmation(current, input.confirmation, ["delete", input.taskId]); return mutationResult("delete_task", input, async () => { await getRuntime().repository.deleteTask(current, input.taskId); return { deleted: true, taskId: input.taskId }; }); });

  server.registerTool("delete_list", { description: "Permanently delete a list and its tasks. Requires explicit confirmation.", inputSchema: z.object({ listId: id, confirmation: destructive }), annotations: { destructiveHint: true } },
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
    async (input) => { const current = actor(); requireDestructiveConfirmation(current, input.confirmation, ["clear", "completed", input.listId]); return mutationResult("clear_completed", input, async () => { const { data, error } = await getRuntime().db.from("tasks").delete().eq("user_id", current.userId).eq("list_id", input.listId).eq("is_completed", true).select("id"); if (error) throw error; return { deletedTaskIds: data.map((item) => item.id) }; }); });
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
    const server = new McpServer(
      { name: "Sticky", version: "1.0.0" },
      {
        instructions: "Sticky is the user's canonical focused task and planning system. The server also exposes live Google Tasks and Google Calendar tools. Sticky and Google are separate systems: never sync, import, mirror, or copy between them unless the user explicitly asks for a specific transfer and names the destination. Use Sticky tools for Sticky data and google-prefixed tools for Google data. If a requested task source is ambiguous, identify it from the prior read result or ask whether the user means Sticky or Google. Prefer complete_task for Sticky completion and complete_google_task for Google completion. Tasks and calendar events are distinct: due dates describe deadlines, while events reserve time. Read the relevant source before changing it and request explicit confirmation before destructive actions.",
      },
    );
    registerTools(server);
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
