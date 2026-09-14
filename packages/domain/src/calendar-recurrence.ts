import type { CalendarEventDto, CalendarRangeInput } from "@sticky/contracts";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { rrulestr } from "rrule";
import { StickyDomainError } from "./errors";

type Schedule = Pick<CalendarEventDto, "allDay" | "startAt" | "endAt" | "startDate" | "endDate" | "timezone" | "recurrence">;
const DAY = 86_400_000;
const compact = (date: Date) => date.toISOString().slice(0, 19).replace(/[-:]/g, "");
const wallTime = (date: Date, zone: string) => new Date(`${formatInTimeZone(date, zone, "yyyy-MM-dd'T'HH:mm:ss")}Z`);

function recurrenceError() {
  return new StickyDomainError("validation_error", "Use a valid daily, weekly, monthly, or yearly event repeat rule and timezone.", 422);
}

function parseDate(value: string) {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value);
  if (!match) throw recurrenceError();
  return new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4] ?? "00"}:${match[5] ?? "00"}:${match[6] ?? "00"}Z`);
}

function ruleFor(event: Schedule) {
  const zone = event.allDay ? "UTC" : event.timezone;
  const start = event.allDay ? new Date(`${event.startDate}T00:00:00Z`) : wallTime(new Date(event.startAt!), zone);
  // Older agents stored each RRULE component as a separate array entry.
  const entries = event.recurrence.flatMap((line) => line.split(/\r?\n/)).map((line) => line.trim()).filter(Boolean);
  const fragments = entries.filter((line) => /^[A-Z]+=/.test(line));
  const lines = entries.filter((line) => !/^[A-Z]+=/.test(line));
  if (fragments.length) lines.unshift(`RRULE:${fragments.join(";")}`);
  if (!lines.length) throw recurrenceError();
  const normalized = lines.map((line) => {
    if (/^(RRULE|EXRULE):/.test(line)) {
      if (!/(?:^|:|;)FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(?:;|$)/.test(line)) throw recurrenceError();
      // Sub-day cartesian products can generate millions of instances in one request.
      if (/BY(?:HOUR|MINUTE|SECOND)=[^;]*,/.test(line)) throw recurrenceError();
      const interval = /(?:;|:)INTERVAL=([^;]+)/.exec(line)?.[1];
      if (interval !== undefined && (!/^\d+$/.test(interval) || Number(interval) < 1)) throw recurrenceError();
      return line.replace(/UNTIL=([^;]+)/, (_, value: string) => {
        let until = parseDate(value);
        if (value.length === 8) until = new Date(until.getTime() + DAY - 1000);
        else if (value.endsWith("Z") && !event.allDay) until = wallTime(until, zone);
        return `UNTIL=${compact(until)}`;
      });
    }
    const match = /^(RDATE|EXDATE)(?:;TZID=([^:;]+)|;VALUE=DATE)?:([^\s]+)$/.exec(line);
    if (!match) throw recurrenceError();
    const dates = match[3].split(",").map((value) => {
      let date = parseDate(value);
      if (!event.allDay && value.endsWith("Z")) date = wallTime(date, zone);
      else if (!event.allDay && match[2]) date = wallTime(fromZonedTime(date.toISOString().slice(0, 19), match[2]), zone);
      return compact(date);
    });
    return `${match[1]}:${dates.join(",")}`;
  });
  return { start, zone, rule: rrulestr([`DTSTART:${compact(start)}`, ...normalized].join("\n"), { forceset: true, cache: false }) };
}

export function validateCalendarRecurrence(event: Schedule) {
  if (!event.recurrence.length) return;
  try { ruleFor(event); } catch { throw recurrenceError(); }
}

/** Materialize only the requested window; series records remain the mutation targets. */
export function expandCalendarEvents(events: CalendarEventDto[], range: CalendarRangeInput): CalendarEventDto[] {
  const from = new Date(range.from).getTime();
  const to = new Date(range.to).getTime();
  const overlaps = (event: CalendarEventDto) => event.allDay
    ? event.startDate! < range.to.slice(0, 10) && event.endDate! > range.from.slice(0, 10)
    : new Date(event.startAt!).getTime() < to && new Date(event.endAt!).getTime() > from;
  const results: CalendarEventDto[] = [];
  for (const event of events) {
    if (event.status === "cancelled") continue;
    if (!event.recurrence.length) {
      if (overlaps(event)) results.push(event);
      continue;
    }
    const { start, zone, rule } = ruleFor(event);
    const duration = event.allDay
      ? new Date(`${event.endDate}T00:00:00Z`).getTime() - start.getTime()
      : new Date(event.endAt!).getTime() - new Date(event.startAt!).getTime();
    // Padding includes overnight meetings and offset changes at either range edge.
    const lower = new Date(from - duration - 2 * DAY);
    const upper = new Date(to + 2 * DAY);
    const dates = rule.between(lower, upper, true, (_date, index) => {
      if (index >= 10_000) throw new StickyDomainError("validation_error", "Request a smaller calendar date range.", 422);
      return true;
    });
    for (const date of dates) {
      if (date < start) continue;
      const instant = event.allDay ? date : fromZonedTime(date.toISOString().slice(0, 19), zone);
      // RFC 5545: skip nonexistent local times during spring-forward.
      if (!event.allDay && wallTime(instant, zone).getTime() !== date.getTime()) continue;
      const end = new Date(instant.getTime() + duration);
      const occurrence: CalendarEventDto = {
        ...event,
        occurrenceId: `${event.id}:${instant.toISOString()}`,
        series: { startAt: event.startAt, endAt: event.endAt, startDate: event.startDate, endDate: event.endDate },
        ...(event.allDay
          ? { startDate: date.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) }
          : { startAt: instant.toISOString(), endAt: end.toISOString() }),
      };
      if (overlaps(occurrence)) results.push(occurrence);
    }
  }
  return results.sort((a, b) => (a.startAt ?? a.startDate ?? "").localeCompare(b.startAt ?? b.startDate ?? ""));
}
