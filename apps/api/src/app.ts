import type { ActorContext, ApiSuccess } from "@sticky/contracts";
import {
  apiCredentialCreateSchema,
  completeTaskSchema,
  createListSchema,
  createReminderSchema,
  createSubtaskSchema,
  createTaskSchema,
  destructiveConfirmationSchema,
  googleListSelectionSchema,
  moveTaskSchema,
  snoozeReminderSchema,
  updateListSchema,
  updateTaskSchema,
} from "@sticky/contracts";
import { requireDestructiveConfirmation, requireScope, resolveReminderTime, StickyDomainError } from "@sticky/domain";
import { start } from "workflow/api";
import { Hono, type Context } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import { errorResponse } from "./errors";
import { idempotent } from "./idempotency";
import { agentRateLimit, authenticate, enforceOrigin, requestContext, type ApiVariables } from "./middleware";
import { createMcpApp } from "./mcp";
import { createCredentialToken, getRuntime } from "./runtime";
import {
  finishGoogleConnection,
  googleAuthorizationUrl,
  listGoogleTaskLists,
  pushOutboxEvent,
  selectGoogleLists,
  syncGoogle,
} from "./services/google";
import { deliverReminder } from "./services/notifications";
import { reminderWorkflow } from "./workflows/reminder";
import { outboxWorkflow } from "./workflows/outbox";
import { googleSyncWorkflow } from "./workflows/google-sync";

type Env = { Variables: ApiVariables };

function success<T>(c: Context<Env>, data: T, replayed = false) {
  return c.json<ApiSuccess<T>>({
    data,
    meta: { requestId: c.get("requestId"), ...(replayed ? { idempotentReplay: true } : {}) },
  });
}

function parseJson<T>(c: Context<Env>, schema: z.ZodType<T>): Promise<T> {
  return c.req.json().then((body) => schema.parse(body));
}

async function mutate<T>(c: Context<Env>, body: unknown, operation: () => Promise<T>) {
  const execution = await idempotent(c.get("actor"), `${c.req.method}:${c.req.path}`, body, operation);
  if (!execution.replayed && process.env.WORKFLOW_ENABLED !== "false") {
    await start(outboxWorkflow, [c.get("actor").userId]);
  }
  return success(c, execution.value, execution.replayed);
}

function requireCron(c: Context) {
  const secret = process.env.CRON_SECRET;
  const supplied = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret || supplied !== secret) throw new StickyDomainError("unauthorized", "Invalid worker credential.", 401);
}

const webCommandColumns: Record<string, ReadonlySet<string>> = {
  user_state: new Set(["selected_list_id", "search_query", "last_opened_at"]),
  user_preferences: new Set(["completed_open_by_list", "density", "color_mode", "board_style", "task_view_filter", "task_sort_mode"]),
  lists: new Set(["id", "user_id", "name", "color", "sort_order", "is_visible_on_board", "archived_at"]),
  tasks: new Set(["id", "user_id", "list_id", "title", "details", "color", "due_date", "due_time", "timezone", "is_completed", "completed_at", "sort_order", "completed_sort_order"]),
  subtasks: new Set(["id", "user_id", "task_id", "title", "is_completed", "completed_at", "sort_order"]),
  task_recurrence_rules: new Set(["id", "user_id", "task_id", "frequency", "interval_count", "days_of_week", "month_day", "starts_on", "end_type", "end_date", "occurrence_count", "timezone", "paused"]),
};

function validateWebCommandPayload(table: string, action: string, payload: unknown, userId: string) {
  if (action === "delete") return;
  const rows = Array.isArray(payload) ? payload : [payload];
  if (!rows.length || rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new StickyDomainError("validation_error", "This save command has an invalid payload.", 422);
  }
  const allowed = webCommandColumns[table];
  for (const row of rows as Array<Record<string, unknown>>) {
    const rejected = Object.keys(row).filter((key) => !allowed.has(key));
    if (rejected.length) throw new StickyDomainError("validation_error", "This save command contains fields Sticky does not allow.", 422, { rejected });
    if ("user_id" in row && row.user_id !== userId) throw new StickyDomainError("forbidden", "A save cannot target another account.", 403);
  }
}

async function recordWebCommand(actor: ActorContext, table: string, action: string, rows: Array<Record<string, unknown>>) {
  const { db } = getRuntime();
  const events = rows.filter((row) => row.id).map((row) => ({
    user_id: actor.userId,
    task_id: table === "tasks" && action !== "delete" ? row.id : table === "subtasks" ? row.task_id : null,
    list_id: table === "lists" && action !== "delete" ? row.id : table === "tasks" && action !== "delete" ? row.list_id : null,
    action: `${table}.${action}`,
    actor_type: "human",
    actor_id: actor.actorId,
    source: "web",
    request_id: actor.requestId,
    idempotency_key: actor.idempotencyKey,
    metadata: action === "delete" ? { deletedId: row.id } : {},
  }));
  if (events.length) await db.from("task_activity").insert(events);
}

async function assertOwnedRows(table: string, ids: string[], userId: string) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!uniqueIds.length) return;
  const { data, error } = await getRuntime().db.from(table).select("id").eq("user_id", userId).in("id", uniqueIds);
  if (error) throw error;
  if ((data?.length ?? 0) !== uniqueIds.length) {
    throw new StickyDomainError("forbidden", "This command includes a record outside your Sticky workspace.", 403);
  }
}

async function authorizeWebRpc(args: Record<string, unknown>, userId: string) {
  const stringIds = (value: unknown) => typeof value === "string" ? [value] : [];
  const arrayIds = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

  await Promise.all([
    assertOwnedRows("lists", [
      ...stringIds(args.p_list_id),
      ...stringIds(args.p_target_list_id),
      ...arrayIds(args.p_list_ids),
    ], userId),
    assertOwnedRows("tasks", [
      ...stringIds(args.p_task_id),
      ...stringIds(args.p_generated_task_id),
      ...arrayIds(args.p_task_ids),
    ], userId),
    assertOwnedRows("subtasks", arrayIds(args.p_subtask_ids), userId),
    assertOwnedRows("task_recurrence_rules", stringIds(args.p_recurrence_rule_id), userId),
  ]);
}

export function createApiApp() {
const app = new Hono<Env>();
  app.use("*", secureHeaders());
  app.use("*", requestContext);
  app.onError((error, c) => errorResponse(c, error));

  app.get("/api/health", (c) => c.json({ data: { status: "ok", service: "sticky-api", version: "1.0.0", time: new Date().toISOString() }, meta: { requestId: c.get("requestId") } }));

  app.get("/api/webhooks/google/oauth", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!code || !state) throw new StickyDomainError("bad_request", "Google did not return the required OAuth values.", 400);
    await finishGoogleConnection(code, state);
    const site = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(c.req.url).origin;
    return c.redirect(`${site}/?settings=integrations&google=connected`);
  });

  app.post("/api/workers/reminders/due", async (c) => {
    requireCron(c);
    const { db } = getRuntime();
    const { data, error } = await db.from("task_reminders").select("id,remind_at").eq("status", "scheduled").lte("remind_at", new Date().toISOString()).limit(100);
    if (error) throw error;
    const results = [];
    for (const reminder of data ?? []) results.push(await deliverReminder(reminder.id, reminder.remind_at));
    return c.json({ data: { processed: results.length }, meta: { requestId: c.get("requestId") } });
  });

  app.post("/api/workers/outbox", async (c) => {
    requireCron(c);
    const { db } = getRuntime();
    const { data: events, error } = await db.from("outbox_events").select("*").in("status", ["pending", "retrying"])
      .lte("available_at", new Date().toISOString()).order("created_at").limit(100);
    if (error) throw error;
    let delivered = 0;
    for (const event of events ?? []) {
      try {
        await db.from("outbox_events").update({ status: "processing", attempt_count: event.attempt_count + 1 }).eq("id", event.id);
        await pushOutboxEvent(event);
        await db.from("outbox_events").update({ status: "delivered", processed_at: new Date().toISOString(), last_error: null }).eq("id", event.id);
        delivered += 1;
      } catch (eventError) {
        const terminal = event.attempt_count + 1 >= 8;
        await db.from("outbox_events").update({
          status: terminal ? "failed" : "retrying",
          available_at: new Date(Date.now() + Math.min(60, 2 ** event.attempt_count) * 60_000).toISOString(),
          last_error: eventError instanceof Error ? eventError.message : "Provider delivery failed",
        }).eq("id", event.id);
      }
    }
    return c.json({ data: { scanned: events?.length ?? 0, delivered }, meta: { requestId: c.get("requestId") } });
  });

  app.route("/api/mcp", createMcpApp());

  app.use("/api/v1/*", enforceOrigin, authenticate, agentRateLimit);

  app.get("/api/v1/workspace", async (c) => {
    const actor = c.get("actor");
    requireScope(actor, "tasks:read");
    const [lists, tasks, reminders] = await Promise.all([
      getRuntime().repository.listLists(actor, true),
      getRuntime().repository.listTasks(actor, { includeCompleted: true }),
      getRuntime().repository.listReminders(actor),
    ]);
    return success(c, { lists, tasks, reminders });
  });

  const webCommandSchema = z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("table"),
      table: z.enum(["user_state", "user_preferences", "lists", "tasks", "subtasks", "task_recurrence_rules"]),
      action: z.enum(["insert", "update", "delete"]),
      payload: z.unknown().optional(),
      filters: z.array(z.object({ field: z.enum(["id", "user_id", "task_id", "list_id"]), value: z.union([z.string(), z.number(), z.boolean()]) })).max(4).default([]),
    }),
    z.object({
      kind: z.literal("rpc"),
      name: z.enum([
        "reorder_lists", "reorder_tasks", "reorder_subtasks", "move_task", "set_task_completed",
        "complete_task_with_recurrence", "undo_recurring_completion", "clear_completed_tasks", "advance_recurring_task",
      ]),
      args: z.record(z.string(), z.unknown()),
    }),
  ]);

  app.post("/api/v1/web-command", async (c) => {
    const actor = c.get("actor");
    requireScope(actor, "tasks:write");
    if (actor.actorType !== "human" || !actor.accessToken) {
      throw new StickyDomainError("forbidden", "This compatibility endpoint is limited to the signed-in web app.", 403);
    }
    const body = await parseJson(c, webCommandSchema);
    return mutate(c, body, async () => {
      const db = getRuntime().db;
      if (body.kind === "rpc") {
        await authorizeWebRpc(body.args, actor.userId);
        const result = await db.rpc(body.name, {
          ...body.args,
          p_request_user_id: actor.userId,
        });
        if (result.error) throw new StickyDomainError("internal_error", result.error.message, 500, { databaseCode: result.error.code });
        await getRuntime().db.from("task_activity").insert({
          user_id: actor.userId,
          action: `web.${body.name}`,
          actor_type: "human",
          actor_id: actor.actorId,
          source: "web",
          request_id: actor.requestId,
          idempotency_key: actor.idempotencyKey,
          metadata: { args: body.args },
        });
        return { result: { data: result.data, error: null } };
      }

      validateWebCommandPayload(body.table, body.action, body.payload, actor.userId);
      if (body.action !== "insert" && body.filters.length === 0) {
        throw new StickyDomainError("validation_error", "Update and delete commands require a record filter.", 422);
      }
      let result: { data: unknown; error: { message: string; code?: string } | null };
      if (body.action === "insert") {
        const rows = (Array.isArray(body.payload) ? body.payload : [body.payload]) as Array<Record<string, unknown>>;
        const ownedRows = rows.map((row) => ({ ...row, user_id: actor.userId }));
        result = await db.from(body.table).insert(Array.isArray(body.payload) ? ownedRows : ownedRows[0]).select("*");
      } else if (body.action === "update") {
        let query = db.from(body.table).update(body.payload as Record<string, unknown>).eq("user_id", actor.userId);
        for (const filter of body.filters) query = query.eq(filter.field, filter.value);
        result = await query.select("*");
      } else {
        let query = db.from(body.table).delete().eq("user_id", actor.userId);
        for (const filter of body.filters) query = query.eq(filter.field, filter.value);
        result = await query.select("*");
      }
      if (result.error) throw new StickyDomainError("internal_error", result.error.message, 500, { databaseCode: result.error.code });
      const changedRows = Array.isArray(result.data) ? result.data as Array<Record<string, unknown>> : [];
      await recordWebCommand(actor, body.table, body.action, changedRows);
      return { result: { data: result.data, error: null } };
    });
  });

  app.get("/api/v1/lists", async (c) => {
    const actor = c.get("actor"); requireScope(actor, "tasks:read");
    return success(c, { lists: await getRuntime().repository.listLists(actor, c.req.query("archived") === "include") });
  });
  app.post("/api/v1/lists", async (c) => {
    const actor = c.get("actor"); requireScope(actor, "tasks:write");
    const body = await parseJson(c, createListSchema);
    return mutate(c, body, async () => ({ list: await getRuntime().repository.createList(actor, body) }));
  });
  app.patch("/api/v1/lists/:id", async (c) => {
    const actor = c.get("actor"); requireScope(actor, "tasks:write");
    const body = await parseJson(c, updateListSchema);
    return mutate(c, body, async () => ({ list: await getRuntime().repository.updateList(actor, c.req.param("id"), body) }));
  });
  app.delete("/api/v1/lists/:id", async (c) => {
    const actor = c.get("actor");
    const body = await parseJson(c, z.object({ confirmation: destructiveConfirmationSchema }));
    requireDestructiveConfirmation(actor, body.confirmation, ["delete", c.req.param("id")]);
    return mutate(c, body, async () => { await getRuntime().repository.deleteList(actor, c.req.param("id")); return { deleted: true }; });
  });

  app.get("/api/v1/tasks", async (c) => {
    const actor = c.get("actor"); requireScope(actor, "tasks:read");
    return success(c, { tasks: await getRuntime().repository.listTasks(actor, {
      listId: c.req.query("listId"), query: c.req.query("q"), includeCompleted: c.req.query("completed") === "include",
    }) });
  });
  app.get("/api/v1/tasks/:id", async (c) => {
    const actor = c.get("actor"); requireScope(actor, "tasks:read");
    return success(c, { task: await getRuntime().repository.getTask(actor, c.req.param("id")) });
  });
  app.post("/api/v1/tasks", async (c) => {
    const actor = c.get("actor"); requireScope(actor, "tasks:write");
    const body = await parseJson(c, createTaskSchema);
    return mutate(c, body, async () => ({ task: await getRuntime().repository.createTask(actor, body) }));
  });
  app.patch("/api/v1/tasks/:id", async (c) => {
    const actor = c.get("actor"); requireScope(actor, "tasks:write");
    const body = await parseJson(c, updateTaskSchema);
    return mutate(c, body, async () => ({ task: await getRuntime().repository.updateTask(actor, c.req.param("id"), body) }));
  });
  app.post("/api/v1/tasks/:id/move", async (c) => {
    const actor = c.get("actor"); requireScope(actor, "tasks:write");
    const body = await parseJson(c, moveTaskSchema);
    return mutate(c, body, async () => ({ task: await getRuntime().repository.moveTask(actor, c.req.param("id"), body.targetListId, body.version) }));
  });
  app.post("/api/v1/tasks/:id/complete", async (c) => {
    const actor = c.get("actor"); requireScope(actor, "tasks:write");
    const body = await parseJson(c, completeTaskSchema);
    return mutate(c, body, async () => ({ task: await getRuntime().repository.setTaskCompleted(actor, c.req.param("id"), true, body.version) }));
  });
  app.post("/api/v1/tasks/:id/restore", async (c) => {
    const actor = c.get("actor"); requireScope(actor, "tasks:write");
    const body = await parseJson(c, completeTaskSchema);
    return mutate(c, body, async () => ({ task: await getRuntime().repository.setTaskCompleted(actor, c.req.param("id"), false, body.version) }));
  });
  app.delete("/api/v1/tasks/:id", async (c) => {
    const actor = c.get("actor");
    const body = await parseJson(c, z.object({ confirmation: destructiveConfirmationSchema }));
    requireDestructiveConfirmation(actor, body.confirmation, ["delete", c.req.param("id")]);
    return mutate(c, body, async () => { await getRuntime().repository.deleteTask(actor, c.req.param("id")); return { deleted: true }; });
  });
  app.post("/api/v1/tasks/:id/subtasks", async (c) => {
    const actor = c.get("actor"); requireScope(actor, "tasks:write");
    const body = await parseJson(c, createSubtaskSchema);
    return mutate(c, body, async () => ({ subtask: await getRuntime().repository.createSubtask(actor, c.req.param("id"), body) }));
  });

  app.get("/api/v1/reminders", async (c) => {
    const actor = c.get("actor"); requireScope(actor, "tasks:read");
    return success(c, { reminders: await getRuntime().repository.listReminders(actor, c.req.query("taskId")) });
  });
  app.post("/api/v1/tasks/:id/reminders", async (c) => {
    const actor = c.get("actor"); requireScope(actor, "tasks:write");
    const body = await parseJson(c, createReminderSchema);
    const task = await getRuntime().repository.getTask(actor, c.req.param("id"));
    const remindAt = resolveReminderTime(body, task);
    return mutate(c, body, async () => {
      const reminder = await getRuntime().repository.createReminder(actor, task.id, body, remindAt);
      let workflowRunId: string | null = null;
      if (process.env.WORKFLOW_ENABLED !== "false") {
        const run = await start(reminderWorkflow, [reminder.id, reminder.remindAt]);
        workflowRunId = run.runId;
        await getRuntime().db.from("task_reminders").update({ workflow_run_id: workflowRunId }).eq("id", reminder.id);
      }
      return { reminder, workflowRunId };
    });
  });
  app.post("/api/v1/reminders/:id/snooze", async (c) => {
    const actor = c.get("actor"); requireScope(actor, "tasks:write");
    const body = await parseJson(c, snoozeReminderSchema);
    return mutate(c, body, async () => {
      const reminder = await getRuntime().repository.snoozeReminder(actor, c.req.param("id"), body.version, body.remindAt);
      let workflowRunId: string | null = null;
      if (process.env.WORKFLOW_ENABLED !== "false") {
        const run = await start(reminderWorkflow, [reminder.id, reminder.remindAt]);
        workflowRunId = run.runId;
        await getRuntime().db.from("task_reminders").update({ workflow_run_id: workflowRunId }).eq("id", reminder.id);
      }
      return { reminder, workflowRunId };
    });
  });

  app.post("/api/v1/push-subscriptions", async (c) => {
    const actor = c.get("actor"); requireScope(actor, "tasks:write");
    const body = await parseJson(c, z.object({ endpoint: z.url(), keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }), deviceName: z.string().max(100).optional(), userAgent: z.string().max(500).optional() }));
    return mutate(c, body, async () => {
      const { data, error } = await getRuntime().db.from("push_subscriptions").upsert({ user_id: actor.userId, endpoint: body.endpoint, p256dh: body.keys.p256dh, auth_secret: body.keys.auth, device_name: body.deviceName, user_agent: body.userAgent, is_active: true }, { onConflict: "user_id,endpoint" }).select("id").single();
      if (error) throw error;
      return { subscriptionId: data.id };
    });
  });

  app.get("/api/v1/integrations", async (c) => {
    const actor = c.get("actor"); requireScope(actor, "integrations:read");
    const { data, error } = await getRuntime().db.from("integration_accounts").select("id,provider,provider_email,status,connected_at,last_error,updated_at").eq("user_id", actor.userId);
    if (error) throw error;
    return success(c, {
      integrations: data,
      capabilities: {
        googleTasks: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
        pokeDelivery: Boolean(process.env.POKE_API_KEY),
        webPush: Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
      },
    });
  });
  app.post("/api/v1/integrations/google/connect", async (c) => {
    const actor = c.get("actor"); requireScope(actor, "integrations:write");
    return success(c, { authorizationUrl: googleAuthorizationUrl(actor) });
  });
  app.get("/api/v1/integrations/google/lists", async (c) => {
    const actor = c.get("actor"); requireScope(actor, "integrations:read");
    return success(c, { lists: await listGoogleTaskLists(actor) });
  });
  app.post("/api/v1/integrations/google/lists", async (c) => {
    const actor = c.get("actor"); requireScope(actor, "integrations:write");
    const body = await parseJson(c, googleListSelectionSchema);
    return mutate(c, body, async () => {
      const selection = await selectGoogleLists(actor, body.externalListIds);
      const run = process.env.WORKFLOW_ENABLED === "false" ? null : await start(googleSyncWorkflow, [actor.userId]);
      return { ...selection, workflowRunId: run?.runId ?? null };
    });
  });
  app.post("/api/v1/integrations/google/sync", async (c) => {
    const actor = c.get("actor"); requireScope(actor, "integrations:write");
    return mutate(c, {}, () => syncGoogle(actor));
  });
  app.delete("/api/v1/integrations/google", async (c) => {
    const actor = c.get("actor"); requireScope(actor, "integrations:write");
    return mutate(c, {}, async () => {
      const { error } = await getRuntime().db.from("integration_accounts").update({ status: "revoked", encrypted_credentials: null }).eq("user_id", actor.userId).eq("provider", "google_tasks");
      if (error) throw error;
      return { disconnected: true, stickyDataPreserved: true };
    });
  });

  app.get("/api/v1/credentials", async (c) => {
    const actor = c.get("actor"); requireScope(actor, "credentials:manage");
    const { data, error } = await getRuntime().db.from("api_credentials").select("id,name,provider,provider_user_id,token_prefix,scopes,last_used_at,expires_at,revoked_at,created_at").eq("user_id", actor.userId).order("created_at", { ascending: false });
    if (error) throw error;
    return success(c, { credentials: data });
  });
  app.post("/api/v1/credentials", async (c) => {
    const actor = c.get("actor"); requireScope(actor, "credentials:manage");
    const body = await parseJson(c, apiCredentialCreateSchema);
    return mutate(c, body, async () => {
      const id = crypto.randomUUID();
      const credential = createCredentialToken(id);
      const { error } = await getRuntime().db.from("api_credentials").insert({ id, user_id: actor.userId, name: body.name, provider: body.provider, provider_user_id: body.providerUserId, token_prefix: credential.tokenPrefix, token_hash: credential.tokenHash, scopes: body.scopes });
      if (error) throw error;
      return {
        id,
        token: credential.token,
        tokenPrefix: credential.tokenPrefix,
        scopes: body.scopes,
        mcpUrl: `${process.env.NEXT_PUBLIC_SITE_URL ?? new URL(c.req.url).origin}/api/mcp`,
      };
    });
  });
  app.delete("/api/v1/credentials/:id", async (c) => {
    const actor = c.get("actor"); requireScope(actor, "credentials:manage");
    return mutate(c, {}, async () => {
      const { error } = await getRuntime().db.from("api_credentials").update({ revoked_at: new Date().toISOString() }).eq("id", c.req.param("id")).eq("user_id", actor.userId);
      if (error) throw error;
      return { revoked: true };
    });
  });

  return app;
}

export type StickyApiApp = ReturnType<typeof createApiApp>;
