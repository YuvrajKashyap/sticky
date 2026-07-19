import { StickyDomainError } from "./errors";
import { localDateTimeToUtc } from "./reminders";

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

function readPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  return parts.find((part) => part.type === type)?.value ?? "";
}

function addDays(date: string, amount: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

export function isValidTimeZone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

export function zonedDateKeyAt(instant: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  return `${readPart(parts, "year")}-${readPart(parts, "month")}-${readPart(parts, "day")}`;
}

export function nextDailyAgendaOccurrence(now: Date, time: string, timezone: string) {
  if (!TIME_PATTERN.test(time)) {
    throw new StickyDomainError("validation_error", "Use a valid daily agenda time.", 422);
  }
  if (!isValidTimeZone(timezone)) {
    throw new StickyDomainError("validation_error", "Use a valid IANA timezone.", 422);
  }

  const normalizedTime = time.slice(0, 5);
  const today = zonedDateKeyAt(now, timezone);
  for (let offset = 0; offset < 8; offset += 1) {
    const localDate = addDays(today, offset);
    try {
      const instant = localDateTimeToUtc(localDate, normalizedTime, timezone);
      if (instant.getTime() > now.getTime()) {
        return { localDate, instant };
      }
    } catch (error) {
      if (!(error instanceof StickyDomainError) || error.code !== "validation_error") throw error;
      // A DST spring-forward gap can make one local time nonexistent. Skip that
      // occurrence and resume at the next valid local day.
    }
  }

  throw new StickyDomainError("internal_error", "Sticky could not resolve the next daily agenda time.", 500);
}
