import { google, tasks_v1 } from "googleapis";
import type { ActorContext } from "@sticky/contracts";
import { fromGoogleTask, resolveFieldConflict, toGoogleTask } from "@sticky/domain";
import { getRuntime } from "../runtime";
import { decryptJson, encryptJson, signState, verifyState } from "./encryption";

type GoogleCredentials = {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
  scope?: string;
  token_type?: string | null;
};

type ExternalTaskLink = {
  integrationAccountId: string;
  externalListId: string;
  externalTaskId: string;
};

function normalizedTaskPayload(payload: Record<string, unknown>) {
  return {
    title: String(payload.title ?? "Untitled task"),
    details: String(payload.details ?? ""),
    dueDate: (payload.dueDate ?? payload.due_date ?? null) as string | null,
    isCompleted: Boolean(payload.isCompleted ?? payload.is_completed),
  };
}

function googleErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  if ("code" in error && Number.isFinite(Number(error.code))) return Number(error.code);
  if ("response" in error && error.response && typeof error.response === "object" && "status" in error.response) {
    return Number(error.response.status);
  }
  return null;
}

function oauthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? `${process.env.NEXT_PUBLIC_SITE_URL}/api/webhooks/google/oauth`;
  if (!clientId || !clientSecret || !redirectUri) throw new Error("Google Tasks OAuth is not configured.");
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function googleAuthorizationUrl(actor: ActorContext): string {
  const state = signState({ userId: actor.userId, requestId: actor.requestId, expiresAt: Date.now() + 10 * 60_000 });
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope: ["openid", "email", "https://www.googleapis.com/auth/tasks"],
    state,
  });
}

export async function finishGoogleConnection(code: string, state: string) {
  const payload = verifyState<{ userId: string; requestId: string; expiresAt: number }>(state);
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const { data: profile } = await oauth2.userinfo.get();
  const { db } = getRuntime();
  const { data, error } = await db.from("integration_accounts").upsert({
    user_id: payload.userId,
    provider: "google_tasks",
    provider_account_id: profile.id,
    provider_email: profile.email,
    encrypted_credentials: encryptJson(tokens),
    granted_scopes: tokens.scope?.split(" ") ?? [],
    status: "healthy",
    connected_at: new Date().toISOString(),
    last_error: null,
  }, { onConflict: "user_id,provider" }).select("id").single();
  if (error) throw error;
  return { userId: payload.userId, accountId: data.id };
}

async function googleClientForAccount(account: Record<string, unknown>) {
  const client = oauthClient();
  const credentials = decryptJson<GoogleCredentials>(String(account.encrypted_credentials));
  client.setCredentials(credentials);
  client.on("tokens", async (tokens) => {
    const next = { ...credentials, ...tokens, refresh_token: tokens.refresh_token ?? credentials.refresh_token };
    await getRuntime().db.from("integration_accounts").update({ encrypted_credentials: encryptJson(next) }).eq("id", account.id);
  });
  return new tasks_v1.Tasks({ auth: client });
}

export async function listGoogleTaskLists(actor: ActorContext) {
  const account = await getGoogleAccount(actor.userId);
  const tasks = await googleClientForAccount(account);
  const result: tasks_v1.Schema$TaskList[] = [];
  let pageToken: string | undefined;
  do {
    const response = await tasks.tasklists.list({ maxResults: 100, pageToken });
    result.push(...(response.data.items ?? []));
    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);
  return result.map((list) => ({ id: list.id, title: list.title, updated: list.updated }));
}

export async function selectGoogleLists(actor: ActorContext, externalListIds: string[]) {
  const account = await getGoogleAccount(actor.userId);
  const tasksApi = await googleClientForAccount(account);
  const available = await listGoogleTaskLists(actor);
  const selected = available.filter((list) => list.id && externalListIds.includes(list.id));
  const { db, repository } = getRuntime();

  for (const externalList of selected) {
    if (!externalList.id) continue;
    const { data: existing } = await db.from("integration_list_links").select("list_id")
      .eq("integration_account_id", account.id).eq("external_list_id", externalList.id).maybeSingle();
    const list = existing
      ? await repository.getList(actor, existing.list_id)
      : await repository.createList(actor, { name: externalList.title || "Google Tasks", color: "sun" });
    await db.from("integration_list_links").upsert({
      user_id: actor.userId,
      integration_account_id: account.id,
      list_id: list.id,
      external_list_id: externalList.id,
      sync_enabled: true,
      external_updated_at: externalList.updated,
    }, { onConflict: "integration_account_id,external_list_id" });
    await pullGoogleList(actor, account, tasksApi, externalList.id, list.id);
  }
  let deselect = db.from("integration_list_links").update({ sync_enabled: false })
    .eq("integration_account_id", account.id);
  if (externalListIds.length) {
    deselect = deselect.not("external_list_id", "in", `(${externalListIds.map((id) => `\"${id}\"`).join(",")})`);
  }
  const { error: deselectError } = await deselect;
  if (deselectError) throw deselectError;
  return { selected: selected.length };
}

export async function syncGoogle(actor: ActorContext) {
  const account = await getGoogleAccount(actor.userId);
  const tasksApi = await googleClientForAccount(account);
  const { data: links, error } = await getRuntime().db.from("integration_list_links").select("*")
    .eq("integration_account_id", account.id).eq("sync_enabled", true);
  if (error) throw error;
  for (const link of links ?? []) await pullGoogleList(actor, account, tasksApi, link.external_list_id, link.list_id);
  await getRuntime().db.from("integration_accounts").update({ status: "healthy", last_error: null }).eq("id", account.id);
  return { syncedLists: links?.length ?? 0 };
}

async function pullGoogleList(
  actor: ActorContext,
  account: Record<string, unknown>,
  tasksApi: tasks_v1.Tasks,
  externalListId: string,
  stickyListId: string,
) {
  const { db, repository } = getRuntime();
  const { data: state } = await db.from("integration_sync_state").select("*")
    .eq("integration_account_id", account.id).eq("external_list_id", externalListId).maybeSingle();
  let pageToken: string | undefined;
  let newestUpdated = state?.cursor as string | undefined;
  do {
    const response = await tasksApi.tasks.list({
      tasklist: externalListId,
      maxResults: 100,
      pageToken,
      showCompleted: true,
      showDeleted: true,
      showHidden: true,
      updatedMin: state?.cursor || undefined,
    });
    for (const remote of response.data.items ?? []) {
      if (!remote.id) continue;
      const { data: mapping } = await db.from("integration_task_links").select("*")
        .eq("integration_account_id", account.id).eq("external_list_id", externalListId).eq("external_task_id", remote.id).maybeSingle();
      if (remote.deleted) {
        if (mapping) await repository.deleteTask(actor, mapping.task_id);
        continue;
      }
      const remoteTask = fromGoogleTask(remote);
      if (!mapping) {
        const created = await repository.createTask(actor, { listId: stickyListId, ...remoteTask, color: "sun", dueTime: null, timezone: "America/Chicago" });
        await db.from("integration_task_links").insert({
          user_id: actor.userId,
          integration_account_id: account.id,
          task_id: created.id,
          external_task_id: remote.id,
          external_list_id: externalListId,
          external_parent_id: remote.parent,
          external_position: remote.position,
          sync_snapshot: remoteTask,
          external_updated_at: remote.updated,
        });
      } else {
        const local = await repository.getTask(actor, mapping.task_id);
        const base = mapping.sync_snapshot as ReturnType<typeof fromGoogleTask>;
        const resolved = resolveFieldConflict(
          base,
          { title: local.title, details: local.details, dueDate: local.dueDate, isCompleted: local.isCompleted },
          remoteTask,
          local.updatedAt,
          remote.updated ?? local.updatedAt,
        );
        let next = local;
        const updates = { version: local.version, title: resolved.value.title, details: resolved.value.details, dueDate: resolved.value.dueDate };
        next = await repository.updateTask(actor, local.id, updates);
        if (next.isCompleted !== resolved.value.isCompleted) next = await repository.setTaskCompleted(actor, next.id, resolved.value.isCompleted, next.version);
        await db.from("integration_task_links").update({ sync_snapshot: resolved.value, external_updated_at: remote.updated })
          .eq("id", mapping.id);
        if (resolved.conflicts.length) await db.from("task_activity").insert({
          user_id: actor.userId,
          task_id: local.id,
          list_id: local.listId,
          action: "integration.conflict_resolved",
          actor_type: "google",
          actor_id: String(account.id),
          source: "google_tasks",
          request_id: actor.requestId,
          metadata: { fields: resolved.conflicts, winner: remote.updated && remote.updated > local.updatedAt ? "google" : "sticky" },
        });
      }
      if (remote.updated && (!newestUpdated || remote.updated > newestUpdated)) newestUpdated = remote.updated;
    }
    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);
  await db.from("integration_sync_state").upsert({
    user_id: actor.userId,
    integration_account_id: account.id,
    external_list_id: externalListId,
    cursor: newestUpdated,
    last_started_at: new Date().toISOString(),
    last_succeeded_at: new Date().toISOString(),
    last_error: null,
    consecutive_failures: 0,
  }, { onConflict: "integration_account_id,external_list_id" });
}

export async function pushOutboxEvent(event: Record<string, unknown>) {
  const { db } = getRuntime();
  if (event.aggregate_type !== "task") return;

  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const stickyTask = normalizedTaskPayload(payload);
  const targetStickyListId = String(payload.listId ?? payload.list_id ?? "");
  const { data: links, error: linksError } = await db.from("integration_task_links").select("*,integration_accounts(*)")
    .eq("task_id", event.aggregate_id);
  if (linksError) throw linksError;

  if (event.event_type === "task.deleted") {
    const captured = Array.isArray(payload.externalLinks) ? payload.externalLinks as ExternalTaskLink[] : [];
    const linked = (links ?? []).map((link) => ({
      integrationAccountId: String(link.integration_account_id),
      externalListId: String(link.external_list_id),
      externalTaskId: String(link.external_task_id),
    }));
    const deleteLinks = [...captured, ...linked].filter((link, index, all) =>
      all.findIndex((candidate) => candidate.integrationAccountId === link.integrationAccountId && candidate.externalTaskId === link.externalTaskId) === index,
    );
    for (const link of deleteLinks) {
      const { data: account, error } = await db.from("integration_accounts").select("*").eq("id", link.integrationAccountId).maybeSingle();
      if (error) throw error;
      if (!account || account.provider !== "google_tasks" || account.status === "revoked") continue;
      const tasksApi = await googleClientForAccount(account as Record<string, unknown>);
      try {
        await tasksApi.tasks.delete({ tasklist: link.externalListId, task: link.externalTaskId });
      } catch (deleteError) {
        if (![404, 410].includes(googleErrorStatus(deleteError) ?? 0)) throw deleteError;
      }
    }
    return;
  }

  if (!links?.length) {
    if (!targetStickyListId) return;
    const { data: listLinks, error } = await db.from("integration_list_links").select("*,integration_accounts(*)")
      .eq("list_id", targetStickyListId).eq("sync_enabled", true);
    if (error) throw error;
    for (const listLink of listLinks ?? []) {
      const account = listLink.integration_accounts as Record<string, unknown>;
      if (account.provider !== "google_tasks" || account.status === "revoked") continue;
      const tasksApi = await googleClientForAccount(account);
      const response = await tasksApi.tasks.insert({
        tasklist: listLink.external_list_id,
        requestBody: toGoogleTask(stickyTask),
      });
      if (!response.data.id) throw new Error("Google Tasks did not return an id for the new task.");
      await db.from("integration_task_links").upsert({
        user_id: event.user_id,
        integration_account_id: account.id,
        task_id: event.aggregate_id,
        external_task_id: response.data.id,
        external_list_id: listLink.external_list_id,
        external_parent_id: response.data.parent,
        external_position: response.data.position,
        sync_snapshot: stickyTask,
        external_updated_at: response.data.updated,
      }, { onConflict: "integration_account_id,task_id" });
    }
    return;
  }

  for (const link of links) {
    const account = link.integration_accounts as Record<string, unknown>;
    if (account.provider !== "google_tasks" || account.status === "revoked") continue;
    const tasksApi = await googleClientForAccount(account);

    const { data: targetListLink } = targetStickyListId
      ? await db.from("integration_list_links").select("external_list_id").eq("integration_account_id", account.id)
        .eq("list_id", targetStickyListId).eq("sync_enabled", true).maybeSingle()
      : { data: null };

    if (targetListLink && targetListLink.external_list_id !== link.external_list_id) {
      const inserted = await tasksApi.tasks.insert({
        tasklist: targetListLink.external_list_id,
        requestBody: toGoogleTask(stickyTask),
      });
      if (!inserted.data.id) throw new Error("Google Tasks did not return an id after moving the task.");
      try {
        await tasksApi.tasks.delete({ tasklist: link.external_list_id, task: link.external_task_id });
      } catch (deleteError) {
        if (![404, 410].includes(googleErrorStatus(deleteError) ?? 0)) throw deleteError;
      }
      await db.from("integration_task_links").update({
        external_task_id: inserted.data.id,
        external_list_id: targetListLink.external_list_id,
        external_parent_id: inserted.data.parent,
        external_position: inserted.data.position,
        sync_snapshot: stickyTask,
        external_updated_at: inserted.data.updated,
      }).eq("id", link.id);
      continue;
    }

    const response = await tasksApi.tasks.update({
      tasklist: link.external_list_id,
      task: link.external_task_id,
      requestBody: toGoogleTask(stickyTask),
    });
    await db.from("integration_task_links").update({
      sync_snapshot: stickyTask,
      external_updated_at: response.data.updated,
      external_position: response.data.position,
    }).eq("id", link.id);
  }
}

async function getGoogleAccount(userId: string): Promise<Record<string, unknown>> {
  const { data, error } = await getRuntime().db.from("integration_accounts").select("*")
    .eq("user_id", userId).eq("provider", "google_tasks").eq("status", "healthy").maybeSingle();
  if (error || !data) throw new Error("Google Tasks is not connected.");
  return data as Record<string, unknown>;
}
