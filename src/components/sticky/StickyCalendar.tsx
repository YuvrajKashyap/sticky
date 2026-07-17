import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  format,
  isSameDay,
  isSameMonth,
  isSameYear,
  isToday,
  startOfMonth,
  startOfDay,
  startOfWeek,
} from "date-fns";
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, MapPin, Plus, Trash2, X } from "lucide-react";
import { createStickyPlatformClient } from "@/lib/sticky/api-client";
import type { AppMode, StickyColor, StickyList, StickyTask } from "@/types/sticky";
import styles from "./StickyCalendar.module.css";

type StickyCalendarProps = {
  tasks: StickyTask[];
  lists: StickyList[];
  onTaskSelect: (taskId: string) => void;
  mode: AppMode;
};

type StickyCalendarRecord = {
  id: string;
  name: string;
  color: StickyColor;
  timezone: string;
  isDefault: boolean;
};

type StickyCalendarEvent = {
  id: string;
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

type EventDraft = {
  id: string | null;
  version: number | null;
  title: string;
  details: string;
  location: string;
  date: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
};

type CalendarViewMode = "month" | "week" | "day";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const VIEW_MODES: Array<{ label: string; value: CalendarViewMode }> = [
  { label: "Month", value: "month" },
  { label: "Week", value: "week" },
  { label: "Day", value: "day" },
];

function formattedTime(value: string | null) {
  if (!value) {
    return null;
  }

  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return value;
  }

  return format(new Date(2000, 0, 1, hours, minutes), "h:mm a");
}

function bySchedule(a: StickyTask, b: StickyTask) {
  return (a.dueTime ?? "23:59").localeCompare(b.dueTime ?? "23:59") || a.title.localeCompare(b.title);
}

function weekTitle(start: Date, end: Date) {
  if (isSameMonth(start, end)) {
    return `${format(start, "MMM d")} - ${format(end, "d, yyyy")}`;
  }

  if (isSameYear(start, end)) {
    return `${format(start, "MMM d")} - ${format(end, "MMM d, yyyy")}`;
  }

  return `${format(start, "MMM d, yyyy")} - ${format(end, "MMM d, yyyy")}`;
}

function taskStateClass(task: StickyTask, todayKey: string) {
  return `${task.isCompleted ? " completed" : ""}${
    !task.isCompleted && task.dueDate && task.dueDate < todayKey ? " overdue" : ""
  }`;
}

function eventDateKey(event: StickyCalendarEvent) {
  return event.allDay ? event.startDate : event.startAt ? format(new Date(event.startAt), "yyyy-MM-dd") : null;
}

function eventTime(event: StickyCalendarEvent) {
  return event.allDay || !event.startAt ? "All day" : format(new Date(event.startAt), "h:mm a");
}

export function StickyCalendar({ tasks, lists, onTaskSelect, mode }: StickyCalendarProps) {
  const today = useMemo(() => new Date(), []);
  const todayKey = format(today, "yyyy-MM-dd");
  const [viewMode, setViewMode] = useState<CalendarViewMode>("month");
  const [anchorDate, setAnchorDate] = useState(today);
  const [selectedDate, setSelectedDate] = useState(today);
  const [eventDraft, setEventDraft] = useState<EventDraft | null>(null);
  const [eventMessage, setEventMessage] = useState<string | null>(null);
  const client = useMemo(() => mode === "supabase" ? createStickyPlatformClient() : null, [mode]);
  const queryClient = useQueryClient();
  const monthStart = startOfMonth(anchorDate);
  const calendarStart = startOfWeek(monthStart);
  const monthDays = eachDayOfInterval({ start: calendarStart, end: addDays(calendarStart, 41) });
  const weekStart = startOfWeek(anchorDate);
  const weekDays = eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) });
  const weekEnd = weekDays[6];
  const listById = useMemo(() => new Map(lists.map((list) => [list.id, list])), [lists]);
  const visibleStart = viewMode === "month" ? calendarStart : viewMode === "week" ? weekStart : startOfDay(selectedDate);
  const visibleEnd = viewMode === "month" ? addDays(calendarStart, 42) : viewMode === "week" ? addDays(weekStart, 7) : addDays(startOfDay(selectedDate), 1);
  const visibleRange = { from: visibleStart.toISOString(), to: visibleEnd.toISOString() };
  const calendarsQuery = useQuery({
    queryKey: ["sticky-calendars"],
    enabled: Boolean(client),
    queryFn: () => client!.request<{ calendars: StickyCalendarRecord[] }>("/api/v1/calendars"),
  });
  const eventsQuery = useQuery({
    queryKey: ["sticky-calendar-events", visibleRange.from, visibleRange.to],
    enabled: Boolean(client),
    queryFn: () => client!.request<{ events: StickyCalendarEvent[] }>(`/api/v1/calendar-events?from=${encodeURIComponent(visibleRange.from)}&to=${encodeURIComponent(visibleRange.to)}`),
  });
  const events = useMemo(() => eventsQuery.data?.events ?? [], [eventsQuery.data?.events]);
  const saveEvent = useMutation({
    mutationFn: async (draft: EventDraft) => {
      if (!client) throw new Error("Sign in to save calendar events.");
      const schedule = draft.allDay
        ? { allDay: true, startDate: draft.date, endDate: format(addDays(new Date(`${draft.date}T12:00:00`), 1), "yyyy-MM-dd") }
        : {
            allDay: false,
            startAt: new Date(`${draft.date}T${draft.startTime}:00`).toISOString(),
            endAt: new Date(`${draft.date}T${draft.endTime}:00`).toISOString(),
          };
      const common = { title: draft.title, details: draft.details, location: draft.location, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago", ...schedule };
      if (draft.id && draft.version) {
        return client.request(`/api/v1/calendar-events/${draft.id}`, { method: "PATCH", body: JSON.stringify({ version: draft.version, ...common }) });
      }
      return client.request("/api/v1/calendar-events", { method: "POST", body: JSON.stringify(common) });
    },
    onSuccess: () => {
      setEventDraft(null);
      setEventMessage("Calendar saved.");
      void queryClient.invalidateQueries({ queryKey: ["sticky-calendar-events"] });
    },
    onError: (error) => setEventMessage(error.message),
  });
  const deleteEvent = useMutation({
    mutationFn: async (draft: EventDraft) => {
      if (!client || !draft.id) return;
      return client.request(`/api/v1/calendar-events/${draft.id}`, { method: "DELETE", body: JSON.stringify({ confirmation: { confirmed: true, summary: `delete ${draft.id}` } }) });
    },
    onSuccess: () => {
      setEventDraft(null);
      setEventMessage("Event deleted.");
      void queryClient.invalidateQueries({ queryKey: ["sticky-calendar-events"] });
    },
    onError: (error) => setEventMessage(error.message),
  });

  const tasksByDate = useMemo(() => {
    const grouped = new Map<string, StickyTask[]>();

    for (const task of tasks) {
      if (!task.dueDate) {
        continue;
      }

      const dateKey = task.dueDate.slice(0, 10);
      const dateTasks = grouped.get(dateKey) ?? [];
      dateTasks.push(task);
      grouped.set(dateKey, dateTasks);
    }

    grouped.forEach((dateTasks) => dateTasks.sort(bySchedule));
    return grouped;
  }, [tasks]);

  const eventsByDate = useMemo(() => {
    const grouped = new Map<string, StickyCalendarEvent[]>();
    for (const event of events) {
      const startKey = eventDateKey(event);
      if (!startKey) continue;
      if (event.allDay && event.endDate) {
        let cursor = new Date(`${startKey}T12:00:00`);
        const exclusiveEnd = new Date(`${event.endDate}T12:00:00`);
        while (cursor < exclusiveEnd) {
          const key = format(cursor, "yyyy-MM-dd");
          grouped.set(key, [...(grouped.get(key) ?? []), event]);
          cursor = addDays(cursor, 1);
        }
      } else {
        grouped.set(startKey, [...(grouped.get(startKey) ?? []), event]);
      }
    }
    grouped.forEach((dayEvents) => dayEvents.sort((a, b) => (a.startAt ?? "").localeCompare(b.startAt ?? "")));
    return grouped;
  }, [events]);

  const selectedDateKey = format(selectedDate, "yyyy-MM-dd");
  const selectedTasks = tasksByDate.get(selectedDateKey) ?? [];
  const selectedEvents = eventsByDate.get(selectedDateKey) ?? [];
  const monthKey = format(monthStart, "yyyy-MM");
  const weekStartKey = format(weekStart, "yyyy-MM-dd");
  const weekEndKey = format(weekEnd, "yyyy-MM-dd");
  const periodTaskCount = tasks.filter((task) => {
    if (!task.dueDate) {
      return false;
    }
    if (viewMode === "month") {
      return task.dueDate.startsWith(monthKey);
    }
    if (viewMode === "week") {
      return task.dueDate >= weekStartKey && task.dueDate <= weekEndKey;
    }
    return task.dueDate === selectedDateKey;
  }).length;
  const periodEventCount = events.filter((event) => {
    const key = eventDateKey(event);
    if (!key) return false;
    if (viewMode === "month") return key.startsWith(monthKey);
    if (viewMode === "week") return key >= weekStartKey && key <= weekEndKey;
    return key === selectedDateKey;
  }).length;
  const overdueCount = tasks.filter(
    (task) => Boolean(task.dueDate && task.dueDate < todayKey && !task.isCompleted),
  ).length;
  const periodLabel = viewMode === "month" ? "this month" : viewMode === "week" ? "this week" : "this day";
  const rangeTitle =
    viewMode === "month"
      ? format(monthStart, "MMMM yyyy")
      : viewMode === "week"
        ? weekTitle(weekStart, weekEnd)
        : format(selectedDate, "EEEE, MMMM d");

  function selectMonthDate(day: Date) {
    setSelectedDate(day);
    if (!isSameMonth(day, monthStart)) {
      setAnchorDate(day);
    }
  }

  function openDay(day: Date) {
    setSelectedDate(day);
    setAnchorDate(day);
    setViewMode("day");
  }

  function changeView(nextView: CalendarViewMode) {
    setViewMode(nextView);
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

  function createEventFor(day = selectedDate) {
    setEventMessage(null);
    setEventDraft({
      id: null,
      version: null,
      title: "",
      details: "",
      location: "",
      date: format(day, "yyyy-MM-dd"),
      startTime: "09:00",
      endTime: "09:30",
      allDay: false,
    });
  }

  function editEvent(event: StickyCalendarEvent) {
    const date = eventDateKey(event) ?? selectedDateKey;
    setEventMessage(null);
    setEventDraft({
      id: event.id,
      version: event.version,
      title: event.title,
      details: event.details,
      location: event.location,
      date,
      startTime: event.startAt ? format(new Date(event.startAt), "HH:mm") : "09:00",
      endTime: event.endAt ? format(new Date(event.endAt), "HH:mm") : "09:30",
      allDay: event.allDay,
    });
  }

  return (
    <section className={`calendar-view calendar-mode-${viewMode}`} aria-label="Workspace calendar">
      <header className="calendar-header">
        <div className="calendar-heading">
          <span className="calendar-heading-icon" aria-hidden="true">
            <CalendarDays size={18} />
          </span>
          <div>
            <p>Workspace calendar</p>
            <h2 className="calendar-month-title" aria-live="polite">
              {rangeTitle}
            </h2>
          </div>
        </div>

        <div className="calendar-view-switcher" aria-label="Calendar view">
          {VIEW_MODES.map((mode) => (
            <button
              key={mode.value}
              type="button"
              className={viewMode === mode.value ? "active" : ""}
              aria-pressed={viewMode === mode.value}
              onClick={() => changeView(mode.value)}
            >
              {mode.label}
            </button>
          ))}
        </div>

        <div className="calendar-summary" aria-label={`Calendar summary for ${calendarsQuery.data?.calendars.find((calendar) => calendar.isDefault)?.name ?? "Sticky"}`}>
          <span><strong>{periodTaskCount}</strong> {periodLabel}</span>
          <span><strong>{periodEventCount}</strong> {periodEventCount === 1 ? "event" : "events"}</span>
          <span className={overdueCount ? "has-overdue" : ""}><strong>{overdueCount}</strong> overdue</span>
        </div>

        <div className="calendar-controls">
          <button type="button" onClick={() => createEventFor()} className={styles.addEvent} disabled={!client}>
            <Plus size={16} /> Event
          </button>
          <button
            type="button"
            onClick={() => shiftRange(-1)}
            className="calendar-nav-btn"
            aria-label={`Previous ${viewMode}`}
          >
            <ChevronLeft size={18} />
          </button>
          <button type="button" onClick={showToday} className="calendar-today-btn">
            Today
          </button>
          <button
            type="button"
            onClick={() => shiftRange(1)}
            className="calendar-nav-btn"
            aria-label={`Next ${viewMode}`}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </header>

      {eventMessage || eventsQuery.error ? (
        <p className={styles.status} role="status">{eventMessage ?? eventsQuery.error?.message}</p>
      ) : null}

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
              {monthDays.map((day) => {
                const dateKey = format(day, "yyyy-MM-dd");
                const dayTasks = tasksByDate.get(dateKey) ?? [];
                const dayEvents = eventsByDate.get(dateKey) ?? [];
                const visibleEvents = dayEvents.slice(0, 2);
                const visibleTasks = dayTasks.slice(0, Math.max(0, 3 - visibleEvents.length));
                const remainingTasks = dayTasks.length + dayEvents.length - visibleTasks.length - visibleEvents.length;
                const isCurrentMonth = isSameMonth(day, monthStart);
                const selected = isSameDay(day, selectedDate);

                return (
                  <article
                    key={dateKey}
                    className={`calendar-cell${!isCurrentMonth ? " out-of-month" : ""}${
                      isToday(day) ? " today" : ""
                    }${selected ? " selected" : ""}`}
                    aria-label={`${format(day, "EEEE, MMMM d")}, ${dayEvents.length} events and ${dayTasks.length} tasks`}
                  >
                    <button
                      type="button"
                      className="calendar-cell-header"
                      onClick={() => selectMonthDate(day)}
                      aria-label={`Show ${format(day, "MMMM d")}`}
                      aria-pressed={selected}
                    >
                      <span className="calendar-day-number">{format(day, "d")}</span>
                      {dayTasks.length + dayEvents.length ? <span className="calendar-day-count">{dayTasks.length + dayEvents.length}</span> : null}
                    </button>

                    <div className="calendar-cell-tasks">
                      {visibleEvents.map((event) => (
                        <button
                          key={event.id}
                          type="button"
                          className={styles.eventPill}
                          onClick={() => editEvent(event)}
                          title={`${eventTime(event)} · ${event.title}`}
                        >
                          <span>{eventTime(event)}</span>
                          <strong>{event.title}</strong>
                        </button>
                      ))}
                      {visibleTasks.map((task) => {
                        const time = formattedTime(task.dueTime);
                        const list = listById.get(task.listId);

                        return (
                          <button
                            key={task.id}
                            type="button"
                            className={`calendar-task color-${task.color}${taskStateClass(task, todayKey)}`}
                            onClick={() => onTaskSelect(task.id)}
                            title={`${task.title || "Untitled task"}${list ? ` - ${list.name}` : ""}`}
                          >
                            <i aria-hidden="true" />
                            {time ? <span className="calendar-task-time">{time}</span> : null}
                            <span className="calendar-task-title">{task.title || "Untitled"}</span>
                            {task.isCompleted ? <Check size={11} aria-hidden="true" /> : null}
                          </button>
                        );
                      })}

                      {remainingTasks > 0 ? (
                        <button type="button" className="calendar-more" onClick={() => selectMonthDate(day)}>
                          +{remainingTasks} more
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
            tasks={selectedTasks}
            events={selectedEvents}
            listById={listById}
            onTaskSelect={onTaskSelect}
            onEventSelect={editEvent}
            onCreateEvent={() => createEventFor(selectedDate)}
          />
        </div>
      ) : null}

      {viewMode === "week" ? (
        <div className="calendar-week-view" aria-label={`Week of ${format(weekStart, "MMMM d")}`}>
          {weekDays.map((day) => {
            const dateKey = format(day, "yyyy-MM-dd");
            const dayTasks = tasksByDate.get(dateKey) ?? [];
            const dayEvents = eventsByDate.get(dateKey) ?? [];

            return (
              <article
                key={dateKey}
                className={`calendar-week-day${isToday(day) ? " today" : ""}${
                  isSameDay(day, selectedDate) ? " selected" : ""
                }`}
              >
                <button
                  type="button"
                  className="calendar-week-day-header"
                  onClick={() => openDay(day)}
                  aria-label={`Open ${format(day, "EEEE, MMMM d")} in day view`}
                >
                  <span>{format(day, "EEE")}</span>
                  <strong>{format(day, "d")}</strong>
                  <small>{dayTasks.length + dayEvents.length || ""}</small>
                </button>

                <div className="calendar-week-task-list">
                  {dayEvents.map((event) => (
                    <button key={event.id} type="button" className={styles.weekEvent} onClick={() => editEvent(event)}>
                      <span>{eventTime(event)}</span>
                      <strong>{event.title}</strong>
                    </button>
                  ))}
                  {dayTasks.map((task) => {
                    const list = listById.get(task.listId);
                    const time = formattedTime(task.dueTime);

                    return (
                      <button
                        key={task.id}
                        type="button"
                        className={`calendar-week-task color-${task.color}${taskStateClass(task, todayKey)}`}
                        onClick={() => onTaskSelect(task.id)}
                      >
                        <i aria-hidden="true" />
                        <span className="calendar-week-task-copy">
                          <span>{time ?? "Any time"}</span>
                          <strong>{task.title || "Untitled task"}</strong>
                          {list ? <small>{list.name}</small> : null}
                        </span>
                        {task.isCompleted ? <Check size={13} aria-hidden="true" /> : null}
                      </button>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      {viewMode === "day" ? (
        <div className="calendar-day-view" aria-label={`Day view for ${format(selectedDate, "MMMM d")}`}>
          <header className="calendar-day-focus-header">
            <span className="calendar-day-focus-date">
              <small>{format(selectedDate, "EEE")}</small>
              <strong>{format(selectedDate, "d")}</strong>
            </span>
            <div>
              <p>{isToday(selectedDate) ? "Today" : format(selectedDate, "EEEE")}</p>
              <h3>{format(selectedDate, "MMMM d, yyyy")}</h3>
              <span>{selectedEvents.length} {selectedEvents.length === 1 ? "event" : "events"} · {selectedTasks.length} {selectedTasks.length === 1 ? "task" : "tasks"}</span>
            </div>
            <button type="button" className={styles.dayAdd} onClick={() => createEventFor(selectedDate)}><Plus size={16} />Add event</button>
          </header>

          <div className="calendar-day-schedule">
            {selectedEvents.map((event) => (
              <button key={event.id} type="button" className={styles.dayEvent} onClick={() => editEvent(event)}>
                <span><Clock3 size={14} />{eventTime(event)}</span>
                <i aria-hidden="true" />
                <span><strong>{event.title}</strong>{event.location ? <small><MapPin size={12} />{event.location}</small> : null}</span>
              </button>
            ))}
            {selectedTasks.length ? selectedTasks.map((task) => {
                const list = listById.get(task.listId);
                const time = formattedTime(task.dueTime);

                return (
                  <button
                    key={task.id}
                    type="button"
                    className={`calendar-day-task color-${task.color}${taskStateClass(task, todayKey)}`}
                    onClick={() => onTaskSelect(task.id)}
                  >
                    <span className="calendar-day-task-time">
                      {time ? <><Clock3 size={14} /> {time}</> : "Any time"}
                    </span>
                    <i aria-hidden="true" />
                    <span className="calendar-day-task-copy">
                      <strong>{task.title || "Untitled task"}</strong>
                      <span>
                        {list ? <em>{list.name}</em> : null}
                        {task.isCompleted ? "Completed" : task.dueTime ? "Scheduled" : "Flexible"}
                      </span>
                    </span>
                    {task.isCompleted ? <Check size={17} aria-hidden="true" /> : null}
                  </button>
                );
              }) : !selectedEvents.length ? (
              <div className="calendar-day-empty">
                <CalendarDays size={20} />
                <span>Nothing planned yet</span>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {eventDraft ? (
        <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEventDraft(null); }}>
          <form className={styles.editor} role="dialog" aria-modal="true" aria-label={eventDraft.id ? "Edit calendar event" : "Create calendar event"} onSubmit={(event) => { event.preventDefault(); saveEvent.mutate(eventDraft); }}>
            <header>
              <div><span>Sticky Calendar</span><h3>{eventDraft.id ? "Edit event" : "Reserve time"}</h3></div>
              <button type="button" onClick={() => setEventDraft(null)} aria-label="Close event editor"><X size={18} /></button>
            </header>
            <label className={styles.titleField}>
              <span>What is happening?</span>
              <input autoFocus required maxLength={240} value={eventDraft.title} onChange={(event) => setEventDraft({ ...eventDraft, title: event.target.value })} placeholder="Focus block, appointment, workout…" />
            </label>
            <div className={styles.whenGrid}>
              <label><span>Date</span><input required type="date" value={eventDraft.date} onChange={(event) => setEventDraft({ ...eventDraft, date: event.target.value })} /></label>
              {!eventDraft.allDay ? <>
                <label><span>Starts</span><input required type="time" value={eventDraft.startTime} onChange={(event) => setEventDraft({ ...eventDraft, startTime: event.target.value })} /></label>
                <label><span>Ends</span><input required type="time" value={eventDraft.endTime} onChange={(event) => setEventDraft({ ...eventDraft, endTime: event.target.value })} /></label>
              </> : null}
            </div>
            <label className={styles.allDay}><input type="checkbox" checked={eventDraft.allDay} onChange={(event) => setEventDraft({ ...eventDraft, allDay: event.target.checked })} /><span>All-day event</span></label>
            <label><span>Location</span><input maxLength={500} value={eventDraft.location} onChange={(event) => setEventDraft({ ...eventDraft, location: event.target.value })} placeholder="Optional" /></label>
            <label><span>Details</span><textarea maxLength={20_000} rows={3} value={eventDraft.details} onChange={(event) => setEventDraft({ ...eventDraft, details: event.target.value })} placeholder="Anything Poke should know about this block" /></label>
            <footer>
              {eventDraft.id ? <button type="button" className={styles.deleteButton} disabled={deleteEvent.isPending} onClick={() => { if (window.confirm(`Delete “${eventDraft.title}”?`)) deleteEvent.mutate(eventDraft); }}><Trash2 size={15} />Delete</button> : <span />}
              <div><button type="button" onClick={() => setEventDraft(null)}>Cancel</button><button type="submit" className={styles.saveButton} disabled={saveEvent.isPending || !eventDraft.title.trim() || (!eventDraft.allDay && eventDraft.endTime <= eventDraft.startTime)}>{saveEvent.isPending ? "Saving…" : "Save event"}</button></div>
            </footer>
          </form>
        </div>
      ) : null}
    </section>
  );
}

type CalendarAgendaProps = {
  date: Date;
  tasks: StickyTask[];
  events: StickyCalendarEvent[];
  listById: Map<string, StickyList>;
  onTaskSelect: (taskId: string) => void;
  onEventSelect: (event: StickyCalendarEvent) => void;
  onCreateEvent: () => void;
};

function CalendarAgenda({ date, tasks, events, listById, onTaskSelect, onEventSelect, onCreateEvent }: CalendarAgendaProps) {
  return (
    <aside className="calendar-agenda" aria-label={`Tasks for ${format(date, "MMMM d")}`}>
      <header className="calendar-agenda-header">
        <span>{format(date, "EEE")}</span>
        <div>
          <strong>{format(date, "MMMM d")}</strong>
          <small>{events.length} {events.length === 1 ? "event" : "events"} · {tasks.length} {tasks.length === 1 ? "task" : "tasks"}</small>
        </div>
        <button type="button" className={styles.agendaAdd} onClick={onCreateEvent} aria-label={`Add event on ${format(date, "MMMM d")}`}><Plus size={15} /></button>
      </header>

      <div className="calendar-agenda-list">
        {events.map((event) => (
          <button key={event.id} type="button" className={styles.agendaEvent} onClick={() => onEventSelect(event)}>
            <span>{eventTime(event)}</span>
            <strong>{event.title}</strong>
            {event.location ? <small><MapPin size={11} />{event.location}</small> : null}
          </button>
        ))}
        {tasks.length ? tasks.map((task) => {
            const list = listById.get(task.listId);
            const time = formattedTime(task.dueTime);

            return (
              <button
                key={task.id}
                type="button"
                className={`calendar-agenda-task color-${task.color}${task.isCompleted ? " completed" : ""}`}
                onClick={() => onTaskSelect(task.id)}
              >
                <i aria-hidden="true" />
                <span className="calendar-agenda-copy">
                  <strong>{task.title || "Untitled task"}</strong>
                  <span>
                    {time ? <><Clock3 size={12} /> {time}</> : "Any time"}
                    {list ? <em>{list.name}</em> : null}
                  </span>
                </span>
                {task.isCompleted ? <Check size={15} aria-label="Completed" /> : null}
              </button>
            );
          }) : !events.length ? (
          <div className="calendar-agenda-empty">
            <CalendarDays size={18} />
            <span>Nothing planned yet</span>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
