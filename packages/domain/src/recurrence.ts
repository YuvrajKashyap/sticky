import type { RecurrenceRuleDto, TaskDto } from "@sticky/contracts";

function parseUtcDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
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
  const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  first.setUTCDate(Math.min(preferredDay, daysInUtcMonth(first.getUTCFullYear(), first.getUTCMonth())));
  return first;
}

function startOfUtcWeek(date: Date) {
  return addUtcDays(date, -date.getUTCDay());
}

function nextWeeklyDate(rule: RecurrenceRuleDto, anchorDate: Date) {
  const days = [...new Set(rule.daysOfWeek)].sort((a, b) => a - b);
  if (days.length === 0) return addUtcDays(anchorDate, Math.max(1, rule.intervalCount) * 7);

  const startWeek = startOfUtcWeek(parseUtcDate(rule.startsOn));
  const interval = Math.max(1, rule.intervalCount);
  for (let offset = 1; offset <= interval * 7 + 7; offset += 1) {
    const candidate = addUtcDays(anchorDate, offset);
    const weeksSinceStart = Math.floor(
      (startOfUtcWeek(candidate).getTime() - startWeek.getTime()) / 604_800_000,
    );
    if (weeksSinceStart >= 0 && weeksSinceStart % interval === 0 && days.includes(candidate.getUTCDay())) {
      return candidate;
    }
  }
  return null;
}

export function nextRecurrenceDate(rule: RecurrenceRuleDto, task: TaskDto): string | null {
  if (rule.paused || (rule.endType === "after_count" && (rule.occurrenceCount ?? 1) <= 1)) return null;

  const interval = Math.max(1, rule.intervalCount);
  const anchorDate = parseUtcDate(task.dueDate ?? rule.startsOn);
  const preferredMonthDay = rule.monthDay ?? (Number(rule.startsOn.slice(8, 10)) || 1);
  let nextDate: Date | null = null;

  if (rule.frequency === "daily") nextDate = addUtcDays(anchorDate, interval);
  if (rule.frequency === "weekly") nextDate = nextWeeklyDate(rule, anchorDate);
  if (rule.frequency === "monthly") nextDate = addUtcMonths(anchorDate, interval, preferredMonthDay);
  if (rule.frequency === "yearly") nextDate = addUtcMonths(anchorDate, interval * 12, preferredMonthDay);
  if (rule.frequency === "custom") {
    const candidates = [
      rule.daysOfWeek.length ? nextWeeklyDate(rule, anchorDate) : null,
      rule.monthDay ? addUtcMonths(anchorDate, interval, preferredMonthDay) : null,
    ].filter((date): date is Date => Boolean(date));
    nextDate = candidates.length
      ? candidates.sort((left, right) => left.getTime() - right.getTime())[0]
      : addUtcDays(anchorDate, interval);
  }
  if (!nextDate) return null;

  const nextDateKey = nextDate.toISOString().slice(0, 10);
  return rule.endType === "on_date" && rule.endDate && nextDateKey > rule.endDate ? null : nextDateKey;
}

export function nextOccurrenceCount(rule: RecurrenceRuleDto): number | null {
  if (rule.endType !== "after_count" || rule.occurrenceCount === null) return rule.occurrenceCount;
  return Math.max(1, rule.occurrenceCount - 1);
}
