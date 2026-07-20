import { nextDailyAgendaOccurrence } from "@sticky/domain";
import { getRuntime } from "../runtime";
import { pokeNotificationInstruction, sendPokeMessage, sendWebPushMessage } from "./notifications";

const MAX_ITEMS_PER_SECTION = 50;
const DELIVERY_STALE_AFTER_MS = 5 * 60_000;

type AgendaTask = {
  id: string;
  listId: string;
  listName: string;
  title: string;
  dueTime: string | null;
  dueDate: string | null;
  sortOrder: number;
};

type AgendaSubtask = {
  id: string;
  listId: string;
  listName: string;
  parentTaskId: string;
  parentTitle: string;
  title: string;
  dueDate: string;
  sortOrder: number;
};

type UpcomingAgendaItem = {
  kind: "task" | "subtask";
  id: string;
  listId: string;
  listName: string;
  title: string;
  parentTitle: string | null;
  dueDate: string;
  dueTime: string | null;
  sortOrder: number;
};

export type DailyAgendaItems = {
  dueTasks: AgendaTask[];
  dueSubtasks: AgendaSubtask[];
  upcomingItems: UpcomingAgendaItem[];
  undatedTasks: AgendaTask[];
};

type DailyAgendaDeliveryInput = {
  date: string;
  timezone: string;
  scheduleVersion?: number;
  test?: boolean;
  deliveryKey?: string;
};

function cleanLine(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function dateLabel(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

function timeLabel(time: string | null) {
  if (!time) return "";
  const [hour, minute] = time.split(":").map(Number);
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return ` at ${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function upcomingDateLabel(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

function compareAgendaItems(
  first: { listId: string; sortOrder: number; title: string },
  second: { listId: string; sortOrder: number; title: string },
  listOrder: Map<string, number>,
) {
  return (listOrder.get(first.listId) ?? 0) - (listOrder.get(second.listId) ?? 0)
    || first.sortOrder - second.sortOrder
    || first.title.localeCompare(second.title);
}

function compareUpcomingItems(
  first: UpcomingAgendaItem,
  second: UpcomingAgendaItem,
  listOrder: Map<string, number>,
) {
  return first.dueDate.localeCompare(second.dueDate)
    || (first.dueTime ?? "99:99").localeCompare(second.dueTime ?? "99:99")
    || compareAgendaItems(first, second, listOrder);
}

export function buildDailyAgendaMessage(
  date: string,
  timezone: string,
  items: DailyAgendaItems,
  options: { test?: boolean; siteUrl?: string } = {},
) {
  const dueCount = items.dueTasks.length + items.dueSubtasks.length;
  const lines = [
    options.test ? "TEST - Sticky daily agenda" : "Good morning - here is your Sticky agenda",
    `${dateLabel(date)} · ${timezone}`,
    "",
    `DUE TODAY (${dueCount})`,
  ];

  if (dueCount === 0) {
    lines.push("Nothing is due today.");
  } else {
    const dueLines = [
      ...items.dueTasks.map((task) => `• ${cleanLine(task.listName)} - ${cleanLine(task.title)}${timeLabel(task.dueTime)}`),
      ...items.dueSubtasks.map((subtask) => `• ${cleanLine(subtask.listName)} - ${cleanLine(subtask.parentTitle)}\n  ↳ ${cleanLine(subtask.title)}`),
    ];
    lines.push(...dueLines.slice(0, MAX_ITEMS_PER_SECTION));
    if (dueLines.length > MAX_ITEMS_PER_SECTION) {
      lines.push(`+ ${dueLines.length - MAX_ITEMS_PER_SECTION} more due item${dueLines.length - MAX_ITEMS_PER_SECTION === 1 ? "" : "s"} in Sticky`);
    }
  }

  const upcomingItems = items.upcomingItems.slice(0, 3);
  lines.push("", `NEXT 3 UPCOMING (${upcomingItems.length})`);
  if (upcomingItems.length === 0) {
    lines.push("No upcoming dated tasks.");
  } else {
    for (const item of upcomingItems) {
      const prefix = `• ${upcomingDateLabel(item.dueDate)} · ${cleanLine(item.listName)} - `;
      if (item.kind === "subtask") {
        lines.push(`${prefix}${cleanLine(item.parentTitle)}\n  ↳ ${cleanLine(item.title)}`);
      } else {
        lines.push(`${prefix}${cleanLine(item.title)}${timeLabel(item.dueTime)}`);
      }
    }
  }

  lines.push("", `ACTIVE WITHOUT A DUE DATE (${items.undatedTasks.length})`);
  if (items.undatedTasks.length === 0) {
    lines.push("No active undated tasks.");
  } else {
    let currentList = "";
    for (const task of items.undatedTasks.slice(0, MAX_ITEMS_PER_SECTION)) {
      if (task.listName !== currentList) {
        currentList = task.listName;
        lines.push(cleanLine(currentList));
      }
      lines.push(`• ${cleanLine(task.title)}`);
    }
    if (items.undatedTasks.length > MAX_ITEMS_PER_SECTION) {
      lines.push(`+ ${items.undatedTasks.length - MAX_ITEMS_PER_SECTION} more active task${items.undatedTasks.length - MAX_ITEMS_PER_SECTION === 1 ? "" : "s"} in Sticky`);
    }
  }

  lines.push("", `Open Sticky: ${(options.siteUrl ?? process.env.NEXT_PUBLIC_SITE_URL ?? "https://sticky.yuvrajkashyap.com").replace(/\/$/, "")}/?view=today`);
  return lines.join("\n");
}

export async function loadDailyAgendaItems(userId: string, date: string): Promise<DailyAgendaItems> {
  const { db } = getRuntime();
  const [listsResult, tasksResult, subtasksResult] = await Promise.all([
    db.from("lists").select("id,name,sort_order").eq("user_id", userId).is("archived_at", null).order("sort_order").limit(5000),
    db.from("tasks").select("id,list_id,title,due_date,due_time,sort_order,is_completed").eq("user_id", userId).eq("is_completed", false).limit(5000),
    db.from("subtasks").select("id,task_id,title,due_date,sort_order,is_completed").eq("user_id", userId).eq("is_completed", false).not("due_date", "is", null).limit(5000),
  ]);
  const firstError = listsResult.error ?? tasksResult.error ?? subtasksResult.error;
  if (firstError) throw firstError;

  const lists = listsResult.data ?? [];
  const listNames = new Map(lists.map((list) => [String(list.id), cleanLine(list.name)]));
  const listOrder = new Map(lists.map((list, index) => [String(list.id), Number(list.sort_order ?? index)]));
  const activeTasks = (tasksResult.data ?? []).filter((task) => listNames.has(String(task.list_id)));
  const tasksById = new Map(activeTasks.map((task) => [String(task.id), task]));
  const mapTask = (task: Record<string, unknown>): AgendaTask => ({
    id: String(task.id),
    listId: String(task.list_id),
    listName: listNames.get(String(task.list_id)) ?? "List",
    title: cleanLine(task.title),
    dueTime: task.due_time ? String(task.due_time) : null,
    dueDate: task.due_date ? String(task.due_date) : null,
    sortOrder: Number(task.sort_order ?? 0),
  });

  const dueTasks = activeTasks
    .filter((task) => task.due_date === date)
    .map((task) => mapTask(task))
    .sort((first, second) => compareAgendaItems(first, second, listOrder));
  const undatedTasks = activeTasks
    .filter((task) => task.due_date == null)
    .map((task) => mapTask(task))
    .sort((first, second) => compareAgendaItems(first, second, listOrder));
  const mappedSubtasks = (subtasksResult.data ?? []).flatMap((subtask) => {
    const parent = tasksById.get(String(subtask.task_id));
    if (!parent || !subtask.due_date) return [];
    return [{
      id: String(subtask.id),
      listId: String(parent.list_id),
      listName: listNames.get(String(parent.list_id)) ?? "List",
      parentTaskId: String(parent.id),
      parentTitle: cleanLine(parent.title),
      title: cleanLine(subtask.title),
      dueDate: String(subtask.due_date),
      sortOrder: Number(subtask.sort_order ?? 0),
    }];
  });
  const dueSubtasks = mappedSubtasks
    .filter((subtask) => subtask.dueDate === date)
    .sort((first, second) => compareAgendaItems(first, second, listOrder));
  const upcomingItems: UpcomingAgendaItem[] = [
    ...activeTasks
      .filter((task) => task.due_date && String(task.due_date) > date)
      .map((task) => ({
        kind: "task" as const,
        ...mapTask(task),
        dueDate: String(task.due_date),
        parentTitle: null,
      })),
    ...mappedSubtasks
      .filter((subtask) => subtask.dueDate > date)
      .map((subtask) => ({
        kind: "subtask" as const,
        ...subtask,
        dueTime: null,
      })),
  ].sort((first, second) => compareUpcomingItems(first, second, listOrder)).slice(0, 3);

  return { dueTasks, dueSubtasks, upcomingItems, undatedTasks };
}

async function claimDelivery(userId: string, deliveryKey: string) {
  const { db } = getRuntime();
  const attempt = await db.from("notification_deliveries").insert({
    user_id: userId,
    reminder_id: null,
    channel: "push",
    delivery_key: deliveryKey,
    status: "delivering",
    attempt_count: 1,
  }).select("id,status,attempt_count,updated_at").maybeSingle();

  if (!attempt.error && attempt.data) return { delivery: attempt.data, skipped: null };
  if (attempt.error?.code !== "23505") throw attempt.error ?? new Error("Could not start daily agenda delivery.");

  const existingResult = await db.from("notification_deliveries")
    .select("id,status,attempt_count,updated_at")
    .eq("delivery_key", deliveryKey)
    .maybeSingle();
  if (existingResult.error) throw existingResult.error;
  const existing = existingResult.data;
  if (!existing) throw new Error("Sticky could not recover the daily agenda delivery record.");
  if (existing.status === "delivered") return { delivery: null, skipped: "already_delivered" };
  const updatedAt = Date.parse(String(existing.updated_at));
  if (existing.status === "delivering" && Number.isFinite(updatedAt) && Date.now() - updatedAt < DELIVERY_STALE_AFTER_MS) {
    return { delivery: null, skipped: "already_delivering" };
  }

  const claim = await db.from("notification_deliveries").update({
    status: "delivering",
    attempt_count: Number(existing.attempt_count ?? 0) + 1,
    error_code: null,
    error_message: null,
  }).eq("id", existing.id).eq("updated_at", existing.updated_at)
    .select("id,status,attempt_count,updated_at").maybeSingle();
  if (claim.error) throw claim.error;
  return claim.data ? { delivery: claim.data, skipped: null } : { delivery: null, skipped: "claimed_elsewhere" };
}

export async function deliverDailyAgenda(userId: string, input: DailyAgendaDeliveryInput) {
  const { db } = getRuntime();
  if (input.scheduleVersion !== undefined) {
    const preferences = await db.from("user_preferences")
      .select("daily_agenda_enabled,daily_agenda_schedule_version")
      .eq("user_id", userId)
      .maybeSingle();
    if (preferences.error) throw preferences.error;
    if (!preferences.data?.daily_agenda_enabled || Number(preferences.data.daily_agenda_schedule_version) !== input.scheduleVersion) {
      return { skipped: "obsolete_schedule", continue: false };
    }
  }

  const deliveryKey = input.deliveryKey ?? `daily-agenda:${userId}:${input.date}:push`;
  const claim = await claimDelivery(userId, deliveryKey);
  if (!claim.delivery) return { skipped: claim.skipped, continue: true };

  try {
    const items = await loadDailyAgendaItems(userId, input.date);
    const message = buildDailyAgendaMessage(input.date, input.timezone, items, { test: input.test });
    const [pushResult, pokeResult] = await Promise.allSettled([
      sendWebPushMessage(userId, {
        title: input.test ? "Sticky agenda test" : "Your Sticky agenda",
        body: message,
        url: "/?view=today",
        tag: `sticky-daily-agenda-${input.date}`,
      }),
      sendPokeMessage(pokeNotificationInstruction(message), userId),
    ]);
    if (pushResult.status === "rejected" && pokeResult.status === "rejected") {
      const pushError = pushResult.reason instanceof Error ? pushResult.reason.message : "Push failed";
      const pokeError = pokeResult.reason instanceof Error ? pokeResult.reason.message : "Poke failed";
      throw new Error(`Daily agenda delivery failed (Sticky notification: ${pushError}; Poke: ${pokeError}).`);
    }
    const channelReceipts = {
      push: pushResult.status === "fulfilled"
        ? { accepted: true, receipt: pushResult.value }
        : { accepted: false, error: pushResult.reason instanceof Error ? pushResult.reason.message : "Push failed" },
      poke: pokeResult.status === "fulfilled"
        ? { accepted: true, receipt: pokeResult.value }
        : { accepted: false, error: pokeResult.reason instanceof Error ? pokeResult.reason.message : "Poke failed" },
    };
    const counts = {
      dueTasks: items.dueTasks.length,
      dueSubtasks: items.dueSubtasks.length,
      upcomingItems: items.upcomingItems.length,
      undatedTasks: items.undatedTasks.length,
    };
    const { error: deliveryError } = await db.from("notification_deliveries").update({
      status: "delivered",
      delivered_at: new Date().toISOString(),
      provider_receipt: { channels: channelReceipts, counts, date: input.date, test: Boolean(input.test) },
      error_code: null,
      error_message: null,
    }).eq("id", claim.delivery.id);
    if (deliveryError) throw deliveryError;

    if (!input.test && input.scheduleVersion !== undefined) {
      const { error: preferencesError } = await db.from("user_preferences").update({
        daily_agenda_last_sent_on: input.date,
        daily_agenda_last_sent_at: new Date().toISOString(),
      }).eq("user_id", userId).eq("daily_agenda_schedule_version", input.scheduleVersion);
      if (preferencesError) throw preferencesError;
    }
    return {
      delivered: true,
      channels: {
        push: channelReceipts.push.accepted,
        poke: channelReceipts.poke.accepted,
      },
      counts,
      continue: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Daily agenda delivery failed";
    await db.from("notification_deliveries").update({
      status: "failed",
      error_message: message,
      error_code: "daily_agenda_delivery_failed",
    }).eq("id", claim.delivery.id);
    throw error;
  }
}

export function dailyAgendaScheduleFromRow(
  row: Record<string, unknown>,
  now = new Date(),
) {
  const time = String(row.daily_agenda_time ?? "06:00").slice(0, 5);
  const timezone = String(row.daily_agenda_timezone ?? "America/Chicago");
  const next = nextDailyAgendaOccurrence(now, time, timezone);
  return {
    enabled: Boolean(row.daily_agenda_enabled),
    time,
    timezone,
    scheduleVersion: Number(row.daily_agenda_schedule_version ?? 1),
    workflowRunId: row.daily_agenda_workflow_run_id ? String(row.daily_agenda_workflow_run_id) : null,
    lastSentOn: row.daily_agenda_last_sent_on ? String(row.daily_agenda_last_sent_on) : null,
    lastSentAt: row.daily_agenda_last_sent_at ? String(row.daily_agenda_last_sent_at) : null,
    nextRunDate: next.localDate,
    nextRunAt: next.instant.toISOString(),
  };
}
