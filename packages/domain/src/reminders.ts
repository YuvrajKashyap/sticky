import type { CreateReminderInput } from "@sticky/contracts";
import { StickyDomainError } from "./errors";

type DueTask = {
  dueDate: string | null;
  dueTime: string | null;
  timezone: string;
};

function zonedParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: read("year"), month: read("month"), day: read("day"), hour: read("hour"), minute: read("minute"), second: read("second") };
}

export function localDateTimeToUtc(date: string, time: string, timezone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute, second = 0] = time.split(":").map(Number);
  let instant = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = zonedParts(instant, timezone);
    const expectedAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    const adjustment = expectedAsUtc - actualAsUtc;
    if (adjustment === 0) return instant;
    instant = new Date(instant.getTime() + adjustment);
  }

  const finalParts = zonedParts(instant, timezone);
  if (finalParts.year !== year || finalParts.month !== month || finalParts.day !== day || finalParts.hour !== hour || finalParts.minute !== minute) {
    throw new StickyDomainError("validation_error", "That local time does not exist in the selected timezone.", 422);
  }
  return instant;
}

export function resolveReminderTime(input: CreateReminderInput, task: DueTask): Date {
  if (input.kind === "absolute") return new Date(input.remindAt!);
  if (!task.dueDate || !task.dueTime) {
    throw new StickyDomainError(
      "validation_error",
      "Relative reminders require both a due date and a due time.",
      422,
    );
  }
  const dueAt = localDateTimeToUtc(task.dueDate, task.dueTime, task.timezone);
  return new Date(dueAt.getTime() - input.relativeMinutes! * 60_000);
}

export function reminderDeliveryKey(reminderId: string, remindAt: string, channel: string): string {
  return `${reminderId}:${remindAt}:${channel}`;
}
