import type { StickyRecurrenceRule, StickyTask } from "@/types/sticky";

export function localDateKey(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function zonedDateKey(timeZone: string | null | undefined, date = new Date()) {
  if (!timeZone) {
    return localDateKey(date);
  }

  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      month: "2-digit",
      timeZone,
      year: "numeric",
    }).formatToParts(date);
    const values = new Map(parts.map((part) => [part.type, part.value]));
    const year = values.get("year");
    const month = values.get("month");
    const day = values.get("day");

    if (year && month && day) {
      return `${year}-${month}-${day}`;
    }
  } catch {
    return localDateKey(date);
  }

  return localDateKey(date);
}

function parseUtcDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatUtcDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function daysInUtcMonth(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function addUtcMonths(date: Date, months: number, preferredDay: number) {
  const firstOfMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const day = Math.min(
    preferredDay,
    daysInUtcMonth(firstOfMonth.getUTCFullYear(), firstOfMonth.getUTCMonth()),
  );
  firstOfMonth.setUTCDate(day);
  return firstOfMonth;
}

function startOfUtcWeek(date: Date) {
  return addUtcDays(date, -date.getUTCDay());
}

function nextWeeklyDate(rule: StickyRecurrenceRule, anchorDate: Date) {
  const days = [...new Set(rule.daysOfWeek)].sort((a, b) => a - b);

  if (days.length === 0) {
    return addUtcDays(anchorDate, Math.max(1, rule.intervalCount) * 7);
  }

  const startWeek = startOfUtcWeek(parseUtcDate(rule.startsOn));
  const interval = Math.max(1, rule.intervalCount);
  const maxLookaheadDays = interval * 7 + 7;

  for (let offset = 1; offset <= maxLookaheadDays; offset += 1) {
    const candidate = addUtcDays(anchorDate, offset);
    const weeksSinceStart = Math.floor(
      (startOfUtcWeek(candidate).getTime() - startWeek.getTime()) / 604_800_000,
    );

    if (
      weeksSinceStart >= 0 &&
      weeksSinceStart % interval === 0 &&
      days.includes(candidate.getUTCDay())
    ) {
      return candidate;
    }
  }

  return null;
}

export function nextRecurrenceDate(rule: StickyRecurrenceRule, task: StickyTask) {
  if (rule.paused) {
    return null;
  }

  if (rule.endType === "after_count" && (rule.occurrenceCount ?? 1) <= 1) {
    return null;
  }

  const interval = Math.max(1, rule.intervalCount);
  const anchorDate = parseUtcDate(task.dueDate ?? rule.startsOn);
  const preferredMonthDay = rule.monthDay ?? (Number(rule.startsOn.slice(8, 10)) || 1);
  let nextDate: Date | null = null;

  if (rule.frequency === "daily") {
    nextDate = addUtcDays(anchorDate, interval);
  }

  if (rule.frequency === "weekly") {
    nextDate = nextWeeklyDate(rule, anchorDate);
  }

  if (rule.frequency === "monthly") {
    nextDate = addUtcMonths(anchorDate, interval, preferredMonthDay);
  }

  if (rule.frequency === "yearly") {
    nextDate = addUtcMonths(anchorDate, interval * 12, preferredMonthDay);
  }

  if (rule.frequency === "custom") {
    const candidates = [
      rule.daysOfWeek.length ? nextWeeklyDate(rule, anchorDate) : null,
      rule.monthDay ? addUtcMonths(anchorDate, interval, preferredMonthDay) : null,
    ].filter((date): date is Date => Boolean(date));
    nextDate = candidates.length
      ? candidates.sort((a, b) => a.getTime() - b.getTime())[0]
      : addUtcDays(anchorDate, interval);
  }

  if (!nextDate) {
    return null;
  }

  const nextDateKey = formatUtcDate(nextDate);

  if (rule.endType === "on_date" && rule.endDate && nextDateKey > rule.endDate) {
    return null;
  }

  return nextDateKey;
}

export function nextOccurrenceCount(rule: StickyRecurrenceRule) {
  if (rule.endType !== "after_count" || typeof rule.occurrenceCount !== "number") {
    return rule.occurrenceCount;
  }

  return Math.max(1, rule.occurrenceCount - 1);
}

export function recurrenceCatchUpTarget(
  rule: StickyRecurrenceRule,
  task: StickyTask,
  targetDate = localDateKey(),
) {
  if (!task.dueDate || task.dueDate >= targetDate || rule.paused) {
    return null;
  }

  let workingRule = rule;
  let workingTask = task;
  let skippedCount = 0;

  for (let index = 0; index < 730; index += 1) {
    const dueDate = nextRecurrenceDate(workingRule, workingTask);

    if (!dueDate) {
      return null;
    }

    skippedCount += 1;
    const occurrenceCount = nextOccurrenceCount(workingRule);
    workingRule = { ...workingRule, occurrenceCount };
    workingTask = { ...workingTask, dueDate };

    if (dueDate >= targetDate) {
      return { dueDate, occurrenceCount, skippedCount };
    }
  }

  return null;
}
