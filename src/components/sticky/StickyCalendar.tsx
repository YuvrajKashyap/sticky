import { useMemo, useState } from "react";
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
  startOfWeek,
} from "date-fns";
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock3 } from "lucide-react";
import type { StickyList, StickyTask } from "@/types/sticky";

type StickyCalendarProps = {
  tasks: StickyTask[];
  lists: StickyList[];
  onTaskSelect: (taskId: string) => void;
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

export function StickyCalendar({ tasks, lists, onTaskSelect }: StickyCalendarProps) {
  const today = useMemo(() => new Date(), []);
  const todayKey = format(today, "yyyy-MM-dd");
  const [viewMode, setViewMode] = useState<CalendarViewMode>("month");
  const [anchorDate, setAnchorDate] = useState(today);
  const [selectedDate, setSelectedDate] = useState(today);
  const monthStart = startOfMonth(anchorDate);
  const calendarStart = startOfWeek(monthStart);
  const monthDays = eachDayOfInterval({ start: calendarStart, end: addDays(calendarStart, 41) });
  const weekStart = startOfWeek(anchorDate);
  const weekDays = eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) });
  const weekEnd = weekDays[6];
  const listById = useMemo(() => new Map(lists.map((list) => [list.id, list])), [lists]);

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

  const selectedDateKey = format(selectedDate, "yyyy-MM-dd");
  const selectedTasks = tasksByDate.get(selectedDateKey) ?? [];
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

        <div className="calendar-summary" aria-label="Calendar summary">
          <span><strong>{periodTaskCount}</strong> {periodLabel}</span>
          <span className={overdueCount ? "has-overdue" : ""}><strong>{overdueCount}</strong> overdue</span>
        </div>

        <div className="calendar-controls">
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
                const visibleTasks = dayTasks.slice(0, 3);
                const remainingTasks = dayTasks.length - visibleTasks.length;
                const isCurrentMonth = isSameMonth(day, monthStart);
                const selected = isSameDay(day, selectedDate);

                return (
                  <article
                    key={dateKey}
                    className={`calendar-cell${!isCurrentMonth ? " out-of-month" : ""}${
                      isToday(day) ? " today" : ""
                    }${selected ? " selected" : ""}`}
                    aria-label={`${format(day, "EEEE, MMMM d")}, ${dayTasks.length} ${
                      dayTasks.length === 1 ? "task" : "tasks"
                    }`}
                  >
                    <button
                      type="button"
                      className="calendar-cell-header"
                      onClick={() => selectMonthDate(day)}
                      aria-label={`Show ${format(day, "MMMM d")}`}
                      aria-pressed={selected}
                    >
                      <span className="calendar-day-number">{format(day, "d")}</span>
                      {dayTasks.length ? <span className="calendar-day-count">{dayTasks.length}</span> : null}
                    </button>

                    <div className="calendar-cell-tasks">
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
            listById={listById}
            onTaskSelect={onTaskSelect}
          />
        </div>
      ) : null}

      {viewMode === "week" ? (
        <div className="calendar-week-view" aria-label={`Week of ${format(weekStart, "MMMM d")}`}>
          {weekDays.map((day) => {
            const dateKey = format(day, "yyyy-MM-dd");
            const dayTasks = tasksByDate.get(dateKey) ?? [];

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
                  <small>{dayTasks.length || ""}</small>
                </button>

                <div className="calendar-week-task-list">
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
              <span>{selectedTasks.length} {selectedTasks.length === 1 ? "task" : "tasks"} scheduled</span>
            </div>
          </header>

          <div className="calendar-day-schedule">
            {selectedTasks.length ? (
              selectedTasks.map((task) => {
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
              })
            ) : (
              <div className="calendar-day-empty">
                <CalendarDays size={20} />
                <span>No tasks scheduled</span>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

type CalendarAgendaProps = {
  date: Date;
  tasks: StickyTask[];
  listById: Map<string, StickyList>;
  onTaskSelect: (taskId: string) => void;
};

function CalendarAgenda({ date, tasks, listById, onTaskSelect }: CalendarAgendaProps) {
  return (
    <aside className="calendar-agenda" aria-label={`Tasks for ${format(date, "MMMM d")}`}>
      <header className="calendar-agenda-header">
        <span>{format(date, "EEE")}</span>
        <div>
          <strong>{format(date, "MMMM d")}</strong>
          <small>{tasks.length} {tasks.length === 1 ? "task" : "tasks"}</small>
        </div>
      </header>

      <div className="calendar-agenda-list">
        {tasks.length ? (
          tasks.map((task) => {
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
          })
        ) : (
          <div className="calendar-agenda-empty">
            <CalendarDays size={18} />
            <span>No tasks scheduled</span>
          </div>
        )}
      </div>
    </aside>
  );
}
