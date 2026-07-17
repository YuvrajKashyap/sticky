"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  CalendarDays,
  ListChecks,
  Radar,
  Repeat2,
  Sun,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, format } from "date-fns";
import type {
  StickyColor,
  StickyList,
  StickyRecurrenceRule,
  StickySubtask,
  StickyTask,
  StickyTaskViewFilter,
} from "@/types/sticky";
import { AnimatedNumber, springs } from "./motion";

type StickyOverviewProps = {
  lists: StickyList[];
  tasks: StickyTask[];
  subtasks: StickySubtask[];
  recurrenceByTask: Map<string, StickyRecurrenceRule>;
  onClose: () => void;
  onOpenTask: (taskId: string) => void;
  onSelectList: (listId: string) => void;
  onShowFilter: (filter: StickyTaskViewFilter) => void;
  onOpenCalendar: () => void;
};

type ReactorSegment = {
  listId: string;
  name: string;
  color: StickyColor;
  activeCount: number;
  startAngle: number;
  endAngle: number;
};

type QueueTask = {
  id: string;
  title: string;
  listName: string;
  color: StickyColor;
  dueLabel: string | null;
  isOverdue: boolean;
  isRecurring: boolean;
  openSubtasks: number;
};

type HorizonDay = {
  key: string;
  weekday: string;
  dayOfMonth: string;
  count: number;
  isToday: boolean;
};

const SEGMENT_GAP_DEGREES = 5;
const REACTOR_SIZE = 460;
const REACTOR_CENTER = REACTOR_SIZE / 2;
const SEGMENT_RADIUS = 186;
const COMPLETION_RADIUS = 142;
const HORIZON_DAYS = 14;

function polarPoint(radius: number, angleDegrees: number): [number, number] {
  const radians = ((angleDegrees - 90) * Math.PI) / 180;
  return [
    REACTOR_CENTER + radius * Math.cos(radians),
    REACTOR_CENTER + radius * Math.sin(radians),
  ];
}

function arcPath(radius: number, startAngle: number, endAngle: number): string {
  const [startX, startY] = polarPoint(radius, startAngle);
  const [endX, endY] = polarPoint(radius, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${startX.toFixed(2)} ${startY.toFixed(2)} A ${radius} ${radius} 0 ${largeArc} 1 ${endX.toFixed(2)} ${endY.toFixed(2)}`;
}

function buildReactorSegments(
  lists: StickyList[],
  activeByList: Map<string, number>,
): ReactorSegment[] {
  // Keep the geometry calculation pure from React's point of view. The cursor
  // is local to this helper and cannot be observed between renders.
  const weights = lists.map((list) => Math.max(activeByList.get(list.id) ?? 0, 0.4));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const sweepBudget = 360 - SEGMENT_GAP_DEGREES * Math.max(lists.length, 1);
  let cursor = 0;

  return lists.map((list, index) => {
    const span = totalWeight > 0 ? (weights[index] / totalWeight) * sweepBudget : 0;
    const segment: ReactorSegment = {
      listId: list.id,
      name: list.name,
      color: list.color,
      activeCount: activeByList.get(list.id) ?? 0,
      startAngle: cursor,
      endAngle: cursor + Math.max(span, 2),
    };
    cursor = segment.endAngle + SEGMENT_GAP_DEGREES;
    return segment;
  });
}

function dueLabelFor(task: StickyTask, todayKey: string): string | null {
  if (!task.dueDate) return null;
  const timeSuffix = task.dueTime ? ` · ${task.dueTime}` : "";
  if (task.dueDate === todayKey) return `Today${timeSuffix}`;
  const parsed = new Date(`${task.dueDate}T00:00:00`);
  return `${format(parsed, "EEE MMM d")}${timeSuffix}`;
}

/** Live wall clock for the deck header — hours, minutes, pulsing seconds. */
function DeckClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="deck-clock" aria-hidden="true">
      <span className="deck-clock-time">
        {format(now, "HH")}
        <i className="deck-clock-colon">:</i>
        {format(now, "mm")}
        <i className="deck-clock-colon">:</i>
        {format(now, "ss")}
      </span>
      <span className="deck-clock-date">{format(now, "EEE dd MMM yyyy").toUpperCase()}</span>
    </div>
  );
}

export function StickyOverview({
  lists,
  tasks,
  subtasks,
  recurrenceByTask,
  onClose,
  onOpenTask,
  onSelectList,
  onShowFilter,
  onOpenCalendar,
}: StickyOverviewProps) {
  const reduceMotion = useReducedMotion();
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const [hoveredListId, setHoveredListId] = useState<string | null>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const deck = useMemo(() => {
    const todayKey = format(new Date(), "yyyy-MM-dd");
    const listIds = new Set(lists.map((list) => list.id));
    const listById = new Map(lists.map((list) => [list.id, list]));
    const scopedTasks = tasks.filter((task) => listIds.has(task.listId));
    const activeTasks = scopedTasks.filter((task) => !task.isCompleted);
    const completedCount = scopedTasks.length - activeTasks.length;
    const scopedTaskIds = new Set(scopedTasks.map((task) => task.id));

    const openSubtasksByTask = new Map<string, number>();
    let openSubtasksCount = 0;
    subtasks.forEach((subtask) => {
      if (!scopedTaskIds.has(subtask.taskId) || subtask.isCompleted) return;
      openSubtasksCount += 1;
      openSubtasksByTask.set(subtask.taskId, (openSubtasksByTask.get(subtask.taskId) ?? 0) + 1);
    });

    const activeByList = new Map<string, number>(lists.map((list) => [list.id, 0]));
    activeTasks.forEach((task) => {
      activeByList.set(task.listId, (activeByList.get(task.listId) ?? 0) + 1);
    });

    // Reactor geometry: every list holds an arc; loaded lists sweep wider,
    // idle lists keep a thin standby sliver so the whole fleet stays visible.
    const segments = buildReactorSegments(lists, activeByList);

    const dueTodayCount = activeTasks.filter((task) => task.dueDate === todayKey).length;
    const overdueCount = activeTasks.filter((task) => task.dueDate && task.dueDate < todayKey).length;
    const recurringCount = activeTasks.filter((task) => recurrenceByTask.has(task.id)).length;

    const queue: QueueTask[] = activeTasks
      .slice()
      .sort((a, b) => {
        const aDue = `${a.dueDate ?? "9999-12-31"}T${a.dueTime ?? "23:59"}`;
        const bDue = `${b.dueDate ?? "9999-12-31"}T${b.dueTime ?? "23:59"}`;
        return aDue.localeCompare(bDue) || a.sortOrder - b.sortOrder;
      })
      .slice(0, 6)
      .map((task) => ({
        id: task.id,
        title: task.title,
        listName: listById.get(task.listId)?.name ?? "No list",
        color: task.color,
        dueLabel: dueLabelFor(task, todayKey),
        isOverdue: Boolean(task.dueDate && task.dueDate < todayKey),
        isRecurring: recurrenceByTask.has(task.id),
        openSubtasks: openSubtasksByTask.get(task.id) ?? 0,
      }));

    const startOfToday = new Date();
    const horizon: HorizonDay[] = Array.from({ length: HORIZON_DAYS }, (_, offset) => {
      const day = addDays(startOfToday, offset);
      const key = format(day, "yyyy-MM-dd");
      return {
        key,
        weekday: format(day, "EEEEE"),
        dayOfMonth: format(day, "dd"),
        count: activeTasks.filter((task) => task.dueDate === key).length,
        isToday: offset === 0,
      };
    });
    const horizonPeak = Math.max(...horizon.map((day) => day.count), 1);
    const horizonTotal = horizon.reduce((sum, day) => sum + day.count, 0);

    return {
      todayKey,
      segments,
      activeCount: activeTasks.length,
      completedCount,
      totalCount: scopedTasks.length,
      completionRate: scopedTasks.length
        ? Math.round((completedCount / scopedTasks.length) * 100)
        : 0,
      dueTodayCount,
      overdueCount,
      recurringCount,
      openSubtasksCount,
      queue,
      horizon,
      horizonPeak,
      horizonTotal,
    };
  }, [lists, recurrenceByTask, subtasks, tasks]);

  const hoveredSegment = hoveredListId
    ? deck.segments.find((segment) => segment.listId === hoveredListId) ?? null
    : null;

  const statusTone = deck.overdueCount ? "alert" : deck.dueTodayCount ? "busy" : "calm";
  const statusLabel = deck.overdueCount
    ? `${deck.overdueCount} overdue signal${deck.overdueCount === 1 ? "" : "s"}`
    : deck.dueTodayCount
      ? `${deck.dueTodayCount} due today`
      : "All systems nominal";

  const signals: {
    id: StickyTaskViewFilter;
    label: string;
    value: number;
    icon: React.ReactNode;
    alert?: boolean;
  }[] = [
    { id: "today", label: "Due today", value: deck.dueTodayCount, icon: <Sun size={16} /> },
    {
      id: "overdue",
      label: "Overdue",
      value: deck.overdueCount,
      icon: <TriangleAlert size={16} />,
      alert: deck.overdueCount > 0,
    },
    { id: "recurring", label: "Repeating", value: deck.recurringCount, icon: <Repeat2 size={16} /> },
    { id: "subtasks", label: "Open subtasks", value: deck.openSubtasksCount, icon: <ListChecks size={16} /> },
  ];

  const completionCircumference = 2 * Math.PI * COMPLETION_RADIUS;

  function handleParallax(event: React.PointerEvent<HTMLDivElement>) {
    if (reduceMotion || event.pointerType !== "mouse") return;
    const node = overlayRef.current;
    if (!node) return;
    const bounds = node.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;
    node.style.setProperty("--deck-tilt-x", `${(y * -2.2).toFixed(2)}deg`);
    node.style.setProperty("--deck-tilt-y", `${(x * 2.2).toFixed(2)}deg`);
  }

  const panelEntrance = (order: number) => ({
    initial: { opacity: 0, y: 22, scale: 0.985 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, y: 14, scale: 0.99 },
    transition: { ...springs.drawer, delay: reduceMotion ? 0 : 0.08 + order * 0.07 },
  });

  return (
    <motion.div
      ref={overlayRef}
      className="deck-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Command deck overview"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.18 } }}
      transition={{ duration: 0.24 }}
      onPointerMove={handleParallax}
    >
      <div className="deck-scanline" aria-hidden="true" />

      <motion.header className="deck-topbar" {...panelEntrance(0)}>
        <div className="deck-ident">
          <span className="deck-ident-mark" aria-hidden="true">
            <Radar size={18} />
          </span>
          <div>
            <p className="deck-eyebrow">Sticky // Command deck</p>
            <h2 className="deck-title">Overview</h2>
          </div>
        </div>

        <div className={`deck-status deck-status-${statusTone}`} role="status">
          <i aria-hidden="true" />
          <span>{statusLabel}</span>
        </div>

        <div className="deck-topbar-side">
          <DeckClock />
          <button
            ref={closeButtonRef}
            className="deck-close"
            type="button"
            onClick={onClose}
            aria-label="Close command deck"
          >
            <X size={18} />
            <kbd>ESC</kbd>
          </button>
        </div>
      </motion.header>

      <div className="deck-grid">
        <motion.section className="deck-panel deck-signals" aria-label="Workspace signals" {...panelEntrance(1)}>
          <p className="deck-panel-label">Signals</p>
          {signals.map((signal) => (
            <button
              key={signal.id}
              type="button"
              className={`deck-signal${signal.alert ? " alert" : ""}`}
              onClick={() => onShowFilter(signal.id)}
              aria-label={`${signal.label}: ${signal.value}. Show on board.`}
            >
              <span className="deck-signal-icon">{signal.icon}</span>
              <span className="deck-signal-text">
                <span className="deck-signal-name">{signal.label}</span>
                <span className="deck-signal-meter" aria-hidden="true">
                  <motion.i
                    initial={false}
                    animate={{
                      scaleX: deck.activeCount ? Math.min(signal.value / deck.activeCount, 1) : 0,
                    }}
                    transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 90, damping: 22 }}
                  />
                </span>
              </span>
              <AnimatedNumber value={signal.value} className="deck-signal-value" />
            </button>
          ))}
          <div className="deck-signal-footer">
            <span>
              <AnimatedNumber value={deck.activeCount} /> active
            </span>
            <span>
              <AnimatedNumber value={deck.completedCount} /> done
            </span>
          </div>
        </motion.section>

        <motion.section className="deck-core" aria-label="List reactor" {...panelEntrance(2)}>
          <div className="deck-reactor">
            <div className="deck-sweep" aria-hidden="true" />
            <svg
              viewBox={`0 0 ${REACTOR_SIZE} ${REACTOR_SIZE}`}
              className="deck-reactor-svg"
              aria-hidden="true"
            >
              <g className="deck-rotor deck-rotor-slow">
                <circle
                  className="deck-tick-ring"
                  cx={REACTOR_CENTER}
                  cy={REACTOR_CENTER}
                  r={214}
                  fill="none"
                  strokeWidth={2.5}
                  strokeDasharray="1.5 7"
                />
              </g>
              <g className="deck-rotor deck-rotor-reverse">
                <circle
                  className="deck-tick-ring faint"
                  cx={REACTOR_CENTER}
                  cy={REACTOR_CENTER}
                  r={166}
                  fill="none"
                  strokeWidth={1.5}
                  strokeDasharray="10 6"
                />
              </g>

              {deck.segments.map((segment) => {
                const hovered = segment.listId === hoveredListId;
                const dimmed = hoveredListId !== null && !hovered;
                return (
                  <g key={segment.listId}>
                    <motion.path
                      className={`deck-segment color-${segment.color}${dimmed ? " dimmed" : ""}`}
                      d={arcPath(SEGMENT_RADIUS, segment.startAngle, segment.endAngle)}
                      fill="none"
                      strokeLinecap="round"
                      initial={false}
                      animate={{ strokeWidth: hovered ? 16 : 10 }}
                      transition={reduceMotion ? { duration: 0 } : springs.snappy}
                    />
                    <path
                      className="deck-segment-hit"
                      d={arcPath(SEGMENT_RADIUS, segment.startAngle, segment.endAngle)}
                      fill="none"
                      strokeWidth={34}
                      role="button"
                      tabIndex={0}
                      aria-label={`${segment.name}: ${segment.activeCount} active. Open list.`}
                      onPointerEnter={() => setHoveredListId(segment.listId)}
                      onPointerLeave={() =>
                        setHoveredListId((current) => (current === segment.listId ? null : current))
                      }
                      onFocus={() => setHoveredListId(segment.listId)}
                      onBlur={() =>
                        setHoveredListId((current) => (current === segment.listId ? null : current))
                      }
                      onClick={() => onSelectList(segment.listId)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onSelectList(segment.listId);
                        }
                      }}
                    />
                  </g>
                );
              })}

              <circle
                className="deck-completion-track"
                cx={REACTOR_CENTER}
                cy={REACTOR_CENTER}
                r={COMPLETION_RADIUS}
                fill="none"
                strokeWidth={7}
              />
              <motion.circle
                className="deck-completion-arc"
                cx={REACTOR_CENTER}
                cy={REACTOR_CENTER}
                r={COMPLETION_RADIUS}
                fill="none"
                strokeWidth={7}
                strokeLinecap="round"
                strokeDasharray={completionCircumference}
                transform={`rotate(-90 ${REACTOR_CENTER} ${REACTOR_CENTER})`}
                initial={{ strokeDashoffset: completionCircumference }}
                animate={{
                  strokeDashoffset: completionCircumference * (1 - deck.completionRate / 100),
                }}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 46, damping: 17, delay: 0.35 }
                }
              />
            </svg>

            <div className="deck-reactor-core">
              <AnimatePresence mode="wait" initial={false}>
                {hoveredSegment ? (
                  <motion.div
                    key={hoveredSegment.listId}
                    className={`deck-core-list color-${hoveredSegment.color}`}
                    initial={{ opacity: 0, scale: 0.92 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={reduceMotion ? { duration: 0 } : springs.snappy}
                  >
                    <span className="deck-core-list-name">{hoveredSegment.name}</span>
                    <span className="deck-core-list-count">
                      {hoveredSegment.activeCount} active
                    </span>
                    <span className="deck-core-hint">Click to open</span>
                  </motion.div>
                ) : (
                  <motion.div
                    key="completion"
                    className="deck-core-completion"
                    initial={{ opacity: 0, scale: 0.92 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={reduceMotion ? { duration: 0 } : springs.snappy}
                  >
                    <span className="deck-core-value">
                      <AnimatedNumber value={deck.completionRate} />
                      <i>%</i>
                    </span>
                    <span className="deck-core-caption">
                      {deck.completedCount} of {deck.totalCount} complete
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
          <p className="deck-core-footnote">Each arc is a list — sweep scales with active load</p>
        </motion.section>

        <motion.section className="deck-panel deck-queue" aria-label="Priority queue" {...panelEntrance(3)}>
          <p className="deck-panel-label">Priority queue</p>
          {deck.queue.length ? (
            <ol className="deck-queue-list">
              {deck.queue.map((item, index) => (
                <motion.li
                  key={item.id}
                  initial={{ opacity: 0, x: 18 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{
                    ...springs.paper,
                    delay: reduceMotion ? 0 : 0.32 + index * 0.06,
                  }}
                >
                  <button
                    type="button"
                    className={`deck-queue-task color-${item.color}`}
                    onClick={() => onOpenTask(item.id)}
                  >
                    <span className="deck-queue-index">{String(index + 1).padStart(2, "0")}</span>
                    <span className="deck-queue-body">
                      <span className="deck-queue-title">{item.title}</span>
                      <span className="deck-queue-meta">
                        {item.isOverdue ? <strong>Overdue</strong> : null}
                        {item.dueLabel ? <span>{item.dueLabel}</span> : null}
                        <span>{item.listName}</span>
                        {item.openSubtasks ? <span>{item.openSubtasks} subtasks</span> : null}
                        {item.isRecurring ? <span>Repeats</span> : null}
                      </span>
                    </span>
                  </button>
                </motion.li>
              ))}
            </ol>
          ) : (
            <div className="deck-queue-empty">
              <Radar size={22} />
              <strong>Queue clear</strong>
              <span>Nothing scheduled — capture something on the board.</span>
            </div>
          )}
        </motion.section>
      </div>

      <motion.section className="deck-panel deck-horizon" aria-label="Fourteen day horizon" {...panelEntrance(4)}>
        <div className="deck-horizon-head">
          <p className="deck-panel-label">Horizon · next 14 days</p>
          <button type="button" className="deck-horizon-link" onClick={onOpenCalendar}>
            <CalendarDays size={15} />
            Open calendar
          </button>
        </div>
        <div className="deck-horizon-bars">
          {deck.horizon.map((day, index) => (
            <button
              key={day.key}
              type="button"
              className={`deck-horizon-day${day.isToday ? " today" : ""}${day.count ? "" : " empty"}`}
              onClick={onOpenCalendar}
              aria-label={`${day.count} due on ${day.key}. Open calendar.`}
            >
              <span className="deck-horizon-count">{day.count || ""}</span>
              <span className="deck-horizon-track">
                <motion.i
                  initial={{ scaleY: 0 }}
                  animate={{ scaleY: Math.max(day.count / deck.horizonPeak, day.count ? 0.12 : 0.04) }}
                  transition={{
                    ...springs.paper,
                    delay: reduceMotion ? 0 : 0.4 + index * 0.035,
                  }}
                />
              </span>
              <span className="deck-horizon-label">
                <i>{day.weekday}</i>
                {day.dayOfMonth}
              </span>
            </button>
          ))}
        </div>
        <div className="deck-horizon-footer">
          <span>
            <AnimatedNumber value={deck.horizonTotal} /> scheduled in window
          </span>
          <span>Peak {deck.horizonPeak} / day</span>
        </div>
      </motion.section>
    </motion.div>
  );
}
