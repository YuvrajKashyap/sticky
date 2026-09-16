import { addDays, format, setHours, setMinutes, startOfDay } from "date-fns";
import type { StickyColor } from "@/types/sticky";

export type StickyCalendarEvent = {
  id: string;
  occurrenceId?: string;
  recurrence?: string[];
  series?: { startAt: string | null; endAt: string | null; startDate: string | null; endDate: string | null };
  calendarId: string;
  taskId: string | null;
  title: string;
  details: string;
  location: string;
  allDay: boolean;
  startAt: string | null;
  endAt: string | null;
  startDate: string | null;
  endDate: string | null;
  timezone: string;
  status: "confirmed" | "tentative" | "cancelled";
  transparency: "opaque" | "transparent";
  color: StickyColor | null;
  version: number;
};

/** Everything the editor needs to create or update an event. */
export type CalendarEventInput = {
  title: string;
  details: string;
  location: string;
  timezone: string;
  status: StickyCalendarEvent["status"];
  transparency: StickyCalendarEvent["transparency"];
  color: StickyColor | null;
} & (
  | { allDay: true; startDate: string; endDate: string }
  | { allDay: false; startAt: string; endAt: string }
);

const STORAGE_KEY = "sticky.demo.calendar-events.v1";
const DEMO_CALENDAR_ID = "demo-calendar";
const EMPTY: StickyCalendarEvent[] = [];

let cachedRaw: string | null | undefined;
let cachedEvents: StickyCalendarEvent[] = EMPTY;
const listeners = new Set<() => void>();

function localZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago";
  } catch {
    return "America/Chicago";
  }
}

function timed(day: Date, startHour: number, startMinute: number, durationMinutes: number) {
  const start = setMinutes(setHours(startOfDay(day), startHour), startMinute);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  return { allDay: false as const, startAt: start.toISOString(), endAt: end.toISOString(), startDate: null, endDate: null };
}

function allDay(day: Date, days = 1) {
  return {
    allDay: true as const,
    startAt: null,
    endAt: null,
    startDate: format(day, "yyyy-MM-dd"),
    endDate: format(addDays(day, days), "yyyy-MM-dd"),
  };
}

/** A believable week so the demo calendar reads as a real one. */
function seedDemoEvents(): StickyCalendarEvent[] {
  const today = startOfDay(new Date());
  const zone = localZone();
  const base = {
    calendarId: DEMO_CALENDAR_ID,
    taskId: null,
    details: "",
    location: "",
    timezone: zone,
    version: 1,
    transparency: "opaque" as const,
    status: "confirmed" as const,
  };
  return [
    { ...base, id: "demo-ev-standup", title: "Team standup", color: "sun", ...timed(today, 9, 30, 30) },
    { ...base, id: "demo-ev-review", title: "Design review", color: "violet", location: "Studio B", details: "Walk through the calendar rebuild.", ...timed(today, 13, 0, 90) },
    { ...base, id: "demo-ev-focus", title: "Deep work block", color: "mint", transparency: "transparent", ...timed(today, 15, 0, 120) },
    { ...base, id: "demo-ev-yesterday", title: "1:1 with Sam", color: "rose", ...timed(addDays(today, -1), 15, 0, 45) },
    { ...base, id: "demo-ev-offsite", title: "Product offsite", color: "mint", location: "Lake house", ...allDay(addDays(today, 1), 2) },
    { ...base, id: "demo-ev-gym", title: "Gym", color: "ember", status: "tentative", ...timed(addDays(today, 3), 18, 0, 60) },
    { ...base, id: "demo-ev-dentist", title: "Dentist", color: "coral", location: "Maple St clinic", ...timed(addDays(today, 5), 11, 0, 60) },
    { ...base, id: "demo-ev-sprint", title: "Sprint planning", color: "azure", ...timed(addDays(today, 7), 10, 0, 60) },
    { ...base, id: "demo-ev-dinner", title: "Dinner with Priya", color: "rose", location: "Nori", ...timed(addDays(today, 2), 19, 30, 120) },
    { ...base, id: "demo-ev-launch", title: "Sticky 1.0 launch", color: "magenta", ...allDay(addDays(today, 12)) },
    { ...base, id: "demo-ev-call", title: "Investor call", color: "lime", ...timed(addDays(today, 8), 14, 0, 30) },
    { ...base, id: "demo-ev-early", title: "Morning run", color: "ember", ...timed(addDays(today, 4), 6, 30, 45) },
  ];
}

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeEvents(events: StickyCalendarEvent[]) {
  const raw = JSON.stringify(events);
  try {
    window.localStorage.setItem(STORAGE_KEY, raw);
  } catch {
    /* Demo events still live in memory for this session. */
  }
  cachedRaw = raw;
  cachedEvents = events;
  listeners.forEach((listener) => listener());
}

/** Snapshot for useSyncExternalStore: stable reference while storage is unchanged. */
export function getDemoEventsSnapshot(): StickyCalendarEvent[] {
  const raw = readRaw();
  if (raw === cachedRaw) return cachedEvents;
  if (raw === null) {
    writeEvents(seedDemoEvents());
    return cachedEvents;
  }
  try {
    const parsed = JSON.parse(raw) as StickyCalendarEvent[];
    cachedRaw = raw;
    cachedEvents = Array.isArray(parsed) ? parsed : EMPTY;
  } catch {
    cachedRaw = raw;
    cachedEvents = EMPTY;
  }
  return cachedEvents;
}

export function getServerEventsSnapshot(): StickyCalendarEvent[] {
  return EMPTY;
}

export function subscribeDemoEvents(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function saveDemoEvent(input: CalendarEventInput, existing?: { id: string; version: number }): StickyCalendarEvent {
  const events = getDemoEventsSnapshot();
  const schedule = input.allDay
    ? { allDay: true as const, startAt: null, endAt: null, startDate: input.startDate, endDate: input.endDate }
    : { allDay: false as const, startAt: input.startAt, endAt: input.endAt, startDate: null, endDate: null };
  const next: StickyCalendarEvent = {
    id: existing?.id ?? `demo-ev-${crypto.randomUUID()}`,
    calendarId: DEMO_CALENDAR_ID,
    taskId: null,
    title: input.title,
    details: input.details,
    location: input.location,
    timezone: input.timezone,
    status: input.status,
    transparency: input.transparency,
    color: input.color,
    version: (existing?.version ?? 0) + 1,
    ...schedule,
  };
  writeEvents(existing ? events.map((event) => (event.id === existing.id ? next : event)) : [...events, next]);
  return next;
}

export function deleteDemoEvent(id: string) {
  writeEvents(getDemoEventsSnapshot().filter((event) => event.id !== id));
}
