import { AsyncLocalStorage } from "node:async_hooks";
import type { ActorContext } from "@sticky/contracts";
import { destructiveConfirmationSchema } from "@sticky/contracts";
import { requireDestructiveConfirmation, requireScope, resolveReminderTime, StickyDomainError } from "@sticky/domain";
import { createMcpHonoApp } from "@modelcontextprotocol/hono";
import { McpServer, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { start } from "workflow/api";
import { z } from "zod";
import { idempotent } from "./idempotency";
import { authenticateRequest, getRuntime } from "./runtime";
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

async function mutationResult<T>(tool: string, input: unknown, operation: (current: ActorContext) => Promise<T>) {
  const current = actor();
  requireScope(current, "tasks:write");
  const execution = await idempotent(current, `mcp:${tool}`, input, () => operation(current));
  if (!execution.replayed && process.env.WORKFLOW_ENABLED !== "false") {
    await start(outboxWorkflow, [current.userId]);
  }
  return result(execution.value);
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

  server.registerTool("create_list", { description: "Create a Sticky list.", inputSchema: z.object({ name: z.string().trim().min(1).max(80), color: z.enum(["sun", "coral", "mint", "sky", "violet", "ink"]).default("sun") }) },
    async (input) => mutationResult("create_list", input, async (current) => ({ list: await getRuntime().repository.createList(current, input) })));

  server.registerTool("create_task", { description: "Create a task in a Sticky list.", inputSchema: z.object({ listId: id, title: z.string().trim().min(1).max(180), details: z.string().max(20_000).default(""), dueDate: z.iso.date().nullable().default(null), dueTime: z.string().nullable().default(null), timezone: z.string().default("America/Chicago") }) },
    async (input) => mutationResult("create_task", input, async (current) => ({ task: await getRuntime().repository.createTask(current, { ...input, color: "sun" }) })));

  server.registerTool("update_task", { description: "Update title, details, date, time, or timezone using the current record version.", inputSchema: z.object({ taskId: id, version, title: z.string().trim().min(1).max(180).optional(), details: z.string().max(20_000).optional(), dueDate: z.iso.date().nullable().optional(), dueTime: z.string().nullable().optional(), timezone: z.string().optional() }) },
    async ({ taskId, ...input }) => mutationResult("update_task", { taskId, ...input }, async (current) => ({ task: await getRuntime().repository.updateTask(current, taskId, input) })));

  server.registerTool("move_task", { description: "Move a task to another Sticky list.", inputSchema: z.object({ taskId: id, targetListId: id, version }) },
    async (input) => mutationResult("move_task", input, async (current) => ({ task: await getRuntime().repository.moveTask(current, input.taskId, input.targetListId, input.version) })));

  server.registerTool("complete_task", { description: "Mark a Sticky task complete.", inputSchema: z.object({ taskId: id, version }) },
    async (input) => mutationResult("complete_task", input, async (current) => ({ task: await getRuntime().repository.setTaskCompleted(current, input.taskId, true, input.version) })));

  server.registerTool("restore_task", { description: "Restore a completed Sticky task.", inputSchema: z.object({ taskId: id, version }) },
    async (input) => mutationResult("restore_task", input, async (current) => ({ task: await getRuntime().repository.setTaskCompleted(current, input.taskId, false, input.version) })));

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
    if (!currentActor.idempotencyKey) {
      const parsedBody = (c as unknown as { get(key: string): unknown }).get("parsedBody");
      const rpcId = parsedBody && typeof parsedBody === "object" && "id" in parsedBody
        ? String((parsedBody as { id: unknown }).id)
        : requestId;
      currentActor.idempotencyKey = `mcp:${currentActor.credentialId}:${rpcId}`;
    }
    await actorStorage.run(currentActor, next);
  });
  app.onError((error, c) => {
    console.error("Sticky MCP request failed", { error });
    const status = error instanceof StickyDomainError ? error.status : 500;
    const code = status === 401 ? -32001 : status === 403 ? -32003 : -32603;
    return c.json({ jsonrpc: "2.0", error: { code, message: error instanceof Error ? error.message : "MCP request failed" }, id: null }, status as 401);
  });
  app.all("/", async (c) => {
    const server = new McpServer(
      { name: "Sticky", version: "1.0.0" },
      {
        instructions: "Sticky is the user's canonical task system. Read the available lists before creating a task, preserve existing data, and request explicit confirmation before destructive actions.",
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
