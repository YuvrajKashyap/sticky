export type OccurrenceState = "pending" | "completed" | "not_completed" | "skipped" | "unknown" | "not_scheduled";
type Occurrence = {
  routineId?: string | null;
  scheduledDate?: string | null;
  occurrenceStatus?: OccurrenceState | null;
  timezone?: string;
  isCompleted: boolean;
};
const dateFormatters = new Map<string, Intl.DateTimeFormat>();

export function occurrenceLocalDay(timezone = "UTC", now = new Date()) {
  let formatter = dateFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
    if (dateFormatters.size >= 256) dateFormatters.clear();
    dateFormatters.set(timezone, formatter);
  }
  const parts = formatter.formatToParts(now);
  const value = (type: string) => parts.find(part => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function occurrenceStatus(task: Occurrence, now = new Date()): OccurrenceState {
  if (task.isCompleted) return "completed";
  if (task.occurrenceStatus && task.occurrenceStatus !== "pending") return task.occurrenceStatus;
  if (!task.routineId || !task.scheduledDate) return "pending";
  const today = occurrenceLocalDay(task.timezone, now);
  return task.scheduledDate < today ? "not_completed" : "pending";
}

export function isActiveOccurrence(task: Occurrence, now = new Date()) {
  return !task.isCompleted && (!task.routineId || occurrenceStatus(task, now) === "pending");
}

export function routineStatistics(tasks: Occurrence[], from: string, through: string, now = new Date()) {
  const counts = { completed: 0, notCompleted: 0, skipped: 0, unknown: 0, pending: 0 };
  for (const task of tasks) {
    if (!task.scheduledDate || task.scheduledDate < from || task.scheduledDate > through) continue;
    const status = occurrenceStatus(task, now);
    if (status === "not_scheduled") continue;
    counts[status === "not_completed" ? "notCompleted" : status]++;
  }
  const denominator = counts.completed + counts.notCompleted;
  return { ...counts, denominator, rate: denominator ? Math.round(counts.completed / denominator * 100) : null };
}
