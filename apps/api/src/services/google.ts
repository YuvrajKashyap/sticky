import { calendar_v3, google, tasks_v1 } from "googleapis";
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

type ExternalEventLink = {
  integrationAccountId: string;
  externalCalendarId: string;
  externalEventId: string;
};

function normalizedTaskPayload(payload: Record<string, unknown>) {
  return {
    title: String(payload.title ?? "Untitled task"),
    details: String(payload.details ?? ""),
    dueDate: (payload.dueDate ?? payload.due_date ?? null) as string | null,
    isCompleted: Boolean(payload.isCompleted ?? payload.is_completed),
  };
}

function normalizedCalendarEventPayload(payload: Record<string, unknown>) {
  return {
    title: String(payload.title ?? "Untitled event"),
    details: String(payload.details ?? ""),
    location: String(payload.location ?? ""),
    allDay: Boolean(payload.allDay ?? payload.all_day),
    startAt: (payload.startAt ?? payload.start_at ?? null) as string | null,
    endAt: (payload.endAt ?? payload.end_at ?? null) as string | null,
    startDate: (payload.startDate ?? payload.start_date ?? null) as string | null,
    endDate: (payload.endDate ?? payload.end_date ?? null) as string | null,
    timezone: String(payload.timezone ?? "America/Chicago"),
    recurrence: Array.isArray(payload.recurrence) ? payload.recurrence.map(String) : [],
    status: String(payload.status ?? "confirmed") as "confirmed" | "tentative" | "cancelled",
    transparency: String(payload.transparency ?? "opaque") as "opaque" | "transparent",
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

function isGoogleAccount(account: Record<string, unknown>): boolean {
  return account.provider === "google_workspace" || account.provider === "google_tasks";
}

function hasGoogleCalendarScopes(account: Record<string, unknown>): boolean {
  const scopes = Array.isArray(account.granted_scopes) ? account.granted_scopes.map(String) : [];
  return scopes.some((scope) => scope === "https://www.googleapis.com/auth/calendar" || scope === "https://www.googleapis.com/auth/calendar.events");
}

function oauthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? `${process.env.NEXT_PUBLIC_SITE_URL}/api/webhooks/google/oauth`;
  if (!clientId || !clientSecret || !redirectUri) throw new Error("Google Workspace OAuth is not configured.");
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function googleAuthorizationUrl(actor: ActorContext): string {
  const state = signState({ userId: actor.userId, requestId: actor.requestId, expiresAt: Date.now() + 10 * 60_000 });
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope: [
      "openid",
      "email",
      "https://www.googleapis.com/auth/tasks",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    ],
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
    provider: "google_workspace",
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

async function googleAuthForAccount(account: Record<string, unknown>) {
  const client = oauthClient();
  const credentials = decryptJson<GoogleCredentials>(String(account.encrypted_credentials));
  client.setCredentials(credentials);
  client.on("tokens", async (tokens) => {
    const next = { ...credentials, ...tokens, refresh_token: tokens.refresh_token ?? credentials.refresh_token };
    await getRuntime().db.from("integration_accounts").update({ encrypted_credentials: encryptJson(next) }).eq("id", account.id);
  });
  return client;
}

async function googleTasksForAccount(account: Record<string, unknown>) {
  return new tasks_v1.Tasks({ auth: await googleAuthForAccount(account) });
}

async function googleCalendarForAccount(account: Record<string, unknown>) {
  return new calendar_v3.Calendar({ auth: await googleAuthForAccount(account) });
}

export async function listGoogleTaskLists(actor: ActorContext) {
  const account = await getGoogleAccount(actor.userId);
  const tasks = await googleTasksForAccount(account);
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
  const tasksApi = await googleTasksForAccount(account);
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

export async function listGoogleCalendars(actor: ActorContext) {
  const account = await getGoogleAccount(actor.userId);
  if (!hasGoogleCalendarScopes(account)) return [];
  const calendarApi = await googleCalendarForAccount(account);
  const result: calendar_v3.Schema$CalendarListEntry[] = [];
  let pageToken: string | undefined;
  do {
    const response = await calendarApi.calendarList.list({ maxResults: 250, pageToken, showHidden: false });
    result.push(...(response.data.items ?? []));
    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);
  return result.filter((item) => item.id).map((item) => ({
    id: item.id,
    name: item.summaryOverride || item.summary || "Google Calendar",
    description: item.description ?? "",
    timezone: item.timeZone ?? "America/Chicago",
    primary: Boolean(item.primary),
    accessRole: item.accessRole,
    backgroundColor: item.backgroundColor,
    selected: item.selected !== false,
  }));
}

type GoogleCalendarSelection = {
  externalCalendarId: string;
  calendarId?: string;
  name?: string;
  syncDirection: "two_way" | "import_only" | "export_only";
  isDefaultTarget: boolean;
};

export async function selectGoogleCalendars(actor: ActorContext, selections: GoogleCalendarSelection[]) {
  const account = await getGoogleAccount(actor.userId);
  if (!hasGoogleCalendarScopes(account)) throw new Error("Reconnect Google to grant Calendar access.");
  const available = await listGoogleCalendars(actor);
  const byId = new Map(available.map((item) => [item.id, item]));
  const selected = selections.filter((item) => byId.has(item.externalCalendarId));
  const { db, repository } = getRuntime();
  const { data: existingLinks, error: linksError } = await db.from("integration_calendar_links").select("*")
    .eq("integration_account_id", account.id);
  if (linksError) throw linksError;

  const requestedDefault = selected.find((item) => item.isDefaultTarget)?.externalCalendarId
    ?? selected.find((item) => byId.get(item.externalCalendarId)?.primary)?.externalCalendarId
    ?? selected[0]?.externalCalendarId;
  await db.from("integration_calendar_links").update({ is_default_target: false }).eq("integration_account_id", account.id);

  for (const [index, selection] of selected.entries()) {
    const remote = byId.get(selection.externalCalendarId)!;
    const existing = (existingLinks ?? []).find((item) => item.external_calendar_id === selection.externalCalendarId);
    const calendar = existing
      ? await repository.getCalendar(actor, existing.calendar_id)
      : selection.calendarId
        ? await repository.getCalendar(actor, selection.calendarId)
        : index === 0 && !(existingLinks ?? []).length
          ? await repository.ensureDefaultCalendar(actor)
          : await repository.createCalendar(actor, { name: selection.name || remote.name, timezone: remote.timezone });
    const { error } = await db.from("integration_calendar_links").upsert({
      user_id: actor.userId,
      integration_account_id: account.id,
      calendar_id: calendar.id,
      external_calendar_id: selection.externalCalendarId,
      sync_enabled: true,
      sync_direction: selection.syncDirection,
      is_default_target: selection.externalCalendarId === requestedDefault,
    }, { onConflict: "integration_account_id,external_calendar_id" });
    if (error) throw error;
    if (selection.syncDirection !== "export_only") {
      await pullGoogleCalendar(actor, account, selection.externalCalendarId, calendar.id);
    }
  }

  const externalIds = selected.map((item) => item.externalCalendarId);
  let deselect = db.from("integration_calendar_links").update({ sync_enabled: false, is_default_target: false })
    .eq("integration_account_id", account.id);
  if (externalIds.length) deselect = deselect.not("external_calendar_id", "in", `(${externalIds.map((id) => `"${id}"`).join(",")})`);
  const { error: deselectError } = await deselect;
  if (deselectError) throw deselectError;
  return { selected: selected.length, defaultExternalCalendarId: requestedDefault ?? null };
}

export async function syncGoogle(actor: ActorContext) {
  const account = await getGoogleAccount(actor.userId);
  const tasksApi = await googleTasksForAccount(account);
  const { data: links, error } = await getRuntime().db.from("integration_list_links").select("*")
    .eq("integration_account_id", account.id).eq("sync_enabled", true);
  if (error) throw error;
  for (const link of links ?? []) await pullGoogleList(actor, account, tasksApi, link.external_list_id, link.list_id);
  let syncedCalendars = 0;
  if (hasGoogleCalendarScopes(account)) {
    const { data: calendarLinks, error: calendarError } = await getRuntime().db.from("integration_calendar_links").select("*")
      .eq("integration_account_id", account.id).eq("sync_enabled", true).neq("sync_direction", "export_only");
    if (calendarError) throw calendarError;
    for (const link of calendarLinks ?? []) {
      await pullGoogleCalendar(actor, account, link.external_calendar_id, link.calendar_id);
    }
    syncedCalendars = calendarLinks?.length ?? 0;
  }
  await getRuntime().db.from("integration_accounts").update({ status: "healthy", last_error: null }).eq("id", account.id);
  return { syncedLists: links?.length ?? 0, syncedCalendars };
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

function fromGoogleCalendarEvent(remote: calendar_v3.Schema$Event) {
  const allDay = Boolean(remote.start?.date);
  const startAt = remote.start?.dateTime ?? null;
  const endAt = remote.end?.dateTime ?? null;
  const startDate = remote.start?.date ?? null;
  const endDate = remote.end?.date ?? null;
  if (allDay ? !startDate || !endDate : !startAt || !endAt) return null;
  return {
    title: remote.summary || "Untitled event",
    details: remote.description ?? "",
    location: remote.location ?? "",
    allDay,
    startAt,
    endAt,
    startDate,
    endDate,
    timezone: remote.start?.timeZone || remote.end?.timeZone || "America/Chicago",
    recurrence: remote.recurrence ?? [],
    status: (remote.status === "tentative" ? "tentative" : remote.status === "cancelled" ? "cancelled" : "confirmed") as "confirmed" | "tentative" | "cancelled",
    transparency: (remote.transparency === "transparent" ? "transparent" : "opaque") as "transparent" | "opaque",
  };
}

async function pullGoogleCalendar(
  actor: ActorContext,
  account: Record<string, unknown>,
  externalCalendarId: string,
  stickyCalendarId: string,
  forceFull = false,
) {
  const { db, repository } = getRuntime();
  const calendarApi = await googleCalendarForAccount(account);
  const { data: state, error: stateError } = await db.from("integration_calendar_sync_state").select("*")
    .eq("integration_account_id", account.id).eq("external_calendar_id", externalCalendarId).maybeSingle();
  if (stateError) throw stateError;
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;
  const syncToken = forceFull ? undefined : state?.sync_token ?? undefined;

  try {
    do {
      const response = await calendarApi.events.list({
        calendarId: externalCalendarId,
        maxResults: 2500,
        pageToken,
        showDeleted: true,
        singleEvents: true,
        ...(syncToken ? { syncToken } : {
          orderBy: "startTime" as const,
          timeMin: new Date(Date.now() - 366 * 24 * 60 * 60_000).toISOString(),
          timeMax: new Date(Date.now() + 3 * 366 * 24 * 60 * 60_000).toISOString(),
        }),
      });
      for (const remote of response.data.items ?? []) {
        if (!remote.id) continue;
        const { data: mapping, error: mappingError } = await db.from("integration_event_links").select("*")
          .eq("integration_account_id", account.id)
          .eq("external_calendar_id", externalCalendarId)
          .eq("external_event_id", remote.id)
          .maybeSingle();
        if (mappingError) throw mappingError;
        if (remote.status === "cancelled") {
          if (mapping) await repository.deleteCalendarEvent(actor, mapping.event_id);
          continue;
        }
        const remoteEvent = fromGoogleCalendarEvent(remote);
        if (!remoteEvent) continue;
        if (!mapping) {
          const schedule = remoteEvent.allDay
            ? { allDay: true as const, startDate: remoteEvent.startDate!, endDate: remoteEvent.endDate! }
            : { allDay: false as const, startAt: remoteEvent.startAt!, endAt: remoteEvent.endAt! };
          const created = await repository.createCalendarEvent(actor, {
            calendarId: stickyCalendarId,
            taskId: null,
            title: remoteEvent.title,
            details: remoteEvent.details,
            location: remoteEvent.location,
            timezone: remoteEvent.timezone,
            recurrence: remoteEvent.recurrence,
            status: remoteEvent.status,
            transparency: remoteEvent.transparency,
            color: null,
            ...schedule,
          });
          const { error } = await db.from("integration_event_links").insert({
            user_id: actor.userId,
            integration_account_id: account.id,
            event_id: created.id,
            external_calendar_id: externalCalendarId,
            external_event_id: remote.id,
            external_etag: remote.etag,
            external_html_link: remote.htmlLink,
            sync_snapshot: remoteEvent,
            external_updated_at: remote.updated,
          });
          if (error) throw error;
        } else {
          const local = await repository.getCalendarEvent(actor, mapping.event_id);
          const localEvent = normalizedCalendarEventPayload(local as unknown as Record<string, unknown>);
          const shouldApplyRemote = !remote.updated || remote.updated >= local.updatedAt;
          if (shouldApplyRemote && JSON.stringify(localEvent) !== JSON.stringify(remoteEvent)) {
            await repository.updateCalendarEvent(actor, local.id, {
              version: local.version,
              title: remoteEvent.title,
              details: remoteEvent.details,
              location: remoteEvent.location,
              allDay: remoteEvent.allDay,
              startAt: remoteEvent.startAt,
              endAt: remoteEvent.endAt,
              startDate: remoteEvent.startDate,
              endDate: remoteEvent.endDate,
              timezone: remoteEvent.timezone,
              recurrence: remoteEvent.recurrence,
              status: remoteEvent.status,
              transparency: remoteEvent.transparency,
            });
          }
          const { error } = await db.from("integration_event_links").update({
            external_etag: remote.etag,
            external_html_link: remote.htmlLink,
            sync_snapshot: remoteEvent,
            external_updated_at: remote.updated,
          }).eq("id", mapping.id);
          if (error) throw error;
        }
      }
      pageToken = response.data.nextPageToken ?? undefined;
      nextSyncToken = response.data.nextSyncToken ?? nextSyncToken;
    } while (pageToken);
  } catch (error) {
    if (!forceFull && googleErrorStatus(error) === 410) {
      await db.from("integration_calendar_sync_state").update({ sync_token: null }).eq("integration_account_id", account.id).eq("external_calendar_id", externalCalendarId);
      return pullGoogleCalendar(actor, account, externalCalendarId, stickyCalendarId, true);
    }
    await db.from("integration_calendar_sync_state").upsert({
      user_id: actor.userId,
      integration_account_id: account.id,
      external_calendar_id: externalCalendarId,
      last_started_at: new Date().toISOString(),
      last_error_at: new Date().toISOString(),
      last_error: error instanceof Error ? error.message : "Google Calendar sync failed",
      consecutive_failures: Number(state?.consecutive_failures ?? 0) + 1,
    }, { onConflict: "integration_account_id,external_calendar_id" });
    throw error;
  }

  const { error: syncError } = await db.from("integration_calendar_sync_state").upsert({
    user_id: actor.userId,
    integration_account_id: account.id,
    external_calendar_id: externalCalendarId,
    sync_token: nextSyncToken ?? state?.sync_token ?? null,
    last_started_at: new Date().toISOString(),
    last_succeeded_at: new Date().toISOString(),
    last_error: null,
    consecutive_failures: 0,
  }, { onConflict: "integration_account_id,external_calendar_id" });
  if (syncError) throw syncError;
}

function toGoogleCalendarEvent(event: ReturnType<typeof normalizedCalendarEventPayload>): calendar_v3.Schema$Event {
  return {
    summary: event.title,
    description: event.details || undefined,
    location: event.location || undefined,
    status: event.status,
    transparency: event.transparency,
    recurrence: event.recurrence.length ? event.recurrence : undefined,
    start: event.allDay
      ? { date: event.startDate ?? undefined }
      : { dateTime: event.startAt ?? undefined, timeZone: event.timezone },
    end: event.allDay
      ? { date: event.endDate ?? undefined }
      : { dateTime: event.endAt ?? undefined, timeZone: event.timezone },
  };
}

async function calendarLinkAllowsExport(integrationAccountId: string, externalCalendarId: string): Promise<boolean> {
  const { data, error } = await getRuntime().db.from("integration_calendar_links").select("sync_enabled,sync_direction")
    .eq("integration_account_id", integrationAccountId).eq("external_calendar_id", externalCalendarId).maybeSingle();
  if (error) throw error;
  return Boolean(data?.sync_enabled && data.sync_direction !== "import_only");
}

async function pushCalendarOutboxEvent(event: Record<string, unknown>) {
  const { db } = getRuntime();
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const stickyEvent = normalizedCalendarEventPayload(payload);
  const stickyCalendarId = String(payload.calendarId ?? payload.calendar_id ?? "");
  const { data: links, error: linksError } = await db.from("integration_event_links").select("*,integration_accounts(*)")
    .eq("event_id", event.aggregate_id);
  if (linksError) throw linksError;

  if (event.event_type === "calendar_event.deleted") {
    const captured = Array.isArray(payload.externalLinks) ? payload.externalLinks as ExternalEventLink[] : [];
    const linked = (links ?? []).map((link) => ({
      integrationAccountId: String(link.integration_account_id),
      externalCalendarId: String(link.external_calendar_id),
      externalEventId: String(link.external_event_id),
    }));
    const deleteLinks = [...captured, ...linked].filter((link, index, all) =>
      all.findIndex((candidate) => candidate.integrationAccountId === link.integrationAccountId && candidate.externalCalendarId === link.externalCalendarId && candidate.externalEventId === link.externalEventId) === index,
    );
    for (const link of deleteLinks) {
      if (!(await calendarLinkAllowsExport(link.integrationAccountId, link.externalCalendarId))) continue;
      const { data: account, error } = await db.from("integration_accounts").select("*").eq("id", link.integrationAccountId).maybeSingle();
      if (error) throw error;
      if (!account || !isGoogleAccount(account as Record<string, unknown>) || account.status === "revoked") continue;
      const calendarApi = await googleCalendarForAccount(account as Record<string, unknown>);
      try {
        await calendarApi.events.delete({ calendarId: link.externalCalendarId, eventId: link.externalEventId });
      } catch (deleteError) {
        if (![404, 410].includes(googleErrorStatus(deleteError) ?? 0)) throw deleteError;
      }
    }
    return;
  }

  if (!links?.length) {
    const calendarLinkResult = await db.from("integration_calendar_links").select("*,integration_accounts(*)")
      .eq("calendar_id", stickyCalendarId).eq("sync_enabled", true).neq("sync_direction", "import_only");
    if (calendarLinkResult.error) throw calendarLinkResult.error;
    let calendarLinks = calendarLinkResult.data;
    if (!calendarLinks?.length) {
      const fallback = await db.from("integration_calendar_links").select("*,integration_accounts(*)")
        .eq("user_id", event.user_id).eq("sync_enabled", true).eq("is_default_target", true).neq("sync_direction", "import_only");
      if (fallback.error) throw fallback.error;
      calendarLinks = fallback.data;
    }
    for (const link of calendarLinks ?? []) {
      const account = link.integration_accounts as Record<string, unknown>;
      if (!isGoogleAccount(account) || account.status === "revoked") continue;
      const calendarApi = await googleCalendarForAccount(account);
      const response = await calendarApi.events.insert({
        calendarId: link.external_calendar_id,
        requestBody: toGoogleCalendarEvent(stickyEvent),
      });
      if (!response.data.id) throw new Error("Google Calendar did not return an id for the new event.");
      const { error: linkError } = await db.from("integration_event_links").upsert({
        user_id: event.user_id,
        integration_account_id: account.id,
        event_id: event.aggregate_id,
        external_calendar_id: link.external_calendar_id,
        external_event_id: response.data.id,
        external_etag: response.data.etag,
        external_html_link: response.data.htmlLink,
        sync_snapshot: stickyEvent,
        external_updated_at: response.data.updated,
      }, { onConflict: "integration_account_id,event_id" });
      if (linkError) throw linkError;
    }
    return;
  }

  for (const link of links) {
    const account = link.integration_accounts as Record<string, unknown>;
    if (!isGoogleAccount(account) || account.status === "revoked") continue;
    if (!(await calendarLinkAllowsExport(String(account.id), link.external_calendar_id))) continue;
    const calendarApi = await googleCalendarForAccount(account);
    if (stickyEvent.status === "cancelled") {
      try {
        await calendarApi.events.delete({ calendarId: link.external_calendar_id, eventId: link.external_event_id });
      } catch (deleteError) {
        if (![404, 410].includes(googleErrorStatus(deleteError) ?? 0)) throw deleteError;
      }
      continue;
    }
    const response = await calendarApi.events.update({
      calendarId: link.external_calendar_id,
      eventId: link.external_event_id,
      requestBody: toGoogleCalendarEvent(stickyEvent),
    });
    const { error } = await db.from("integration_event_links").update({
      external_etag: response.data.etag,
      external_html_link: response.data.htmlLink,
      sync_snapshot: stickyEvent,
      external_updated_at: response.data.updated,
    }).eq("id", link.id);
    if (error) throw error;
  }
}

export async function pushOutboxEvent(event: Record<string, unknown>) {
  const { db } = getRuntime();
  if (event.aggregate_type === "calendar_event") return pushCalendarOutboxEvent(event);
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
      if (!account || !isGoogleAccount(account as Record<string, unknown>) || account.status === "revoked") continue;
      const tasksApi = await googleTasksForAccount(account as Record<string, unknown>);
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
      if (!isGoogleAccount(account) || account.status === "revoked") continue;
      const tasksApi = await googleTasksForAccount(account);
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
    if (!isGoogleAccount(account) || account.status === "revoked") continue;
    const tasksApi = await googleTasksForAccount(account);

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
    .eq("user_id", userId).in("provider", ["google_workspace", "google_tasks"]).eq("status", "healthy")
    .order("provider", { ascending: false }).limit(1).maybeSingle();
  if (error || !data) throw new Error("Google Workspace is not connected.");
  return data as Record<string, unknown>;
}
