"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "framer-motion";
import {
  addDays,
  addMonths,
  addWeeks,
  differenceInCalendarDays,
  eachDayOfInterval,
  format,
  isSameDay,
  isSameMonth,
  isSameYear,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MapPin,
  Plus,
  Repeat2,
  Trash2,
  X,
} from "lucide-react";
import { createStickyPlatformClient } from "@/lib/sticky/api-client";
import {
  deleteDemoEvent,
  getDemoEventsSnapshot,
  getServerEventsSnapshot,
  saveDemoEvent,
  subscribeDemoEvents,
  type CalendarEventInput,
  type StickyCalendarEvent,
} from "@/lib/sticky/calendar-events";
import type { CalendarTaskItem as StickyTask } from "@/lib/sticky/task-filter";
import type { AppMode, StickyColor, StickyList } from "@/types/sticky";
import { springs } from "./motion";

/* ------------------------------------------------------------------------
   Types
   ------------------------------------------------------------------------ */

type StickyCalendarProps = {
  tasks: StickyTask[];
  lists: StickyList[];
  recurringTaskIds: ReadonlySet<string>;
  onTaskSelect: (taskId: string) => void;
  mode: AppMode;
  /** Remembered view and filter (from cookies) for a flash-free first paint. */
  initialViewMode?: CalendarViewMode;
  initialContent?: CalendarContent;
};

type CalendarViewMode = "month" | "week" | "day";
type CalendarContent = "both" | "events" | "tasks";

type EventDraft = {
  id: string | null;
  timezone: string;
  repeating: boolean;
  version: number | null;
  title: string;
  details: string;
  location: string;
  date: string;
  endDate: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  color: StickyColor | null;
  status: StickyCalendarEvent["status"];
  transparency: StickyCalendarEvent["transparency"];
};

/** One event's presence on one calendar day. */
type Occurrence = {
  event: StickyCalendarEvent;
  startMin: number;
  endMin: number;
  isStart: boolean;
  isEnd: boolean;
};

type PlacedOccurrence = Occurrence & { column: number; columns: number };

/* ------------------------------------------------------------------------
   Constants + helpers
   ------------------------------------------------------------------------ */

const CONTENT_KEY = "sticky-calendar-content";
const VIEW_MODE_KEY = "sticky-calendar-view-mode";
const HOUR_PX = 56;
const FIRST_VISIBLE_HOUR = 7;
const MONTH_CELL_CAP = 5;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const EASE = [0.16, 1, 0.3, 1] as const;

const VIEW_MODES: Array<{ label: string; value: CalendarViewMode }> = [
  { label: "Month", value: "month" },
  { label: "Week", value: "week" },
  { label: "Day", value: "day" },
];

const EVENT_COLORS: StickyColor[] = [
  "sky", "azure", "violet", "magenta", "rose", "coral", "ember", "sun", "lime", "mint", "teal", "ink",
];

function readCalendarViewMode(): CalendarViewMode {
  try {
    const value = window.localStorage.getItem(VIEW_MODE_KEY);
    return value === "week" || value === "day" ? value : "month";
  } catch {
    return "month";
  }
}

function readCalendarContent(): CalendarContent {
  try {
    const value = window.localStorage.getItem(CONTENT_KEY);
    return value === "events" || value === "tasks" ? value : "both";
  } catch {
    return "both";
  }
}

function subscribeCalendarContent(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function contentSummary(content: CalendarContent, events: number, tasks: number) {
  return [content !== "tasks" ? plural(events, "event") : null, content !== "events" ? plural(tasks, "task") : null]
    .filter(Boolean)
    .join(" · ");
}

function emptyContent(content: CalendarContent) {
  return content === "events" ? "No events" : content === "tasks" ? "No tasks due" : "Nothing planned";
}

function dayKey(date: Date) {
  return format(date, "yyyy-MM-dd");
}

function clockLabel(minutes: number) {
  const hours = Math.floor(minutes / 60) % 24;
  const mins = minutes % 60;
  return format(new Date(2000, 0, 1, hours, mins), mins ? "h:mm a" : "h a");
}

function formattedTime(value: string | null) {
  if (!value) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return value;
  return format(new Date(2000, 0, 1, hours, minutes), "h:mm a");
}

function taskMinutes(task: StickyTask): number | null {
  if (!task.dueTime) return null;
  const [hours, minutes] = task.dueTime.split(":").map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null;
}

function durationLabel(minutes: number) {
  if (minutes >= 1440) return "All day";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (!hours) return `${mins}m`;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

function bySchedule(a: StickyTask, b: StickyTask) {
  return (a.dueTime ?? "23:59").localeCompare(b.dueTime ?? "23:59") || a.title.localeCompare(b.title);
}

/**
 * Calendar task order: one-off tasks first by schedule; repeating tasks trail
 * and rank by their list's position on the dashboard, then by schedule.
 */
function byCalendarPriority(recurringTaskIds: ReadonlySet<string>, listRank: Map<string, number>, a: StickyTask, b: StickyTask) {
  const aRepeats = recurringTaskIds.has(a.id);
  const bRepeats = recurringTaskIds.has(b.id);
  if (aRepeats !== bRepeats) return Number(aRepeats) - Number(bRepeats);
  if (aRepeats) {
    const rank = (listRank.get(a.listId) ?? Number.MAX_SAFE_INTEGER) - (listRank.get(b.listId) ?? Number.MAX_SAFE_INTEGER);
    if (rank) return rank;
  }
  return bySchedule(a, b);
}

function weekTitle(start: Date, end: Date) {
  if (isSameMonth(start, end)) return `${format(start, "MMM d")} – ${format(end, "d, yyyy")}`;
  if (isSameYear(start, end)) return `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`;
  return `${format(start, "MMM d, yyyy")} – ${format(end, "MMM d, yyyy")}`;
}

function taskStateClass(task: StickyTask, todayKey: string) {
  return `${task.isCompleted ? " completed" : ""}${
    !task.isCompleted && task.dueDate && task.dueDate < todayKey ? " overdue" : ""
  }`;
}

function eventClass(event: StickyCalendarEvent) {
  return `color-${event.color ?? "default"} is-${event.status}${event.transparency === "transparent" ? " is-free" : ""}`;
}

function occurrenceTime(occurrence: Occurrence) {
  if (occurrence.event.allDay) return "All day";
  return `${clockLabel(occurrence.startMin)} – ${clockLabel(occurrence.endMin)}`;
}

/**
 * Expand events onto the days they touch. Timed events are clamped to each
 * day's 24 hours; all-day events cover every date in their [start, end) range.
 */
function buildOccurrences(events: StickyCalendarEvent[]) {
  const byDay = new Map<string, Occurrence[]>();
  const push = (key: string, occurrence: Occurrence) => {
    byDay.set(key, [...(byDay.get(key) ?? []), occurrence]);
  };

  for (const event of events) {
    if (event.allDay) {
      if (!event.startDate) continue;
      const start = new Date(`${event.startDate}T12:00:00`);
      const exclusiveEnd = new Date(`${event.endDate ?? event.startDate}T12:00:00`);
      const total = Math.max(1, differenceInCalendarDays(exclusiveEnd, start));
      for (let offset = 0; offset < total; offset += 1) {
        push(dayKey(addDays(start, offset)), {
          event,
          startMin: 0,
          endMin: 1440,
          isStart: offset === 0,
          isEnd: offset === total - 1,
        });
      }
      continue;
    }

    if (!event.startAt || !event.endAt) continue;
    const start = new Date(event.startAt);
    const end = new Date(event.endAt);
    const total = Math.max(1, differenceInCalendarDays(startOfDay(end), startOfDay(start)) + 1);
    for (let offset = 0; offset < total; offset += 1) {
      const day = startOfDay(addDays(start, offset));
      const dayStart = offset === 0 ? start.getHours() * 60 + start.getMinutes() : 0;
      const isLast = offset === total - 1;
      const rawEnd = isLast ? end.getHours() * 60 + end.getMinutes() : 1440;
      const dayEnd = isLast && rawEnd === 0 && total > 1 ? 1440 : rawEnd;
      if (dayEnd <= dayStart && !(isLast && rawEnd === 0)) continue;
      push(dayKey(day), {
        event,
        startMin: dayStart,
        endMin: Math.max(dayEnd, dayStart + 15),
        isStart: offset === 0,
        isEnd: isLast,
      });
    }
  }

  byDay.forEach((list) =>
    list.sort((a, b) => {
      const allDay = Number(b.event.allDay) - Number(a.event.allDay);
      return allDay || a.startMin - b.startMin || b.endMin - a.endMin || a.event.title.localeCompare(b.event.title);
    }),
  );
  return byDay;
}

/** Side-by-side columns for overlapping timed events (greedy cluster packing). */
function placeTimed(occurrences: Occurrence[]): PlacedOccurrence[] {
  const timed = occurrences.filter((occurrence) => !occurrence.event.allDay);
  const placed: PlacedOccurrence[] = [];
  let cluster: PlacedOccurrence[] = [];
  let clusterEnd = -1;
  let columnEnds: number[] = [];

  const flush = () => {
    const columns = Math.max(1, columnEnds.length);
    cluster.forEach((item) => {
      item.columns = columns;
    });
    placed.push(...cluster);
    cluster = [];
    columnEnds = [];
  };

  for (const occurrence of timed) {
    if (occurrence.startMin >= clusterEnd && cluster.length) flush();
    let column = columnEnds.findIndex((end) => end <= occurrence.startMin);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(occurrence.endMin);
    } else {
      columnEnds[column] = occurrence.endMin;
    }
    cluster.push({ ...occurrence, column, columns: 1 });
    clusterEnd = Math.max(clusterEnd, occurrence.endMin);
  }
  if (cluster.length) flush();
  return placed;
}

/* ------------------------------------------------------------------------
   Small components
   ------------------------------------------------------------------------ */

type SegmentOption<T extends string> = { value: T; label: string; count?: number };

/** Segmented control with a glowing pill that glides between options. */
function Segmented<T extends string>({
  id,
  options,
  value,
  onChange,
  label,
  className,
}: {
  id: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className: string;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <div className={`cal-segmented ${className}`} role="group" aria-label={label}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            className={active ? "active" : ""}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
          >
            {active ? (
              <motion.span
                className="cal-segmented-pill"
                layoutId={`${id}-pill`}
                transition={reduceMotion ? { duration: 0 } : springs.snappy}
                aria-hidden="true"
              />
            ) : null}
            <span className="cal-segmented-label">
              {option.label}
              {option.count !== undefined ? <em>{option.count}</em> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function EventStatusGlyph({ event }: { event: StickyCalendarEvent }) {
  if (event.status === "tentative") return <span className="cal-event-flag">Tentative</span>;
  if (event.status === "cancelled") return <span className="cal-event-flag">Cancelled</span>;
  if (event.transparency === "transparent") return <span className="cal-event-flag">Free</span>;
  return null;
}

/* ------------------------------------------------------------------------
   Calendar
   ------------------------------------------------------------------------ */

export function StickyCalendar({ tasks, lists, recurringTaskIds, onTaskSelect, mode, initialViewMode, initialContent }: StickyCalendarProps) {
  const reduceMotion = useReducedMotion();
  const calendarRef = useRef<HTMLElement>(null);
  const timeGridRef = useRef<HTMLDivElement>(null);
  const linkedKey = useRef<string | null>(null);
  const today = useMemo(() => new Date(), []);
  const todayKey = dayKey(today);

  const savedViewMode = useSyncExternalStore(subscribeCalendarContent, readCalendarViewMode, () => initialViewMode ?? ("month" as const));
  const [viewChoice, setViewMode] = useState<CalendarViewMode | null>(null);
  const viewMode = viewChoice ?? savedViewMode;
  const savedContent = useSyncExternalStore(subscribeCalendarContent, readCalendarContent, () => initialContent ?? ("both" as const));
  const [contentChoice, setContentChoice] = useState<CalendarContent | null>(null);
  const content = contentChoice ?? savedContent;

  useEffect(() => {
    try {
      document.cookie = `sticky.calview=${viewMode}; path=/; max-age=31536000; samesite=lax`;
      document.cookie = `sticky.calcontent=${content}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      /* Cookies disabled: localStorage still restores the view after mount. */
    }
  }, [viewMode, content]);
  const showTasks = content !== "events";
  const showEvents = content !== "tasks";

  const [anchorDate, setAnchorDate] = useState(today);
  const [selectedDate, setSelectedDate] = useState(today);
  const [eventDraft, setEventDraft] = useState<EventDraft | null>(null);
  const [eventMessage, setEventMessage] = useState<string | null>(null);
  const [nowMinutes, setNowMinutes] = useState<number | null>(null);

  const client = useMemo(() => (mode === "supabase" ? createStickyPlatformClient() : null), [mode]);
  const queryClient = useQueryClient();

  const monthStart = startOfMonth(anchorDate);
  const calendarStart = startOfWeek(monthStart);
  const monthDays = eachDayOfInterval({ start: calendarStart, end: addDays(calendarStart, 41) });
  const weekStart = startOfWeek(anchorDate);
  const weekDays = eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) });
  const weekEnd = weekDays[6];
  const listById = useMemo(() => new Map(lists.map((list) => [list.id, list])), [lists]);
  const listRank = useMemo(() => new Map(lists.map((list, index) => [list.id, index])), [lists]);

  const visibleStart = viewMode === "month" ? calendarStart : viewMode === "week" ? weekStart : startOfDay(selectedDate);
  const visibleEnd =
    viewMode === "month" ? addDays(calendarStart, 42) : viewMode === "week" ? addDays(weekStart, 7) : addDays(startOfDay(selectedDate), 1);
  const visibleRange = { from: visibleStart.toISOString(), to: visibleEnd.toISOString() };

  // Live clock for the "now" line, updated each minute once mounted.
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setNowMinutes(now.getHours() * 60 + now.getMinutes());
    };
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 60_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);

  /* --- Event source: Supabase in the real app, local store in demo ------- */

  const eventsQuery = useQuery({
    queryKey: ["sticky-calendar-events", visibleRange.from, visibleRange.to],
    enabled: Boolean(client),
    queryFn: () =>
      client!.request<{ events: StickyCalendarEvent[] }>(
        `/api/v1/calendar-events?from=${encodeURIComponent(visibleRange.from)}&to=${encodeURIComponent(visibleRange.to)}`,
      ),
  });
  const demoEvents = useSyncExternalStore(subscribeDemoEvents, getDemoEventsSnapshot, getServerEventsSnapshot);
  const serverEvents = eventsQuery.data?.events;
  const allEvents = useMemo(() => (client ? serverEvents ?? [] : demoEvents), [client, serverEvents, demoEvents]);
  const events = useMemo(() => (showEvents ? allEvents : []), [allEvents, showEvents]);

  const saveEvent = useMutation({
    mutationFn: async (draft: EventDraft) => {
      const schedule: CalendarEventInput = draft.allDay
        ? {
            allDay: true,
            startDate: draft.date,
            endDate: draft.endDate > draft.date ? draft.endDate : dayKey(addDays(new Date(`${draft.date}T12:00:00`), 1)),
            title: draft.title,
            details: draft.details,
            location: draft.location,
            timezone: draft.timezone,
            status: draft.status,
            transparency: draft.transparency,
            color: draft.color,
          }
        : {
            allDay: false,
            startAt: fromZonedTime(`${draft.date}T${draft.startTime}:00`, draft.timezone).toISOString(),
            endAt: fromZonedTime(`${draft.date}T${draft.endTime}:00`, draft.timezone).toISOString(),
            title: draft.title,
            details: draft.details,
            location: draft.location,
            timezone: draft.timezone,
            status: draft.status,
            transparency: draft.transparency,
            color: draft.color,
          };
      if (!client) {
        saveDemoEvent(schedule, draft.id && draft.version ? { id: draft.id, version: draft.version } : undefined);
        return;
      }
      if (draft.id && draft.version) {
        return client.request(`/api/v1/calendar-events/${draft.id}`, {
          method: "PATCH",
          body: JSON.stringify({ version: draft.version, ...schedule }),
        });
      }
      return client.request("/api/v1/calendar-events", { method: "POST", body: JSON.stringify(schedule) });
    },
    onSuccess: () => {
      setEventDraft(null);
      setEventMessage("Event saved.");
      void queryClient.invalidateQueries({ queryKey: ["sticky-calendar-events"] });
    },
    onError: (error) => setEventMessage(error.message),
  });

  const deleteEvent = useMutation({
    mutationFn: async (draft: EventDraft) => {
      if (!draft.id) return;
      if (!client) {
        deleteDemoEvent(draft.id);
        return;
      }
      return client.request(`/api/v1/calendar-events/${draft.id}`, {
        method: "DELETE",
        body: JSON.stringify({ confirmation: { confirmed: true, summary: `delete ${draft.id}` } }),
      });
    },
    onSuccess: () => {
      setEventDraft(null);
      setEventMessage("Event deleted.");
      void queryClient.invalidateQueries({ queryKey: ["sticky-calendar-events"] });
    },
    onError: (error) => setEventMessage(error.message),
  });

  /* --- Derived data -------------------------------------------------------- */

  const visibleTasks = useMemo(() => (showTasks ? tasks : []), [showTasks, tasks]);

  const tasksByDate = useMemo(() => {
    const grouped = new Map<string, StickyTask[]>();
    for (const task of visibleTasks) {
      if (!task.dueDate) continue;
      const key = task.dueDate.slice(0, 10);
      grouped.set(key, [...(grouped.get(key) ?? []), task]);
    }
    grouped.forEach((list) => list.sort((a, b) => byCalendarPriority(recurringTaskIds, listRank, a, b)));
    return grouped;
  }, [listRank, recurringTaskIds, visibleTasks]);

  const occurrencesByDate = useMemo(() => buildOccurrences(events), [events]);

  // Time grids open scrolled to the working day, not midnight.
  useEffect(() => {
    if (viewMode === "month") return;
    const node = timeGridRef.current;
    if (!node) return;
    const days = viewMode === "week" ? weekDays : [selectedDate];
    let earliest = FIRST_VISIBLE_HOUR * 60;
    days.forEach((day) => {
      (occurrencesByDate.get(dayKey(day)) ?? []).forEach((occurrence) => {
        if (!occurrence.event.allDay) earliest = Math.min(earliest, occurrence.startMin);
      });
    });
    node.scrollTop = Math.max(0, ((earliest - 20) / 60) * HOUR_PX);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, selectedDate, anchorDate]);

  const selectedDateKey = dayKey(selectedDate);
  const selectedTasks = tasksByDate.get(selectedDateKey) ?? [];
  const selectedOccurrences = occurrencesByDate.get(selectedDateKey) ?? [];
  const monthKey = format(monthStart, "yyyy-MM");
  const weekStartKey = dayKey(weekStart);
  const weekEndKey = dayKey(weekEnd);

  const inPeriod = (key: string) =>
    viewMode === "month" ? key.startsWith(monthKey) : viewMode === "week" ? key >= weekStartKey && key <= weekEndKey : key === selectedDateKey;

  const periodTaskCount = useMemo(
    () => [...tasksByDate].reduce((sum, [key, list]) => (inPeriod(key) ? sum + list.length : sum), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasksByDate, viewMode, monthKey, weekStartKey, weekEndKey, selectedDateKey],
  );
  const periodEventCount = useMemo(
    () => new Set([...occurrencesByDate].flatMap(([key, list]) => (inPeriod(key) ? list.map((item) => item.event.occurrenceId ?? item.event.id) : []))).size,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [occurrencesByDate, viewMode, monthKey, weekStartKey, weekEndKey, selectedDateKey],
  );
  // Counts for the filter segments always reflect the full visible range,
  // regardless of which class is currently shown.
  const rangeEventTotal = useMemo(
    () => new Set([...buildOccurrences(allEvents)].flatMap(([key, list]) => (inPeriod(key) ? list.map((item) => item.event.occurrenceId ?? item.event.id) : []))).size,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allEvents, viewMode, monthKey, weekStartKey, weekEndKey, selectedDateKey],
  );
  const rangeTaskTotal = useMemo(
    () => tasks.filter((task) => task.dueDate && inPeriod(task.dueDate.slice(0, 10))).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, viewMode, monthKey, weekStartKey, weekEndKey, selectedDateKey],
  );
  const overdueCount = visibleTasks.filter((task) => Boolean(task.dueDate && task.dueDate < todayKey && !task.isCompleted)).length;
  const busyMinutes = useMemo(
    () =>
      [...occurrencesByDate].reduce(
        (sum, [key, list]) =>
          inPeriod(key)
            ? sum + list.reduce((acc, item) => (item.event.allDay || item.event.transparency === "transparent" ? acc : acc + (item.endMin - item.startMin)), 0)
            : sum,
        0,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [occurrencesByDate, viewMode, monthKey, weekStartKey, weekEndKey, selectedDateKey],
  );

  const rangeTitle =
    viewMode === "month" ? format(monthStart, "MMMM yyyy") : viewMode === "week" ? weekTitle(weekStart, weekEnd) : format(selectedDate, "EEEE, MMMM d");
  // Editorial title: the month or weekday in roman, the year or date in italic.
  const rangeTitleNode =
    viewMode === "month" ? (
      <>
        {format(monthStart, "MMMM")} <em>{format(monthStart, "yyyy")}</em>
      </>
    ) : viewMode === "week" ? (
      <>
        {weekTitle(weekStart, weekEnd).replace(/,\s*\d{4}$/, "")}, <em>{format(weekEnd, "yyyy")}</em>
      </>
    ) : (
      <>
        {format(selectedDate, "EEEE")} <em>{format(selectedDate, "MMM d")}</em>
      </>
    );
  const periodLabel = viewMode === "month" ? "this month" : viewMode === "week" ? "this week" : "today";

  /* --- Actions --------------------------------------------------------------- */

  function changeContent(next: CalendarContent) {
    setContentChoice(next);
    try {
      window.localStorage.setItem(CONTENT_KEY, next);
    } catch {
      /* Filtering still works when storage is unavailable. */
    }
  }

  function selectMonthDate(day: Date) {
    setSelectedDate(day);
    if (!isSameMonth(day, monthStart)) setAnchorDate(day);
    if (window.matchMedia("(max-width: 860px) and (orientation: portrait)").matches) {
      requestAnimationFrame(() => {
        const calendar = calendarRef.current;
        const agenda = calendar?.querySelector<HTMLElement>(".calendar-agenda");
        if (calendar && agenda) {
          const bounds = calendar.getBoundingClientRect();
          const scale = bounds.width / calendar.offsetWidth || 1;
          calendar.scrollTo({
            top: calendar.scrollTop + (agenda.getBoundingClientRect().top - bounds.top) / scale - 12,
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
          });
        }
      });
    }
  }

  function openDay(day: Date) {
    setSelectedDate(day);
    setAnchorDate(day);
    setViewMode("day");
  }

  function changeView(nextView: CalendarViewMode) {
    setViewMode(nextView);
    try {
      window.localStorage.setItem(VIEW_MODE_KEY, nextView);
    } catch {
      /* View switching still works when storage is unavailable. */
    }
    setAnchorDate(selectedDate);
  }

  function shiftRange(direction: -1 | 1) {
    if (viewMode === "month") {
      const nextDate = addMonths(monthStart, direction);
      setAnchorDate(nextDate);
      setSelectedDate(startOfMonth(nextDate));
      return;
    }
    const nextDate = viewMode === "week" ? addWeeks(selectedDate, direction) : addDays(selectedDate, direction);
    setAnchorDate(nextDate);
    setSelectedDate(nextDate);
  }

  function showToday() {
    const nextToday = new Date();
    setAnchorDate(nextToday);
    setSelectedDate(nextToday);
  }

  function createEventFor(day = selectedDate, startMinutes = 9 * 60) {
    const startHour = Math.floor(startMinutes / 60);
    const startMin = startMinutes % 60;
    const endMinutes = Math.min(startMinutes + 60, 23 * 60 + 59);
    setEventMessage(null);
    setEventDraft({
      id: null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago",
      repeating: false,
      version: null,
      title: "",
      details: "",
      location: "",
      date: dayKey(day),
      endDate: dayKey(addDays(day, 1)),
      startTime: `${String(startHour).padStart(2, "0")}:${String(startMin).padStart(2, "0")}`,
      endTime: `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`,
      allDay: false,
      color: null,
      status: "confirmed",
      transparency: "opaque",
    });
  }

  function editEvent(event: StickyCalendarEvent) {
    // The displayed occurrence is virtual. Edit the saved series anchor, never
    // replace its start date with the selected September/October meeting.
    const schedule = event.series ?? event;
    const date = event.allDay ? schedule.startDate ?? selectedDateKey : schedule.startAt ? formatInTimeZone(schedule.startAt, event.timezone, "yyyy-MM-dd") : selectedDateKey;
    setEventMessage(null);
    setEventDraft({
      id: event.id,
      timezone: event.timezone,
      repeating: Boolean(event.recurrence?.length || event.series),
      version: event.version,
      title: event.title,
      details: event.details,
      location: event.location,
      date,
      endDate: schedule.endDate ?? dayKey(addDays(new Date(`${date}T12:00:00`), 1)),
      startTime: schedule.startAt ? formatInTimeZone(schedule.startAt, event.timezone, "HH:mm") : "09:00",
      endTime: schedule.endAt ? formatInTimeZone(schedule.endAt, event.timezone, "HH:mm") : "10:00",
      allDay: event.allDay,
      color: event.color,
      status: event.status,
      transparency: event.transparency,
    });
  }

  /* --- Render ------------------------------------------------------------------ */

  const contentOptions: SegmentOption<CalendarContent>[] = [
    { value: "both", label: "All", count: rangeEventTotal + rangeTaskTotal },
    { value: "events", label: "Events", count: rangeEventTotal },
    { value: "tasks", label: "Tasks", count: rangeTaskTotal },
  ];

  const itemMotion = reduceMotion
    ? {}
    : {
        layout: true as const,
        initial: { opacity: 0, clipPath: "inset(0 100% 0 0 round 6px)" },
        animate: { opacity: 1, clipPath: "inset(0 0% 0 0 round 6px)" },
        exit: { opacity: 0, height: 0, marginTop: -3, transition: { duration: 0.22, ease: EASE } },
        transition: { duration: 0.55, ease: EASE },
      };

  // Keyboard: t today · arrows move · m/w/d views · n new event.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || eventDraft) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      switch (event.key) {
        case "t": showToday(); break;
        case "ArrowLeft": shiftRange(-1); break;
        case "ArrowRight": shiftRange(1); break;
        case "m": changeView("month"); break;
        case "w": changeView("week"); break;
        case "d": changeView("day"); break;
        case "n": createEventFor(); break;
        default: return;
      }
      event.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  /** Persistent cursor spotlight on any [data-spot] object under the pointer. */
  function handleSpotlight(event: React.PointerEvent<HTMLElement>) {
    if (event.pointerType !== "mouse") return;
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-spot]");
    if (!target) return;
    const bounds = target.getBoundingClientRect();
    target.style.setProperty("--mx", `${(((event.clientX - bounds.left) / bounds.width) * 100).toFixed(1)}%`);
    target.style.setProperty("--my", `${(((event.clientY - bounds.top) / bounds.height) * 100).toFixed(1)}%`);
  }

  /** Hovering an object lights every other rendering of the same thing. */
  function handleLinkOver(event: React.PointerEvent<HTMLElement>) {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-key]");
    const key = target?.dataset.key;
    const root = calendarRef.current;
    if (!root) return;
    if (linkedKey.current && linkedKey.current !== key) {
      root.querySelectorAll<HTMLElement>(`[data-key="${linkedKey.current}"]`).forEach((node) => node.classList.remove("is-linked"));
      linkedKey.current = null;
    }
    if (key && key !== linkedKey.current) {
      linkedKey.current = key;
      root.querySelectorAll<HTMLElement>(`[data-key="${key}"]`).forEach((node) => node.classList.add("is-linked"));
    }
  }

  function handleLinkOut(event: React.PointerEvent<HTMLElement>) {
    const next = event.relatedTarget as HTMLElement | null;
    if (next && next.closest?.("[data-key]")?.getAttribute("data-key") === linkedKey.current) return;
    const root = calendarRef.current;
    if (!root || !linkedKey.current) return;
    root.querySelectorAll<HTMLElement>(`[data-key="${linkedKey.current}"]`).forEach((node) => node.classList.remove("is-linked"));
    linkedKey.current = null;
  }

  return (
    <LayoutGroup id="sticky-calendar">
      <section
        ref={calendarRef}
        className={`calendar-view calendar-mode-${viewMode} content-${content}`}
        aria-label="Workspace calendar"
        onPointerMove={handleSpotlight}
        onPointerOver={handleLinkOver}
        onPointerOut={handleLinkOut}
      >
        <header className="calendar-header">
          <div className="calendar-heading">
            <span className="calendar-heading-icon" aria-hidden="true">
              <CalendarDays size={18} />
            </span>
            <div className="calendar-heading-copy">
              <p>Workspace calendar</p>
              <AnimatePresence mode="wait" initial={false}>
                <motion.h2
                  key={rangeTitle}
                  className="calendar-month-title"
                  aria-live="polite"
                  initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduceMotion ? undefined : { opacity: 0, y: -8 }}
                  transition={{ duration: 0.22, ease: EASE }}
                >
                  {rangeTitleNode}
                </motion.h2>
              </AnimatePresence>
            </div>
          </div>

          <Segmented
            id="cal-view"
            className="calendar-view-switcher"
            label="Calendar view"
            options={VIEW_MODES}
            value={viewMode}
            onChange={changeView}
          />

          <Segmented
            id="cal-content"
            className="calendar-content-filter"
            label="Calendar content"
            options={contentOptions}
            value={content}
            onChange={changeContent}
          />

          <ul className="calendar-summary" aria-label="Calendar summary">
            {showEvents ? (
              <li>
                <strong>{periodEventCount}</strong> {periodEventCount === 1 ? "event" : "events"} {periodLabel}
              </li>
            ) : null}
            {showEvents && busyMinutes > 0 ? (
              <li>
                <strong>{durationLabel(busyMinutes)}</strong> busy
              </li>
            ) : null}
            {showTasks ? (
              <li>
                <strong>{periodTaskCount}</strong> {periodTaskCount === 1 ? "task" : "tasks"} {showEvents ? "due" : periodLabel}
              </li>
            ) : null}
            {showTasks && overdueCount > 0 ? (
              <li className="has-overdue">
                <strong>{overdueCount}</strong> overdue
              </li>
            ) : null}
          </ul>

          <div className="calendar-controls">
            <button type="button" onClick={() => createEventFor()} className="calendar-add-event">
              <Plus size={15} /> <span>Event</span>
            </button>
            <button type="button" onClick={() => shiftRange(-1)} className="calendar-nav-btn" aria-label={`Previous ${viewMode}`}>
              <ChevronLeft size={18} />
            </button>
            <button type="button" onClick={showToday} className="calendar-today-btn">
              Today
            </button>
            <button type="button" onClick={() => shiftRange(1)} className="calendar-nav-btn" aria-label={`Next ${viewMode}`}>
              <ChevronRight size={18} />
            </button>
          </div>
        </header>

        <AnimatePresence initial={false}>
          {eventMessage || (showEvents && eventsQuery.error) ? (
            <motion.p
              key="status"
              className="calendar-status"
              role="status"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2, ease: EASE }}
            >
              {eventMessage ?? eventsQuery.error?.message}
            </motion.p>
          ) : null}
        </AnimatePresence>

        {/* ---------------------------------------------------------- Month */}
        {viewMode === "month" ? (
          <div className="calendar-layout">
            <div className="calendar-month">
              <div className="calendar-grid-header" aria-hidden="true">
                {WEEKDAYS.map((day) => (
                  <div key={day} className="calendar-day-name">
                    {day}
                  </div>
                ))}
              </div>

              <div className="calendar-grid">
                {monthDays.map((day, cellIndex) => {
                  const key = dayKey(day);
                  const weekend = day.getDay() === 0 || day.getDay() === 6;
                  const dayTasks = tasksByDate.get(key) ?? [];
                  const dayOccurrences = occurrencesByDate.get(key) ?? [];
                  const eventSlots = Math.min(dayOccurrences.length, dayTasks.length ? MONTH_CELL_CAP - 1 : MONTH_CELL_CAP);
                  const shownOccurrences = dayOccurrences.slice(0, eventSlots);
                  const shownTasks = dayTasks.slice(0, Math.max(0, MONTH_CELL_CAP - shownOccurrences.length));
                  const hidden = dayOccurrences.length + dayTasks.length - shownOccurrences.length - shownTasks.length;
                  const isCurrentMonth = isSameMonth(day, monthStart);
                  const selected = isSameDay(day, selectedDate);
                  const total = dayOccurrences.length + dayTasks.length;

                  return (
                    <article
                      key={key}
                      className={`calendar-cell${!isCurrentMonth ? " out-of-month" : ""}${isToday(day) ? " today" : ""}${selected ? " selected" : ""}${weekend ? " weekend" : ""}`}
                      style={{ "--cell-i": (cellIndex % 7) + Math.floor(cellIndex / 7) } as React.CSSProperties}
                      data-spot=""
                      aria-label={`${format(day, "EEEE, MMMM d")}, ${contentSummary(content, dayOccurrences.length, dayTasks.length)}`}
                    >
                      <button
                        type="button"
                        className="calendar-cell-header"
                        onClick={() => selectMonthDate(day)}
                        onDoubleClick={() => openDay(day)}
                        aria-label={`Show ${format(day, "MMMM d")}`}
                        aria-pressed={selected}
                      >
                        <span className="calendar-day-number">{format(day, "d")}</span>
                        {total ? <span className="calendar-day-count">{total}</span> : null}
                      </button>

                      <div className="calendar-cell-tasks">
                        <AnimatePresence mode="popLayout">
                          {shownOccurrences.map((occurrence) => (
                            <motion.button
                              key={`ev-${occurrence.event.occurrenceId ?? occurrence.event.id}`}
                              type="button"
                              className={`cal-event cal-event-bar ${eventClass(occurrence.event)}${occurrence.isStart ? "" : " continues-before"}${occurrence.isEnd ? "" : " continues-after"}`}
                              data-key={`ev-${occurrence.event.occurrenceId ?? occurrence.event.id}`}
                              data-spot=""
                              onClick={() => editEvent(occurrence.event)}
                              title={`${occurrenceTime(occurrence)} · ${occurrence.event.title}`}
                              {...itemMotion}
                            >
                              {!occurrence.event.allDay && occurrence.isStart ? (
                                <span className="cal-event-time">{clockLabel(occurrence.startMin)}</span>
                              ) : null}
                              <strong>{occurrence.event.title}</strong>
                            </motion.button>
                          ))}
                          {shownTasks.map((task) => {
                            const time = formattedTime(task.dueTime);
                            const list = listById.get(task.listId);
                            return (
                              <motion.button
                                key={`tk-${task.id}`}
                                type="button"
                                className={`calendar-task color-${listById.get(task.listId)?.color ?? task.color}${taskStateClass(task, todayKey)}`}
                                data-key={`tk-${task.id}`}
                                data-spot=""
                                onClick={() => onTaskSelect(task.id)}
                                title={`${task.title || "Untitled task"}${list ? ` · ${list.name}` : ""}`}
                                {...itemMotion}
                              >
                                <i aria-hidden="true" />
                                {time ? <span className="calendar-task-time">{time}</span> : null}
                                <span className="calendar-task-title">{task.title || "Untitled"}{task.parentTitle ? <small className="calendar-parent-context"> · {task.parentTitle}</small> : null}</span>
                                {task.isCompleted ? <Check size={11} aria-hidden="true" /> : null}
                              </motion.button>
                            );
                          })}
                        </AnimatePresence>
                        {hidden > 0 ? (
                          <button type="button" className="calendar-more" onClick={() => selectMonthDate(day)}>
                            +{hidden} more
                          </button>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>

            <CalendarAgenda
              date={selectedDate}
              content={content}
              tasks={selectedTasks}
              occurrences={selectedOccurrences}
              listById={listById}
              recurringTaskIds={recurringTaskIds}
              nowMinutes={isToday(selectedDate) ? nowMinutes : null}
              onTaskSelect={onTaskSelect}
              onEventSelect={editEvent}
              onCreateEvent={() => createEventFor(selectedDate)}
              onOpenDay={() => openDay(selectedDate)}
            />
          </div>
        ) : null}

        {/* ------------------------------------------------------ Week / Day */}
        {viewMode !== "month" ? (
          <div
            className={viewMode === "week" ? "calendar-week-view" : "calendar-day-view"}
            role="region"
            aria-label={`${viewMode === "week" ? "Week" : "Day"} view for ${rangeTitle}`}
          >
            <TimeGrid
              days={viewMode === "week" ? weekDays : [selectedDate]}
              occurrencesByDate={occurrencesByDate}
              tasksByDate={tasksByDate}
              listById={listById}
              selectedDate={selectedDate}
              nowMinutes={nowMinutes}
              scrollRef={timeGridRef}
              onTaskSelect={onTaskSelect}
              onEventSelect={editEvent}
              onCreateAt={(day, minutes) => createEventFor(day, minutes)}
              onDayHeader={viewMode === "week" ? openDay : undefined}
            />
            {viewMode === "day" ? (
              <div className="cal-day-side">
                <MiniMonth
                  selected={selectedDate}
                  occurrencesByDate={occurrencesByDate}
                  tasksByDate={tasksByDate}
                  onSelect={(day) => {
                    setSelectedDate(day);
                    setAnchorDate(day);
                  }}
                />
                <CalendarAgenda
                  date={selectedDate}
                  content={content}
                  tasks={selectedTasks}
                  occurrences={selectedOccurrences}
                  listById={listById}
                  recurringTaskIds={recurringTaskIds}
                  nowMinutes={isToday(selectedDate) ? nowMinutes : null}
                  onTaskSelect={onTaskSelect}
                  onEventSelect={editEvent}
                  onCreateEvent={() => createEventFor(selectedDate)}
                  rich
                />
              </div>
            ) : null}
          </div>
        ) : null}

        <AnimatePresence>
          {eventDraft ? (
            <EventEditor
              key="editor"
              draft={eventDraft}
              onChange={setEventDraft}
              onClose={() => setEventDraft(null)}
              onSave={() => saveEvent.mutate(eventDraft)}
              onDelete={() => deleteEvent.mutate(eventDraft)}
              saving={saveEvent.isPending}
              deleting={deleteEvent.isPending}
            />
          ) : null}
        </AnimatePresence>
      </section>
    </LayoutGroup>
  );
}

/* ------------------------------------------------------------------------
   Time grid (week + day)
   ------------------------------------------------------------------------ */

type TimeGridProps = {
  days: Date[];
  occurrencesByDate: Map<string, Occurrence[]>;
  tasksByDate: Map<string, StickyTask[]>;
  listById: Map<string, StickyList>;
  selectedDate: Date;
  nowMinutes: number | null;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onTaskSelect: (taskId: string) => void;
  onEventSelect: (event: StickyCalendarEvent) => void;
  onCreateAt: (day: Date, minutes: number) => void;
  onDayHeader?: (day: Date) => void;
};

function TimeGrid({
  days,
  occurrencesByDate,
  tasksByDate,
  listById,
  selectedDate,
  nowMinutes,
  scrollRef,
  onTaskSelect,
  onEventSelect,
  onCreateAt,
  onDayHeader,
}: TimeGridProps) {
  const reduceMotion = useReducedMotion();
  const todayKey = dayKey(new Date());
  const hours = Array.from({ length: 24 }, (_, hour) => hour);
  // A 30-minute ghost slot follows the pointer across empty lane space.
  const [ghost, setGhost] = useState<{ key: string; minutes: number } | null>(null);
  const columns = days.map((day) => {
    const key = dayKey(day);
    const occurrences = occurrencesByDate.get(key) ?? [];
    const tasks = tasksByDate.get(key) ?? [];
    return {
      day,
      key,
      allDay: occurrences.filter((occurrence) => occurrence.event.allDay),
      timed: placeTimed(occurrences),
      timedTasks: tasks.filter((task) => taskMinutes(task) !== null),
      floatingTasks: tasks.filter((task) => taskMinutes(task) === null),
    };
  });
  const hasAllDayRow = columns.some((column) => column.allDay.length || column.floatingTasks.length);

  function handleLaneClick(day: Date, event: React.MouseEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const minutes = Math.floor(((event.clientY - bounds.top) / HOUR_PX) * 60);
    onCreateAt(day, Math.max(0, Math.min(23 * 60, Math.round(minutes / 15) * 15)));
  }

  function handleLaneHover(key: string, event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse") return;
    if (event.target !== event.currentTarget) {
      setGhost((current) => (current ? null : current));
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const minutes = Math.max(0, Math.min(23 * 60 + 30, Math.floor(((event.clientY - bounds.top) / HOUR_PX) * 60 / 15) * 15));
    setGhost((current) => (current && current.key === key && current.minutes === minutes ? current : { key, minutes }));
  }

  return (
    <div className={`cal-timegrid${days.length === 1 ? " single" : ""}`} style={{ "--cal-days": days.length } as React.CSSProperties}>
      <div className="cal-timegrid-head">
        <span className="cal-timegrid-corner" aria-hidden="true">
          <Clock3 size={13} />
        </span>
        {columns.map(({ day, key }) => {
          const header = (
            <>
              <span>{format(day, "EEE")}</span>
              <strong>{format(day, "d")}</strong>
            </>
          );
          const weekend = day.getDay() === 0 || day.getDay() === 6;
          const className = `cal-timegrid-day${key === todayKey ? " today" : ""}${isSameDay(day, selectedDate) ? " selected" : ""}${weekend ? " weekend" : ""}`;
          return onDayHeader ? (
            <button key={key} type="button" className={className} data-key={`lane-${key}`} onClick={() => onDayHeader(day)} aria-label={`Open ${format(day, "EEEE, MMMM d")} in day view`}>
              {header}
            </button>
          ) : (
            <div key={key} className={className} data-key={`lane-${key}`}>
              {header}
            </div>
          );
        })}
      </div>

      {hasAllDayRow ? (
        <div className="cal-timegrid-allday">
          <span className="cal-timegrid-corner cal-timegrid-allday-label">All day</span>
          {columns.map(({ key, allDay, floatingTasks }) => (
            <div key={key} className="cal-timegrid-allday-cell" data-key={`lane-${key}`}>
              <AnimatePresence>
                {allDay.map((occurrence, index) => (
                  <motion.button
                    key={`ev-${occurrence.event.occurrenceId ?? occurrence.event.id}`}
                    type="button"
                    className={`cal-event cal-event-bar ${eventClass(occurrence.event)}${occurrence.isStart ? "" : " continues-before"}${occurrence.isEnd ? "" : " continues-after"}`}
                    data-key={`ev-${occurrence.event.occurrenceId ?? occurrence.event.id}`}
                    data-spot=""
                    onClick={() => onEventSelect(occurrence.event)}
                    initial={reduceMotion ? false : { opacity: 0, clipPath: "inset(0 100% 0 0 round 6px)" }}
                    animate={{ opacity: 1, clipPath: "inset(0 0% 0 0 round 6px)" }}
                    exit={reduceMotion ? undefined : { opacity: 0, scale: 0.94 }}
                    transition={{ duration: 0.6, ease: EASE, delay: 0.1 + index * 0.05 }}
                  >
                    <strong>{occurrence.event.title}</strong>
                  </motion.button>
                ))}
                {floatingTasks.map((task) => (
                  <motion.button
                    key={`tk-${task.id}`}
                    type="button"
                    className={`calendar-task cal-task-pin color-${listById.get(task.listId)?.color ?? task.color}${taskStateClass(task, todayKey)}`}
                    data-key={`tk-${task.id}`}
                    data-spot=""
                    onClick={() => onTaskSelect(task.id)}
                    title={task.title}
                    initial={reduceMotion ? false : { opacity: 0, scale: 0.94 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={reduceMotion ? undefined : { opacity: 0, scale: 0.94 }}
                    transition={springs.snappy}
                  >
                    <i aria-hidden="true" />
                    <span className="calendar-task-title">{task.title || "Untitled"}{task.parentTitle ? <small className="calendar-parent-context"> · {task.parentTitle}</small> : null}</span>
                    {task.isCompleted ? <Check size={11} aria-hidden="true" /> : null}
                  </motion.button>
                ))}
              </AnimatePresence>
            </div>
          ))}
        </div>
      ) : null}

      <div className="cal-timegrid-scroll" ref={scrollRef}>
        <div className="cal-timegrid-body" style={{ height: 24 * HOUR_PX }}>
          <div className="cal-timegrid-hours" aria-hidden="true">
            {hours.map((hour) => (
              <span key={hour} style={{ top: hour * HOUR_PX }}>
                {hour ? clockLabel(hour * 60) : ""}
              </span>
            ))}
          </div>

          {columns.map(({ day, key, timed, timedTasks }) => (
            <div
              key={key}
              className={`cal-timegrid-lane${key === todayKey ? " today" : ""}${day.getDay() === 0 || day.getDay() === 6 ? " weekend" : ""}`}
              data-key={`lane-${key}`}
              onClick={(event) => handleLaneClick(day, event)}
              onPointerMove={(event) => handleLaneHover(key, event)}
              onPointerLeave={() => setGhost(null)}
              role="presentation"
            >
              {ghost && ghost.key === key ? (
                <span className="cal-ghost" style={{ top: (ghost.minutes / 60) * HOUR_PX, "--hour-px": `${HOUR_PX}px` } as React.CSSProperties} aria-hidden="true">
                  <b>{clockLabel(ghost.minutes)}</b>
                </span>
              ) : null}
              {hours.map((hour) => (
                <i key={hour} className="cal-timegrid-rule" style={{ top: hour * HOUR_PX }} aria-hidden="true" />
              ))}

              <AnimatePresence>
                {timed.map((occurrence, index) => {
                  const top = (occurrence.startMin / 60) * HOUR_PX;
                  const height = Math.max(((occurrence.endMin - occurrence.startMin) / 60) * HOUR_PX, 22);
                  const width = 100 / occurrence.columns;
                  const compact = height < 40;
                  return (
                    <motion.button
                      key={`ev-${occurrence.event.occurrenceId ?? occurrence.event.id}`}
                      type="button"
                      className={`cal-event cal-event-block ${eventClass(occurrence.event)}${compact ? " compact" : ""}${occurrence.isStart ? "" : " continues-before"}${occurrence.isEnd ? "" : " continues-after"}`}
                      style={{ top, height, left: `calc(${occurrence.column * width}% + 2px)`, width: `calc(${width}% - 4px)` }}
                      data-key={`ev-${occurrence.event.occurrenceId ?? occurrence.event.id}`}
                      data-spot=""
                      onClick={() => onEventSelect(occurrence.event)}
                      title={`${occurrenceTime(occurrence)} · ${occurrence.event.title}`}
                      initial={reduceMotion ? false : { opacity: 0, scaleY: 0 }}
                      animate={{ opacity: 1, scaleY: 1 }}
                      exit={reduceMotion ? undefined : { opacity: 0, scaleY: 0.9 }}
                      transition={{ duration: 0.7, ease: EASE, delay: 0.15 + index * 0.06 }}
                    >
                      <span className="cal-event-block-copy">
                        <strong>{occurrence.event.title}</strong>
                        <span className="cal-event-time">{occurrenceTime(occurrence)}</span>
                        {!compact && occurrence.event.location ? (
                          <span className="cal-event-place">
                            <MapPin size={10} /> {occurrence.event.location}
                          </span>
                        ) : null}
                      </span>
                      <EventStatusGlyph event={occurrence.event} />
                    </motion.button>
                  );
                })}
                {timedTasks.map((task) => {
                  const minutes = taskMinutes(task) ?? 0;
                  const list = listById.get(task.listId);
                  return (
                    <motion.button
                      key={`tk-${task.id}`}
                      type="button"
                      className={`calendar-task cal-task-pin cal-task-timed color-${listById.get(task.listId)?.color ?? task.color}${taskStateClass(task, todayKey)}`}
                      data-key={`tk-${task.id}`}
                      data-spot=""
                      style={{ top: (minutes / 60) * HOUR_PX - 11 }}
                      onClick={() => onTaskSelect(task.id)}
                      title={`${formattedTime(task.dueTime)} · ${task.title}${list ? ` · ${list.name}` : ""}`}
                      initial={reduceMotion ? false : { opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={reduceMotion ? undefined : { opacity: 0, x: -6 }}
                      transition={springs.snappy}
                    >
                      <i aria-hidden="true" />
                      <span className="calendar-task-title">{task.title || "Untitled"}{task.parentTitle ? <small className="calendar-parent-context"> · {task.parentTitle}</small> : null}</span>
                      {task.isCompleted ? <Check size={11} aria-hidden="true" /> : null}
                    </motion.button>
                  );
                })}
              </AnimatePresence>

              {key === todayKey && nowMinutes !== null ? (
                <span className="cal-now" style={{ top: (nowMinutes / 60) * HOUR_PX }} aria-hidden="true">
                  <i />
                  <b>{clockLabel(nowMinutes)}</b>
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------
   Mini month (day view navigator)
   ------------------------------------------------------------------------ */

function MiniMonth({
  selected,
  occurrencesByDate,
  tasksByDate,
  onSelect,
}: {
  selected: Date;
  occurrencesByDate: Map<string, Occurrence[]>;
  tasksByDate: Map<string, StickyTask[]>;
  onSelect: (day: Date) => void;
}) {
  const [cursor, setCursor] = useState(() => startOfMonth(selected));
  const shown = isSameMonth(cursor, selected) ? cursor : startOfMonth(selected);
  const gridStart = startOfWeek(shown);
  const days = eachDayOfInterval({ start: gridStart, end: addDays(gridStart, 41) });

  return (
    <div className="cal-mini" aria-label="Mini month">
      <div className="cal-mini-head">
        <strong>{format(shown, "MMMM")}</strong>
        <span>
          <button type="button" aria-label="Previous month" onClick={() => setCursor(addMonths(shown, -1))}>
            <ChevronLeft size={14} />
          </button>
          <button type="button" aria-label="Next month" onClick={() => setCursor(addMonths(shown, 1))}>
            <ChevronRight size={14} />
          </button>
        </span>
      </div>
      <div className="cal-mini-grid">
        {WEEKDAYS.map((day) => (
          <i key={day}>{day[0]}</i>
        ))}
        {days.map((day) => {
          const key = dayKey(day);
          const eventColors = Array.from(new Set((occurrencesByDate.get(key) ?? []).map((item) => item.event.color ?? "azure"))).slice(0, 3);
          const hasTasks = (tasksByDate.get(key) ?? []).length > 0;
          return (
            <button
              key={key}
              type="button"
              className={`cal-mini-day${isSameMonth(day, shown) ? "" : " muted"}${isToday(day) ? " today" : ""}${isSameDay(day, selected) ? " selected" : ""}`}
              aria-label={format(day, "EEEE, MMMM d")}
              onClick={() => onSelect(day)}
            >
              {format(day, "d")}
              {eventColors.length || hasTasks ? (
                <span className="cal-mini-dots" aria-hidden="true">
                  {eventColors.map((color) => (
                    <i key={color} style={{ "--dot": `var(--${color}-edge)` } as React.CSSProperties} />
                  ))}
                  {hasTasks ? <i /> : null}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------
   Agenda (month sidebar + day briefing)
   ------------------------------------------------------------------------ */

type CalendarAgendaProps = {
  content: CalendarContent;
  date: Date;
  tasks: StickyTask[];
  occurrences: Occurrence[];
  listById: Map<string, StickyList>;
  recurringTaskIds: ReadonlySet<string>;
  nowMinutes: number | null;
  onTaskSelect: (taskId: string) => void;
  onEventSelect: (event: StickyCalendarEvent) => void;
  onCreateEvent: () => void;
  onOpenDay?: () => void;
  rich?: boolean;
};

function CalendarAgenda({
  content,
  date,
  tasks,
  occurrences,
  listById,
  recurringTaskIds,
  nowMinutes,
  onTaskSelect,
  onEventSelect,
  onCreateEvent,
  onOpenDay,
  rich,
}: CalendarAgendaProps) {
  const reduceMotion = useReducedMotion();
  const todayKey = dayKey(new Date());
  const listRank = useMemo(() => new Map(Array.from(listById.keys()).map((id, index) => [id, index])), [listById]);
  const busy = occurrences.reduce(
    (sum, item) => (item.event.allDay || item.event.transparency === "transparent" ? sum : sum + (item.endMin - item.startMin)),
    0,
  );

  // One chronological timeline: events and tasks interleaved by time.
  type Row = { key: string; minutes: number; kind: "event"; occurrence: Occurrence } | { key: string; minutes: number; kind: "task"; task: StickyTask };
  const rows: Row[] = [
    ...occurrences.map((occurrence) => ({
      key: `ev-${occurrence.event.occurrenceId ?? occurrence.event.id}`,
      minutes: occurrence.event.allDay ? -1 : occurrence.startMin,
      kind: "event" as const,
      occurrence,
    })),
    // Untimed tasks sort after every timed item in their group ("any time").
    ...tasks.map((task) => ({ key: `tk-${task.id}`, minutes: taskMinutes(task) ?? 24 * 60 + 1, kind: "task" as const, task })),
  ].sort((a, b) => {
    // One-off items run chronologically; repeating tasks trail, ranked by
    // their list's position on the dashboard, then by time.
    const aRepeats = a.kind === "task" && recurringTaskIds.has(a.task.id) ? 1 : 0;
    const bRepeats = b.kind === "task" && recurringTaskIds.has(b.task.id) ? 1 : 0;
    if (aRepeats !== bRepeats) return aRepeats - bRepeats;
    if (aRepeats && a.kind === "task" && b.kind === "task") {
      const rank = (listRank.get(a.task.listId) ?? Number.MAX_SAFE_INTEGER) - (listRank.get(b.task.listId) ?? Number.MAX_SAFE_INTEGER);
      if (rank) return rank;
    }
    return a.minutes - b.minutes;
  });

  const nowIndex =
    nowMinutes === null
      ? -1
      : rows.findIndex((row) => !(row.kind === "task" && recurringTaskIds.has(row.task.id)) && row.minutes > nowMinutes);

  return (
    <aside className={`calendar-agenda${rich ? " rich" : ""}`} aria-label={`Schedule for ${format(date, "MMMM d")}`}>
      <header className="calendar-agenda-header">
        <span className="calendar-agenda-date">
          <small>{format(date, "EEE")}</small>
          <strong>{format(date, "d")}</strong>
        </span>
        <div className="calendar-agenda-copy">
          <strong>{isToday(date) ? "Today" : format(date, "MMMM d")}</strong>
          <small>
            {contentSummary(content, occurrences.length, tasks.length)}
            {busy ? ` · ${durationLabel(busy)} busy` : ""}
          </small>
        </div>
        {onOpenDay ? (
          <button type="button" className="calendar-agenda-open" onClick={onOpenDay} aria-label={`Open ${format(date, "MMMM d")} in day view`}>
            Day
          </button>
        ) : null}
        <button type="button" className="calendar-agenda-add" onClick={onCreateEvent} aria-label={`Add event on ${format(date, "MMMM d")}`}>
          <Plus size={15} />
        </button>
      </header>

      <div className="calendar-agenda-list">
        {rows.length ? (
          <ol className="cal-timeline">
            <AnimatePresence mode="popLayout">
              {rows.map((row, index) => {
                const rowMotion = reduceMotion
                  ? {}
                  : {
                      layout: "position" as const,
                      initial: { opacity: 0, x: 10 },
                      animate: { opacity: 1, x: 0 },
                      exit: { opacity: 0, x: -10 },
                      transition: { ...springs.paper, delay: 0.08 + index * 0.05 },
                    };
                const nowMarker =
                  nowIndex === index ? (
                    <span className="cal-timeline-now" aria-hidden="true">
                      <span>Now</span>
                      <i />
                    </span>
                  ) : null;

                if (row.kind === "event") {
                  const { occurrence } = row;
                  const { event } = occurrence;
                  const minutes = occurrence.endMin - occurrence.startMin;
                  return (
                    <motion.li key={row.key} {...rowMotion}>
                      {nowMarker}
                      <button type="button" className={`cal-event cal-event-row ${eventClass(event)}`} data-key={`ev-${event.occurrenceId ?? event.id}`} data-spot="" onClick={() => onEventSelect(event)}>
                        <span className="cal-row-time">
                          <strong>{event.allDay ? "All day" : clockLabel(occurrence.startMin)}</strong>
                          {!event.allDay ? <small>{durationLabel(minutes)}</small> : null}
                        </span>
                        <i className="cal-row-rail" aria-hidden="true" />
                        <span className="cal-row-copy">
                          <strong>{event.title}</strong>
                          <span className="cal-row-meta">
                            {!event.allDay ? <span>{clockLabel(occurrence.startMin)} – {clockLabel(occurrence.endMin)}</span> : null}
                            {event.location ? (
                              <span>
                                <MapPin size={10} /> {event.location}
                              </span>
                            ) : null}
                            {rich && event.details ? <em>{event.details}</em> : null}
                          </span>
                        </span>
                        <EventStatusGlyph event={event} />
                      </button>
                    </motion.li>
                  );
                }

                const { task } = row;
                const list = listById.get(task.listId);
                const time = formattedTime(task.dueTime);
                return (
                  <motion.li key={row.key} {...rowMotion}>
                    {nowMarker}
                    <button
                      type="button"
                      className={`calendar-agenda-task cal-task-row color-${listById.get(task.listId)?.color ?? task.color}${taskStateClass(task, todayKey)}`}
                      data-key={`tk-${task.id}`}
                      data-spot=""
                      onClick={() => onTaskSelect(task.id)}
                    >
                      <span className="cal-row-time">
                        <strong>{time ?? "Any time"}</strong>
                        <small>due</small>
                      </span>
                      <i className="cal-row-rail" aria-hidden="true" />
                      <span className="cal-row-copy">
                        <strong>{task.title || "Untitled task"}</strong>{task.parentTitle ? <span className="calendar-parent-context">{task.parentTitle}</span> : null}
                        <span className="cal-row-meta">
                          {list ? <em>{list.name}</em> : null}
                          {recurringTaskIds.has(task.id) ? (
                            <span>
                              <Repeat2 size={10} /> Repeats
                            </span>
                          ) : null}
                          <span>{task.isCompleted ? "Completed" : task.dueTime ? "Scheduled" : "Flexible"}</span>
                        </span>
                      </span>
                      <span className={`cal-task-check${task.isCompleted ? " done" : ""}`} aria-hidden="true">
                        {task.isCompleted ? <Check size={12} /> : null}
                      </span>
                    </button>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ol>
        ) : (
          <div className="calendar-agenda-empty">
            <CalendarDays size={18} />
            <span>{emptyContent(content)}</span>
            <button type="button" onClick={onCreateEvent}>
              <Plus size={13} /> Reserve time
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------------
   Event editor sheet
   ------------------------------------------------------------------------ */

type EventEditorProps = {
  draft: EventDraft;
  onChange: (draft: EventDraft) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
  saving: boolean;
  deleting: boolean;
};

function EventEditor({ draft, onChange, onClose, onSave, onDelete, saving, deleting }: EventEditorProps) {
  const reduceMotion = useReducedMotion();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const invalidTime = !draft.allDay && draft.endTime <= draft.startTime;
  const canSave = Boolean(draft.title.trim()) && !invalidTime && !saving;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const set = (patch: Partial<EventDraft>) => onChange({ ...draft, ...patch });

  return (
    <motion.div
      className="cal-sheet-backdrop"
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.16 } }}
      transition={{ duration: 0.22 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.form
        className={`cal-sheet color-${draft.color ?? "default"}`}
        role="dialog"
        aria-modal="true"
        aria-label={draft.id ? "Edit calendar event" : "Create calendar event"}
        initial={reduceMotion ? false : { opacity: 0, y: 28, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reduceMotion ? undefined : { opacity: 0, y: 16, scale: 0.98 }}
        transition={reduceMotion ? { duration: 0 } : springs.drawer}
        onSubmit={(event) => {
          event.preventDefault();
          if (canSave) onSave();
        }}
      >
        <span className="cal-sheet-seam" aria-hidden="true" />
        <header className="cal-sheet-head">
          <div>
            <p>{draft.repeating ? "Edit repeating event" : draft.id ? "Edit event" : "Reserve time"}</p>
            <h3>{draft.title.trim() || "Untitled event"}</h3>
          </div>
          <button type="button" className="cal-sheet-close" onClick={onClose} aria-label="Close event editor">
            <X size={17} />
          </button>
        </header>

        {draft.repeating ? <p>Changes apply to every occurrence. Times are in {draft.timezone}.</p> : null}

        <label className="cal-field cal-field-title">
          <span>Title</span>
          <input
            autoFocus
            required
            maxLength={240}
            value={draft.title}
            onChange={(event) => set({ title: event.target.value })}
            placeholder="Focus block, appointment, workout…"
          />
        </label>

        <div className="cal-sheet-row">
          <div className="cal-segmented cal-sheet-toggle" role="group" aria-label="Event length">
            {[
              { value: false, label: "Timed" },
              { value: true, label: "All day" },
            ].map((option) => (
              <button
                key={String(option.value)}
                type="button"
                className={draft.allDay === option.value ? "active" : ""}
                aria-pressed={draft.allDay === option.value}
                onClick={() => set({ allDay: option.value })}
              >
                {draft.allDay === option.value ? (
                  <motion.span className="cal-segmented-pill" layoutId="cal-sheet-length" transition={reduceMotion ? { duration: 0 } : springs.snappy} aria-hidden="true" />
                ) : null}
                <span className="cal-segmented-label">{option.label}</span>
              </button>
            ))}
          </div>
          <div className="cal-segmented cal-sheet-toggle" role="group" aria-label="Availability">
            {[
              { value: "opaque", label: "Busy" },
              { value: "transparent", label: "Free" },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                className={draft.transparency === option.value ? "active" : ""}
                aria-pressed={draft.transparency === option.value}
                onClick={() => set({ transparency: option.value as EventDraft["transparency"] })}
              >
                {draft.transparency === option.value ? (
                  <motion.span className="cal-segmented-pill" layoutId="cal-sheet-avail" transition={reduceMotion ? { duration: 0 } : springs.snappy} aria-hidden="true" />
                ) : null}
                <span className="cal-segmented-label">{option.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className={`cal-sheet-when${draft.allDay ? " all-day" : ""}`}>
          <label className="cal-field">
            <span>{draft.allDay ? "From" : "Date"}</span>
            <input required type="date" value={draft.date} onChange={(event) => set({ date: event.target.value })} />
          </label>
          {draft.allDay ? (
            <label className="cal-field">
              <span>Until</span>
              <input type="date" min={draft.date} value={draft.endDate} onChange={(event) => set({ endDate: event.target.value })} />
            </label>
          ) : (
            <>
              <label className="cal-field">
                <span>Starts</span>
                <input required type="time" value={draft.startTime} onChange={(event) => set({ startTime: event.target.value })} />
              </label>
              <label className={`cal-field${invalidTime ? " invalid" : ""}`}>
                <span>Ends</span>
                <input required type="time" value={draft.endTime} onChange={(event) => set({ endTime: event.target.value })} />
              </label>
            </>
          )}
        </div>

        <div className="cal-field">
          <span>Color</span>
          <div className="cal-swatches" role="radiogroup" aria-label="Event color">
            {EVENT_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                role="radio"
                aria-checked={draft.color === color}
                aria-label={color}
                className={`cal-swatch color-${color}${draft.color === color ? " active" : ""}`}
                onClick={() => set({ color: draft.color === color ? null : color })}
              />
            ))}
          </div>
        </div>

        <div className="cal-sheet-row">
          <label className="cal-field">
            <span>Location</span>
            <input maxLength={500} value={draft.location} onChange={(event) => set({ location: event.target.value })} placeholder="Optional" />
          </label>
          <label className="cal-field cal-field-status">
            <span>Status</span>
            <select value={draft.status} onChange={(event) => set({ status: event.target.value as EventDraft["status"] })}>
              <option value="confirmed">Confirmed</option>
              <option value="tentative">Tentative</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
        </div>

        <label className="cal-field">
          <span>Details</span>
          <textarea maxLength={20_000} rows={3} value={draft.details} onChange={(event) => set({ details: event.target.value })} placeholder="Anything worth remembering about this block" />
        </label>

        <footer className="cal-sheet-foot">
          {draft.id ? (
            <button
              type="button"
              className={`cal-sheet-delete${confirmDelete ? " armed" : ""}`}
              disabled={deleting}
              onClick={() => (confirmDelete ? onDelete() : setConfirmDelete(true))}
              onBlur={() => setConfirmDelete(false)}
            >
              <Trash2 size={14} />
              {confirmDelete ? (draft.repeating ? "Delete entire series" : "Confirm delete") : "Delete"}
            </button>
          ) : (
            <span />
          )}
          <div>
            <button type="button" className="cal-sheet-cancel" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="cal-sheet-save" disabled={!canSave}>
              {saving ? "Saving…" : draft.id ? "Save changes" : "Reserve"}
            </button>
          </div>
        </footer>
      </motion.form>
    </motion.div>
  );
}
