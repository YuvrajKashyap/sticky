"use client";

/* eslint-disable react-hooks/refs, react-hooks/set-state-in-effect */

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "framer-motion";
import {
  Archive,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Command as CommandIcon,
  Copy,
  GripVertical,
  Layers3,
  ListChecks,
  LogOut,
  Menu,
  Monitor,
  Rows3,
  Pencil,
  Plus,
  PlugZap,
  Repeat2,
  Search,
  Settings2,
  Sparkles,
  Sun,
  Trash2,
  TriangleAlert,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { createStickyPlatformClient } from "@/lib/sticky/api-client";
import { listToDb, recurrenceToDb, subtaskToDb, taskToDb } from "@/lib/sticky/mappers";
import { mapList, mapSubtask, mapTask } from "@/lib/sticky/mappers";
import type { DbList, DbSubtask, DbTask } from "@/types/sticky";
import { userFacingStickySaveMessage } from "@/lib/sticky/messages";
import {
  nextOccurrenceCount,
  nextRecurrenceDate,
  recurrenceCatchUpTarget,
} from "@/lib/sticky/recurrence";
import { AccentWheel, DEFAULT_ACCENT_HUE, ListColorWheel, applyAccentHue } from "./AccentWheel";
import { CaptureScheduler, type CaptureRepeat } from "./CaptureScheduler";
import { AnimatedNumber, ArcRing, ConfettiBurst, DrawnCheck, springs } from "./motion";
import { StickyCalendar } from "./StickyCalendar";
import { StickyConnections } from "./StickyConnections";
import { StickyOverview } from "./StickyOverview";
import { TaskReminderControl } from "./TaskReminderControl";
import type {
  AppMode,
  RecurrenceFrequency,
  StickyColor,
  StickyList,
  StickyRecurrenceRule,
  StickySubtask,
  StickyLaunchIntent,
  StickyTaskSortMode,
  StickyTaskViewFilter,
  StickyTask,
  StickyWorkspaceData,
} from "@/types/sticky";

type StickyWorkspaceProps = {
  initialData: StickyWorkspaceData;
  mode: AppMode;
  systemMessage?: string;
  initialLaunchIntent?: StickyLaunchIntent;
};

type Toast = {
  id: string;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
};

type ConfirmRequest = {
  title: string;
  body: string;
  actionLabel: string;
  tone?: "danger" | "default";
  onConfirm: () => void;
};

type MaybeError = {
  error: {
    message: string;
  } | null;
};

type SaveState = {
  pending: number;
  lastSavedAt: string | null;
  error: string | null;
};

function mergeById<T extends { id: string }>(items: T[], next: T): T[] {
  const index = items.findIndex((item) => item.id === next.id);
  if (index < 0) return [...items, next];
  const copy = items.slice();
  copy[index] = next;
  return copy;
}

type WorkspacePulseTask = {
  id: string;
  title: string;
  listName: string;
  dueLabel: string | null;
  color: StickyColor;
  openSubtasks: number;
  isRecurring: boolean;
  isOverdue: boolean;
};

type WorkspacePulse = {
  activeCount: number;
  completedCount: number;
  dueTodayCount: number;
  overdueCount: number;
  recurringCount: number;
  openSubtasksCount: number;
  completionRate: number;
  focusTasks: WorkspacePulseTask[];
  busiestListName: string | null;
  busiestListActiveCount: number;
};

type CommandItem = {
  id: string;
  kind: "action" | "list" | "task" | "preference";
  title: string;
  detail: string;
  keywords: string;
  color?: StickyColor;
  run: () => void;
};

type CommandFocusTarget = "capture" | "search";

type BoardColumn = {
  list: StickyList;
  activeTasks: StickyTask[];
  visibleTasks: StickyTask[];
  completedTasks: StickyTask[];
  completedOpen: boolean;
};

type PlateTaskGroup = {
  name: string;
  color: StickyColor;
  tasks: StickyTask[];
};

type QuickCaptureDraft = {
  details: string;
  dueDate: string;
  dueTime: string;
  repeat: CaptureRepeat | null;
};

type QuickCaptureIntent = {
  title: string;
  dueDate: string | null;
  dueTime: string | null;
  dateLabel: string | null;
  timeLabel: string | null;
  listId: string | null;
  listName: string | null;
};

const DEMO_STORAGE_KEY = "sticky.demo.workspace.v2";
const COLORS: StickyColor[] = [
  "coral",
  "ember",
  "sun",
  "lime",
  "mint",
  "teal",
  "sky",
  "azure",
  "violet",
  "magenta",
  "rose",
  "ink",
];
const QUICK_DUE_OPTIONS = [
  { label: "Today", offsetDays: 0 },
  { label: "Tomorrow", offsetDays: 1 },
  { label: "Next week", offsetDays: 7 },
];
const QUICK_TIME_OPTIONS = [
  { label: "Morning", value: "09:00" },
  { label: "Afternoon", value: "14:00" },
  { label: "Evening", value: "17:00" },
];
const TASK_VIEW_LABELS: Record<StickyTaskViewFilter, string> = {
  all: "All",
  today: "Today",
  due: "Scheduled",
  overdue: "Overdue",
  recurring: "Repeating",
  subtasks: "Subtasks",
};
const TASK_VIEW_ORDER: StickyTaskViewFilter[] = ["all", "today", "due", "overdue", "recurring", "subtasks"];
const TASK_SORT_LABELS: Record<StickyTaskSortMode, string> = {
  custom: "Custom",
  due: "Due date",
};

const DEFAULT_PLATE_GROUP_ORDER = ["UTD", "Career", "Skills", "$$$", "OS"];
const PLATE_VISIBLE_LIMITS: Record<string, number> = {
  UTD: 3,
  Career: 3,
  Skills: 4,
  "$$$": 0,
  OS: 3,
};
const TASK_SORT_ACCESSIBLE_LABELS: Record<StickyTaskSortMode, string> = {
  custom: "Custom order",
  due: "Due date",
};

function normalizeWorkspacePreferences(data: StickyWorkspaceData): StickyWorkspaceData {
  return {
    ...data,
    lists: data.lists.map((list) => ({
      ...list,
      isVisibleOnBoard: list.isVisibleOnBoard ?? true,
      archivedAt: list.archivedAt ?? null,
    })),
    preferences: {
      ...data.preferences,
      colorMode: data.preferences.colorMode === "dark" ? "dark" : "light",
      boardStyle: data.preferences.boardStyle ?? "pad",
    },
  };
}
const WEEKDAYS = [
  { label: "S", short: "Sun", name: "Sunday", value: 0 },
  { label: "M", short: "Mon", name: "Monday", value: 1 },
  { label: "T", short: "Tue", name: "Tuesday", value: 2 },
  { label: "W", short: "Wed", name: "Wednesday", value: 3 },
  { label: "T", short: "Thu", name: "Thursday", value: 4 },
  { label: "F", short: "Fri", name: "Friday", value: 5 },
  { label: "S", short: "Sat", name: "Saturday", value: 6 },
];

const FOCUSABLE_DIALOG_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function createId() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

function nextSortOrder(values: Array<{ sortOrder: number }>) {
  return values.length ? Math.max(...values.map((item) => item.sortOrder)) + 1000 : 1000;
}

function nextCompletedSortOrder(values: Array<{ completedSortOrder: number | null }>) {
  const orders = values
    .map((item) => item.completedSortOrder)
    .filter((order): order is number => typeof order === "number");
  return orders.length ? Math.max(...orders) + 1000 : 1000;
}

function bySortOrder<T extends { sortOrder: number; createdAt: string }>(a: T, b: T) {
  return a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt);
}

function trapDialogFocus(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab") {
    return;
  }

  const focusable = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE_DIALOG_SELECTOR),
  ).filter((node) => node.getClientRects().length > 0);

  if (!focusable.length) {
    event.preventDefault();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
    return;
  }

  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function humanDue(task: StickyTask) {
  if (!task.dueDate) {
    return null;
  }

  const date = new Date(`${task.dueDate}T${task.dueTime ?? "00:00"}`);
  return `${format(date, "MMM d")}${task.dueTime ? ` at ${task.dueTime}` : ""}`;
}

function getPlateTaskGroups(tasks: StickyTask[]): PlateTaskGroup[] {
  const groups = new Map<string, PlateTaskGroup>();

  for (const task of tasks) {
    const [rawGroup, ...rawTitleParts] = task.title.split("/");
    const groupName = rawTitleParts.length ? rawGroup.trim() : "Tasks";
    const displayTitle = rawTitleParts.length ? rawTitleParts.join("/").trim() : task.title;
    const normalizedGroup = groupName || "Tasks";
    const taskForDisplay = displayTitle && displayTitle !== task.title ? { ...task, title: displayTitle } : task;
    const existing = groups.get(normalizedGroup);

    if (existing) {
      existing.tasks.push(taskForDisplay);
      continue;
    }

    groups.set(normalizedGroup, {
      name: normalizedGroup,
      color: task.color,
      tasks: [taskForDisplay],
    });
  }

  return Array.from(groups.values()).sort((a, b) => {
    const orderA = DEFAULT_PLATE_GROUP_ORDER.indexOf(a.name);
    const orderB = DEFAULT_PLATE_GROUP_ORDER.indexOf(b.name);

    if (orderA !== -1 || orderB !== -1) {
      return (orderA === -1 ? Number.MAX_SAFE_INTEGER : orderA) - (orderB === -1 ? Number.MAX_SAFE_INTEGER : orderB);
    }

    return a.name.localeCompare(b.name);
  });
}

function humanDate(date: string) {
  return format(new Date(`${date}T00:00:00`), "MMM d, yyyy");
}

function localDateKey(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return format(date, "yyyy-MM-dd");
}

function nextWeekdayKey(day: number) {
  const today = new Date();
  let delta = (day - today.getDay() + 7) % 7;
  if (delta === 0) {
    delta = 7;
  }
  return localDateKey(delta);
}

function cleanQuickCaptureTitle(value: string) {
  return value
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\b(?:at|by|on|for)\s*$/i, "")
    .replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, "")
    .trim();
}

function listSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function countTextMatches(text: string | null | undefined, query: string) {
  if (!text || !query) {
    return 0;
  }

  const normalizedText = text.toLowerCase();
  let count = 0;
  let index = normalizedText.indexOf(query);

  while (index !== -1) {
    count += 1;
    index = normalizedText.indexOf(query, index + query.length);
  }

  return count;
}

function taskFindText(task: StickyTask, subtasks: StickySubtask[], dueLabel: string | null) {
  return [task.title, task.details, dueLabel, ...subtasks.map((subtask) => subtask.title)]
    .filter(Boolean)
    .join(" ");
}

function isPanBlockedTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        "button, input, textarea, select, a, [contenteditable='true'], .task-card, .subtask-row, .quick-schedule-preview, .column-header",
      ),
    )
  );
}

/**
 * Grab-and-drag panning for the board: press on any empty patch of desk or
 * column paper and drag sideways to scroll. Mouse only — touch devices
 * already pan natively — and real drags swallow the trailing click so the
 * background-deselect behavior stays intact.
 */
function useBoardPan() {
  const panRef = useRef({
    panning: false,
    pointerId: -1,
    startX: 0,
    startScrollLeft: 0,
    moved: false,
  });

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "mouse" || event.button !== 0 || isPanBlockedTarget(event.target)) {
      return;
    }

    const pan = panRef.current;
    pan.panning = true;
    pan.pointerId = event.pointerId;
    pan.startX = event.clientX;
    pan.startScrollLeft = event.currentTarget.scrollLeft;
    pan.moved = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const pan = panRef.current;
    if (!pan.panning || event.pointerId !== pan.pointerId) {
      return;
    }

    const delta = event.clientX - pan.startX;
    if (Math.abs(delta) > 4) {
      pan.moved = true;
      event.currentTarget.classList.add("panning");
    }
    event.currentTarget.scrollLeft = pan.startScrollLeft - delta;
  }, []);

  const endPan = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const pan = panRef.current;
    if (!pan.panning || event.pointerId !== pan.pointerId) {
      return;
    }

    pan.panning = false;
    event.currentTarget.classList.remove("panning");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const onClickCapture = useCallback((event: React.MouseEvent<HTMLElement>) => {
    const pan = panRef.current;
    if (pan.moved) {
      pan.moved = false;
      event.preventDefault();
      event.stopPropagation();
    }
  }, []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: endPan,
    onPointerCancel: endPan,
    onClickCapture,
  };
}

function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query) {
    return <>{text}</>;
  }

  const normalizedText = text.toLowerCase();
  const segments: Array<{ text: string; highlighted: boolean }> = [];
  let cursor = 0;
  let matchIndex = normalizedText.indexOf(query);

  while (matchIndex !== -1) {
    if (matchIndex > cursor) {
      segments.push({ text: text.slice(cursor, matchIndex), highlighted: false });
    }

    segments.push({
      text: text.slice(matchIndex, matchIndex + query.length),
      highlighted: true,
    });
    cursor = matchIndex + query.length;
    matchIndex = normalizedText.indexOf(query, cursor);
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), highlighted: false });
  }

  return (
    <>
      {segments.map((segment, index) =>
        segment.highlighted ? (
          <mark className="find-highlight" key={`${segment.text}-${index}`}>
            {segment.text}
          </mark>
        ) : (
          <span key={`${segment.text}-${index}`}>{segment.text}</span>
        ),
      )}
    </>
  );
}

function visualVariant(value: string, count: number) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }

  return (Math.abs(hash) % count) + 1;
}

function compactListSlug(value: string) {
  return listSlug(value).replace(/-/g, "");
}

function extractCaptureListToken(
  value: string,
  lists: Array<Pick<StickyList, "id" | "name">>,
) {
  const matches = Array.from(value.matchAll(/(^|\s)#([a-z0-9][a-z0-9_-]*)/gi));

  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index];
    const token = match[2].toLowerCase();
    const compactToken = token.replace(/[-_]/g, "");
    const list = lists.find(
      (item) => listSlug(item.name) === token || compactListSlug(item.name) === compactToken,
    );

    if (!list) {
      continue;
    }

    const matchStart = (match.index ?? 0) + match[1].length;
    const matchEnd = matchStart + match[0].length - match[1].length;

    return {
      title: cleanQuickCaptureTitle(`${value.slice(0, matchStart)} ${value.slice(matchEnd)}`),
      list,
    };
  }

  return { title: value, list: null };
}

function formatQuickTimeLabel(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return format(date, "h:mm a");
}

function parseClockTime(hoursValue: string, minutesValue: string | undefined, meridiem?: string) {
  let hours = Number(hoursValue);
  const minutes = Number(minutesValue ?? "0");

  if (meridiem) {
    const normalized = meridiem.toLowerCase();
    if (normalized === "pm" && hours < 12) {
      hours += 12;
    }
    if (normalized === "am" && hours === 12) {
      hours = 0;
    }
  }

  if (hours > 23 || minutes > 59) {
    return null;
  }

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function parseQuickCaptureIntent(
  value: string,
  lists: Array<Pick<StickyList, "id" | "name">> = [],
): QuickCaptureIntent {
  const listIntent = extractCaptureListToken(value, lists);
  const originalTitle = listIntent.title.trim();
  let workingTitle = ` ${originalTitle} `;
  let dueDate: string | null = null;
  let dueTime: string | null = null;
  let dateLabel: string | null = null;
  let timeLabel: string | null = null;

  function remove(pattern: RegExp) {
    workingTitle = workingTitle.replace(pattern, " ");
  }

  const datePatterns: Array<{ pattern: RegExp; dueDate: () => string; label: string }> = [
    { pattern: /\bnext\s+week\b/i, dueDate: () => localDateKey(7), label: "Next week" },
    { pattern: /\btomorrow\b/i, dueDate: () => localDateKey(1), label: "Tomorrow" },
    { pattern: /\btoday\b/i, dueDate: () => localDateKey(), label: "Today" },
  ];

  for (const option of datePatterns) {
    if (!dueDate && option.pattern.test(workingTitle)) {
      dueDate = option.dueDate();
      dateLabel = option.label;
      remove(option.pattern);
    }
  }

  if (!dueDate) {
    const weekdayPattern =
      /\b(?:next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i;
    const weekdayMatch = workingTitle.match(weekdayPattern);

    if (weekdayMatch) {
      const dayIndex = WEEKDAYS.findIndex(
        (day) => day.name.toLowerCase() === weekdayMatch[1].toLowerCase(),
      );
      if (dayIndex >= 0) {
        dueDate = nextWeekdayKey(dayIndex);
        dateLabel = WEEKDAYS[dayIndex].name;
        remove(weekdayPattern);
      }
    }
  }

  const wordTimePattern = /\b(?:in\s+the\s+)?(morning|afternoon|evening|tonight|noon)\b/i;
  const wordTimeMatch = workingTitle.match(wordTimePattern);
  if (wordTimeMatch) {
    const normalized = wordTimeMatch[1].toLowerCase();
    const quickTimes: Record<string, string> = {
      morning: "09:00",
      afternoon: "14:00",
      evening: "17:00",
      tonight: "18:00",
      noon: "12:00",
    };
    dueTime = quickTimes[normalized];
    timeLabel = normalized === "tonight" ? "Tonight" : formatQuickTimeLabel(dueTime);

    if (normalized === "tonight" && !dueDate) {
      dueDate = localDateKey();
      dateLabel = "Today";
    }

    remove(wordTimePattern);
  }

  const explicitTimePattern = /\b(?:at|by)?\s*([01]?\d|2[0-3])(?::([0-5]\d))?\s*(am|pm)?\b/i;
  const explicitTimeMatch = workingTitle.match(explicitTimePattern);
  if (!dueTime && explicitTimeMatch && (explicitTimeMatch[2] || explicitTimeMatch[3])) {
    const parsedTime = parseClockTime(
      explicitTimeMatch[1],
      explicitTimeMatch[2],
      explicitTimeMatch[3],
    );

    if (parsedTime) {
      dueTime = parsedTime;
      timeLabel = formatQuickTimeLabel(parsedTime);
      remove(explicitTimePattern);
    }
  }

  if (dueTime && !dueDate) {
    dueDate = localDateKey();
    dateLabel = "Today";
  }

  const title = cleanQuickCaptureTitle(workingTitle) || originalTitle;

  return {
    title,
    dueDate,
    dueTime,
    dateLabel,
    timeLabel,
    listId: listIntent.list?.id ?? null,
    listName: listIntent.list?.name ?? null,
  };
}

function plural(value: number, singular: string, pluralForm = `${singular}s`) {
  return value === 1 ? singular : pluralForm;
}

function taskViewButtonLabel(label: string, count: number, active: boolean) {
  return `${active ? "Current" : "Show"} task view: ${label}, ${count} ${plural(count, "task")}`;
}

function taskSortButtonLabel(sortMode: StickyTaskSortMode, active: boolean) {
  const label = TASK_SORT_ACCESSIBLE_LABELS[sortMode];

  return active ? `Current task sort: ${label}` : `Sort tasks by ${label.toLowerCase()}`;
}

function recurrenceCadence(rule: StickyRecurrenceRule) {
  const interval = Math.max(1, rule.intervalCount);
  const every = interval === 1 ? "Every" : `Every ${interval}`;

  if (rule.frequency === "daily") {
    return `${every} ${plural(interval, "day")}`;
  }

  if (rule.frequency === "weekly") {
    const days = rule.daysOfWeek
      .map((day) => WEEKDAYS.find((item) => item.value === day)?.short)
      .filter(Boolean)
      .join(", ");
    return days
      ? `${every} ${plural(interval, "week")} on ${days}`
      : `${every} ${plural(interval, "week")}`;
  }

  if (rule.frequency === "monthly") {
    return `${every} ${plural(interval, "month")} on day ${
      rule.monthDay ?? startMonthDay(rule.startsOn)
    }`;
  }

  if (rule.frequency === "yearly") {
    const start = new Date(`${rule.startsOn}T00:00:00`);
    const monthLabel = format(start, "MMM");
    return `${every} ${plural(interval, "year")} on ${monthLabel} ${
      rule.monthDay ?? startMonthDay(rule.startsOn)
    }`;
  }

  const weeklyDays = rule.daysOfWeek
    .map((day) => WEEKDAYS.find((item) => item.value === day)?.short)
    .filter(Boolean)
    .join(", ");
  const monthDay = rule.monthDay ? `day ${rule.monthDay}` : null;
  const pieces = [weeklyDays ? `on ${weeklyDays}` : null, monthDay].filter(Boolean);

  return pieces.length
    ? `${every} custom cycle ${pieces.join(" and ")}`
    : `${every} custom cycle`;
}

function recurrenceBoundary(rule: StickyRecurrenceRule) {
  const start = `Starts ${humanDate(rule.startsOn)}`;

  if (rule.endType === "on_date") {
    return `${start} - Ends ${humanDate(rule.endDate ?? rule.startsOn)}`;
  }

  if (rule.endType === "after_count") {
    const count = rule.occurrenceCount ?? 1;
    return `${start} - Ends after ${count} ${plural(count, "time")}`;
  }

  return `${start} - No end date`;
}

function commandMatches(item: CommandItem, query: string) {
  if (!query) {
    return true;
  }

  return `${item.title} ${item.detail} ${item.keywords}`.toLowerCase().includes(query);
}

function hasResultError(value: unknown): value is MaybeError {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    (value as MaybeError).error !== null
  );
}

function listInsertPayload(list: StickyList) {
  return {
    id: list.id,
    user_id: list.userId,
    ...listToDb(list),
  };
}

function taskInsertPayload(task: StickyTask) {
  return {
    id: task.id,
    user_id: task.userId,
    ...taskToDb(task),
  };
}

function subtaskInsertPayload(subtask: StickySubtask) {
  return {
    id: subtask.id,
    user_id: subtask.userId,
    ...subtaskToDb(subtask),
  };
}

function recurrenceInsertPayload(rule: StickyRecurrenceRule) {
  return {
    id: rule.id,
    user_id: rule.userId,
    ...recurrenceToDb(rule),
  };
}

function errorMessageFromUnknown(error: unknown) {
  return error instanceof Error ? error.message : "The save request did not complete.";
}

function colorLabel(color: StickyColor) {
  const labels: Record<StickyColor, string> = {
    sun: "Sun",
    coral: "Coral",
    mint: "Mint",
    sky: "Sky",
    violet: "Violet",
    ink: "Ink",
    ember: "Ember",
    rose: "Rose",
    lime: "Lime",
    teal: "Teal",
    azure: "Azure",
    magenta: "Magenta",
  };
  return labels[color];
}

function startDayOfWeek(date: string) {
  return new Date(`${date}T00:00:00`).getDay();
}

function startMonthDay(date: string) {
  return Number(date.slice(8, 10)) || 1;
}

function clampMonthDay(value: number) {
  return Math.min(31, Math.max(1, value || 1));
}

function recurrenceUsesDays(frequency: RecurrenceFrequency) {
  return frequency === "weekly" || frequency === "custom";
}

function recurrenceUsesMonthDay(frequency: RecurrenceFrequency) {
  return frequency === "monthly" || frequency === "yearly" || frequency === "custom";
}

function createNextRecurringOccurrence(
  workspace: StickyWorkspaceData,
  task: StickyTask,
  rule: StickyRecurrenceRule,
) {
  const dueDate = nextRecurrenceDate(rule, task);

  if (!dueDate) {
    return null;
  }

  const timestamp = nowIso();
  const activeInList = workspace.tasks.filter(
    (item) => item.listId === task.listId && !item.isCompleted && item.id !== task.id,
  );
  const nextTask: StickyTask = {
    ...task,
    id: createId(),
    dueDate,
    dueTime: task.dueTime,
    isCompleted: false,
    completedAt: null,
    completedSortOrder: null,
    sortOrder: nextSortOrder(activeInList),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const nextRule: StickyRecurrenceRule = {
    ...rule,
    taskId: nextTask.id,
    occurrenceCount: nextOccurrenceCount(rule),
    updatedAt: timestamp,
  };

  return { task: nextTask, rule: nextRule };
}

function saveStatus(saveState: SaveState, mode: AppMode, demoReady: boolean) {
  if (mode === "demo") {
    return {
      tone: demoReady ? "clean" : "saving",
      label: demoReady ? "Local demo saved" : "Opening local demo",
      shortLabel: demoReady ? "Saved" : "Opening",
    };
  }

  if (saveState.pending > 0) {
    return { tone: "saving", label: "Saving changes", shortLabel: "Saving" };
  }

  if (saveState.error) {
    return { tone: "error", label: "Save needs attention", shortLabel: "Check" };
  }

  if (saveState.lastSavedAt) {
    return {
      tone: "clean",
      label: `Saved ${format(new Date(saveState.lastSavedAt), "h:mm a")}`,
      shortLabel: "Saved",
    };
  }

  return { tone: "clean", label: "Connected", shortLabel: "Live" };
}

export function StickyWorkspace({ initialData, mode, systemMessage, initialLaunchIntent }: StickyWorkspaceProps) {
  const [workspace, setWorkspace] = useState(initialData);
  const [demoReady, setDemoReady] = useState(mode !== "demo");
  const [quickTitle, setQuickTitle] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskViewFilter, setTaskViewFilterState] = useState<StickyTaskViewFilter>(
    initialData.preferences.taskViewFilter,
  );
  const [taskSortMode, setTaskSortModeState] = useState<StickyTaskSortMode>(
    initialData.preferences.taskSortMode,
  );
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [commandIndex, setCommandIndex] = useState(0);
  const [searchFocused, setSearchFocused] = useState(false);
  const [viewMode, setViewMode] = useState<"board" | "calendar">("board");
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [pulseOpen, setPulseOpen] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [accentHue, setAccentHue] = useState(DEFAULT_ACCENT_HUE);
  const [captureExpanded, setCaptureExpanded] = useState(false);
  const [captureDraft, setCaptureDraft] = useState<QuickCaptureDraft>({
    details: "",
    dueDate: "",
    dueTime: "",
    repeat: null,
  });
  const boardPan = useBoardPan();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const [listEditor, setListEditor] = useState<StickyList | "new" | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({
    pending: 0,
    lastSavedAt: mode === "demo" ? nowIso() : null,
    error: null,
  });
  const workspaceRef = useRef(workspace);
  const latestSaveAttemptRef = useRef(0);
  const launchIntentAppliedRef = useRef(false);
  const dialogReturnFocusRef = useRef<HTMLElement | null>(null);
  const commandFocusTargetRef = useRef<CommandFocusTarget | null>(null);
  const quickInputRef = useRef<HTMLInputElement>(null);
  const quickCaptureClosedDetailsRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const commandInputRef = useRef<HTMLInputElement>(null);
  const commandTriggerRef = useRef<HTMLButtonElement>(null);
  const googleActivationSyncAtRef = useRef(0);
  const supabase = useMemo(
    () => (mode === "supabase" ? createStickyPlatformClient() : null),
    [mode],
  );

  useEffect(() => {
    if (mode !== "supabase" || !supabase) return;

    const syncConnectedGoogle = async () => {
      if (document.visibilityState !== "visible" || Date.now() - googleActivationSyncAtRef.current < 15 * 60_000) return;
      googleActivationSyncAtRef.current = Date.now();
      try {
        const { integrations } = await supabase.request<{
          integrations: Array<{ provider: string; status: string }>;
        }>("/api/v1/integrations");
        if (integrations.some((item) => item.provider === "google_tasks" && item.status === "healthy")) {
          await supabase.request("/api/v1/integrations/google/sync", { method: "POST", body: "{}" });
        }
      } catch {
        // Connection health is shown in Settings; workspace activation stays quiet.
      }
    };

    void syncConnectedGoogle();
    const onVisibilityChange = () => void syncConnectedGoogle();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [mode, supabase]);

  useEffect(() => {
    if (mode !== "supabase" || !supabase) return;
    const channel = supabase.realtime
      .channel(`sticky:${initialData.user.id}`, { config: { private: true } })
      .on("broadcast", { event: "*" }, ({ payload }) => {
        const change = payload as { operation?: string; table?: string; record?: unknown; old_record?: { id?: string } };
        const operation = change.operation?.toUpperCase();
        const recordId = (change.record as { id?: string } | undefined)?.id ?? change.old_record?.id;
        if (!recordId || !change.table) return;
        setWorkspace((current) => {
          if (change.table === "lists") {
            const lists = operation === "DELETE"
              ? current.lists.filter((item) => item.id !== recordId)
              : mergeById(current.lists, mapList(change.record as DbList));
            return { ...current, lists };
          }
          if (change.table === "tasks") {
            const tasks = operation === "DELETE"
              ? current.tasks.filter((item) => item.id !== recordId)
              : mergeById(current.tasks, mapTask(change.record as DbTask));
            return { ...current, tasks };
          }
          if (change.table === "subtasks") {
            const subtasks = operation === "DELETE"
              ? current.subtasks.filter((item) => item.id !== recordId)
              : mergeById(current.subtasks, mapSubtask(change.record as DbSubtask));
            return { ...current, subtasks };
          }
          return current;
        });
      })
      .subscribe();
    return () => { void supabase.realtime.removeChannel(channel); };
  }, [initialData.user.id, mode, supabase]);

  useEffect(() => {
    if (!searchFocused) {
      return;
    }

    const focusTimer = window.setTimeout(() => searchInputRef.current?.focus({ preventScroll: true }), 0);
    return () => window.clearTimeout(focusTimer);
  }, [searchFocused]);

  const closeCommandCenter = useCallback((restoreFocus = false) => {
    setCommandOpen(false);
    setCommandQuery("");
    setCommandIndex(0);

    if (restoreFocus) {
      window.setTimeout(() => commandTriggerRef.current?.focus(), 0);
    }
  }, []);

  const rememberDialogReturnFocus = useCallback(() => {
    const activeElement = document.activeElement;

    if (!(activeElement instanceof HTMLElement) || activeElement === document.body) {
      dialogReturnFocusRef.current = null;
      return;
    }

    dialogReturnFocusRef.current = activeElement.closest("#sticky-command-dialog")
      ? commandTriggerRef.current
      : activeElement;
  }, []);

  const restoreDialogReturnFocus = useCallback(() => {
    const target = dialogReturnFocusRef.current;
    dialogReturnFocusRef.current = null;

    if (target && document.contains(target)) {
      window.setTimeout(() => target.focus(), 0);
    }
  }, []);

  const openListEditor = useCallback(
    (nextListEditor: StickyList | "new") => {
      rememberDialogReturnFocus();
      setListEditor(nextListEditor);
    },
    [rememberDialogReturnFocus],
  );

  const closeListEditor = useCallback(() => {
    setListEditor(null);
    restoreDialogReturnFocus();
  }, [restoreDialogReturnFocus]);

  const openConfirmDialog = useCallback(
    (request: ConfirmRequest) => {
      rememberDialogReturnFocus();
      setConfirmRequest(request);
    },
    [rememberDialogReturnFocus],
  );

  const cancelConfirmDialog = useCallback(() => {
    setConfirmRequest(null);
    restoreDialogReturnFocus();
  }, [restoreDialogReturnFocus]);

  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

  useEffect(() => {
    if (window.localStorage.getItem("sticky.rail.collapsed") === "true") {
      setRailCollapsed(true);
    }
    const storedHueRaw = window.localStorage.getItem("sticky.accent.hue");
    if (storedHueRaw !== null) {
      const storedHue = Number(storedHueRaw);
      if (Number.isFinite(storedHue) && storedHue >= 0 && storedHue < 360) {
        setAccentHue(storedHue);
      }
    }
  }, []);

  useEffect(() => {
    applyAccentHue(accentHue);
    window.localStorage.setItem("sticky.accent.hue", String(Math.round(accentHue)));
  }, [accentHue]);

  useEffect(() => {
    window.localStorage.setItem("sticky.rail.collapsed", String(railCollapsed));
  }, [railCollapsed]);

  // Cursor spotlight: the stage carries a soft lamp that follows the pointer.
  useEffect(() => {
    const root = document.documentElement;
    let frame = 0;
    let x = 0;
    let y = 0;

    const onMove = (event: PointerEvent) => {
      x = event.clientX;
      y = event.clientY;
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        root.style.setProperty("--spot-x", `${x}px`);
        root.style.setProperty("--spot-y", `${y}px`);
      });
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (mode !== "demo") {
      return;
    }

    const stored = window.localStorage.getItem(DEMO_STORAGE_KEY);
    if (stored) {
      try {
        setWorkspace(normalizeWorkspacePreferences(JSON.parse(stored) as StickyWorkspaceData));
      } catch {
        window.localStorage.removeItem(DEMO_STORAGE_KEY);
      }
    }
    setDemoReady(true);
  }, [mode]);

  useEffect(() => {
    if (mode === "demo" && demoReady) {
      window.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(workspace));
      setSaveState((current) => ({
        ...current,
        lastSavedAt: nowIso(),
        error: null,
      }));
    }
  }, [demoReady, mode, workspace]);

  useEffect(() => {
    setTaskViewFilterState(workspace.preferences.taskViewFilter);
    setTaskSortModeState(workspace.preferences.taskSortMode);
  }, [workspace.preferences.taskSortMode, workspace.preferences.taskViewFilter]);

  useEffect(() => {
    if (!commandOpen) {
      return;
    }

    window.setTimeout(() => commandInputRef.current?.focus(), 0);
  }, [commandOpen]);

  useEffect(() => {
    if (commandOpen || !commandFocusTargetRef.current) {
      return;
    }

    const targetIntent = commandFocusTargetRef.current;
    commandFocusTargetRef.current = null;
    const target =
      targetIntent === "capture" ? quickInputRef.current : searchInputRef.current;

    if (!target) {
      return;
    }

    const focusTarget = () => {
      target.scrollIntoView({ block: "center", inline: "nearest" });
      target.focus({ preventScroll: true });
    };

    window.setTimeout(focusTarget, 0);
    window.setTimeout(focusTarget, 80);
  }, [commandOpen]);

  function focusCommandTarget(targetIntent: CommandFocusTarget) {
    commandFocusTargetRef.current = targetIntent;
    const target =
      targetIntent === "capture" ? quickInputRef.current : searchInputRef.current;

    if (!target) {
      return;
    }

    const focusTarget = () => {
      target.scrollIntoView({ block: "center", inline: "nearest" });
      target.focus({ preventScroll: true });
    };

    focusTarget();
    window.setTimeout(focusTarget, 0);
    window.setTimeout(focusTarget, 80);
  }

  useEffect(() => {
    setCommandIndex(0);
  }, [commandQuery, commandOpen]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
        return;
      }

      if (event.key === "Escape") {
        if (overviewOpen) {
          setOverviewOpen(false);
          return;
        }
        if (commandOpen) {
          closeCommandCenter(true);
          return;
        }
        if (confirmRequest) {
          cancelConfirmDialog();
          return;
        }
        if (listEditor) {
          closeListEditor();
          return;
        }
        if (captureExpanded) {
          setCaptureExpanded(false);
          return;
        }
        if (selectedTaskId || pulseOpen) {
          setSelectedTaskId(null);
          setPulseOpen(false);
        }
        return;
      }

      if (!isTyping && (event.key.toLowerCase() === "n" || event.code === "KeyN")) {
        event.preventDefault();
        quickInputRef.current?.focus();
        return;
      }

      if (!isTyping && (event.key.toLowerCase() === "o" || event.code === "KeyO")) {
        event.preventDefault();
        setOverviewOpen(true);
      }
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [
    cancelConfirmDialog,
    closeCommandCenter,
    closeListEditor,
    commandOpen,
    confirmRequest,
    captureExpanded,
    listEditor,
    overviewOpen,
    pulseOpen,
    selectedTaskId,
  ]);

  useEffect(() => {
    if (!initialLaunchIntent || launchIntentAppliedRef.current) {
      return;
    }

    if (mode === "demo" && !demoReady) {
      return;
    }

    launchIntentAppliedRef.current = true;

    if (initialLaunchIntent === "capture") {
      window.setTimeout(() => quickInputRef.current?.focus(), 0);
      return;
    }

    if (initialLaunchIntent === "search") {
      window.setTimeout(() => searchInputRef.current?.focus(), 0);
      return;
    }

    setTaskViewFilterState(initialLaunchIntent === "today" ? "today" : "due");
  }, [demoReady, initialLaunchIntent, mode]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 120, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const sortedLists = useMemo(() => workspace.lists.slice().sort(bySortOrder), [workspace.lists]);
  const unarchivedLists = useMemo(
    () => sortedLists.filter((list) => !list.archivedAt),
    [sortedLists],
  );
  const archivedLists = useMemo(
    () =>
      sortedLists
        .filter((list) => Boolean(list.archivedAt))
        .sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? "") || bySortOrder(a, b)),
    [sortedLists],
  );
  const visibleBoardLists = useMemo(
    () => unarchivedLists.filter((list) => list.isVisibleOnBoard),
    [unarchivedLists],
  );
  const visibleBoardListIds = useMemo(
    () => new Set(visibleBoardLists.map((list) => list.id)),
    [visibleBoardLists],
  );
  const unarchivedListIds = useMemo(
    () => new Set(unarchivedLists.map((list) => list.id)),
    [unarchivedLists],
  );
  const activeListId = useMemo(() => {
    const selected = workspace.userState.selectedListId;
    if (selected === null) {
      return null;
    }
    if (selected && unarchivedLists.some((list) => list.id === selected)) {
      return selected;
    }
    return visibleBoardLists[0]?.id ?? unarchivedLists[0]?.id ?? null;
  }, [unarchivedLists, visibleBoardLists, workspace.userState.selectedListId]);

  const listById = useMemo(() => new Map(workspace.lists.map((list) => [list.id, list])), [workspace.lists]);
  const activeList = unarchivedLists.find((list) => list.id === activeListId) ?? null;
  const searchQuery = workspace.userState.searchQuery.trim().toLowerCase();
  const searchExpanded = searchFocused || Boolean(searchQuery);

  const subtasksByTask = useMemo(() => {
    const map = new Map<string, StickySubtask[]>();
    workspace.subtasks.forEach((subtask) => {
      const list = map.get(subtask.taskId) ?? [];
      list.push(subtask);
      map.set(subtask.taskId, list);
    });
    map.forEach((items) => items.sort(bySortOrder));
    return map;
  }, [workspace.subtasks]);

  const recurrenceByTask = useMemo(() => {
    return new Map(workspace.recurrenceRules.map((rule) => [rule.taskId, rule]));
  }, [workspace.recurrenceRules]);

  const listStats = useMemo(() => {
    const stats = new Map<string, { active: number; completed: number }>();
    workspace.lists.forEach((list) => stats.set(list.id, { active: 0, completed: 0 }));
    workspace.tasks.forEach((task) => {
      const item = stats.get(task.listId);
      if (!item) {
        return;
      }
      if (task.isCompleted) {
        item.completed += 1;
      } else {
        item.active += 1;
      }
    });
    return stats;
  }, [workspace.lists, workspace.tasks]);
  const totalActiveTasks = useMemo(
    () =>
      workspace.tasks.filter((task) => unarchivedListIds.has(task.listId) && !task.isCompleted)
        .length,
    [unarchivedListIds, workspace.tasks],
  );
  const totalCompletedTasks = useMemo(
    () =>
      workspace.tasks.filter((task) => unarchivedListIds.has(task.listId) && task.isCompleted)
        .length,
    [unarchivedListIds, workspace.tasks],
  );
  const unarchivedTaskIds = useMemo(
    () =>
      new Set(
        workspace.tasks
          .filter((task) => unarchivedListIds.has(task.listId))
          .map((task) => task.id),
      ),
    [unarchivedListIds, workspace.tasks],
  );
  const totalOpenSubtasks = useMemo(
    () =>
      workspace.subtasks.filter(
        (subtask) => unarchivedTaskIds.has(subtask.taskId) && !subtask.isCompleted,
      ).length,
    [unarchivedTaskIds, workspace.subtasks],
  );

  const activeListTasks = useMemo(() => {
    return workspace.tasks
      .filter((task) => task.listId === activeListId && !task.isCompleted)
      .sort(bySortOrder);
  }, [activeListId, workspace.tasks]);

  const taskFilterCounts = useMemo(() => {
    const todayKey = localDateKey();

    return {
      all: activeListTasks.length,
      today: activeListTasks.filter((task) => task.dueDate === todayKey).length,
      due: activeListTasks.filter((task) => Boolean(task.dueDate)).length,
      overdue: activeListTasks.filter((task) => task.dueDate && task.dueDate < todayKey).length,
      recurring: activeListTasks.filter((task) => recurrenceByTask.has(task.id)).length,
      subtasks: activeListTasks.filter((task) =>
        (subtasksByTask.get(task.id) ?? []).some((subtask) => !subtask.isCompleted),
      ).length,
    };
  }, [activeListTasks, recurrenceByTask, subtasksByTask]);

  const activeTasks = useMemo(() => {
    const todayKey = localDateKey();

    const filteredTasks = activeListTasks.filter((task) => {
      if (taskViewFilter === "due") {
        return Boolean(task.dueDate);
      }

      if (taskViewFilter === "today") {
        return task.dueDate === todayKey;
      }

      if (taskViewFilter === "overdue") {
        return Boolean(task.dueDate && task.dueDate < todayKey);
      }

      if (taskViewFilter === "recurring") {
        return recurrenceByTask.has(task.id);
      }

      if (taskViewFilter === "subtasks") {
        return (subtasksByTask.get(task.id) ?? []).some((subtask) => !subtask.isCompleted);
      }

      return true;
    });

    if (taskSortMode === "due") {
      return filteredTasks.slice().sort((a, b) => {
        const aDue = `${a.dueDate ?? "9999-12-31"}T${a.dueTime ?? "23:59"}`;
        const bDue = `${b.dueDate ?? "9999-12-31"}T${b.dueTime ?? "23:59"}`;
        return aDue.localeCompare(bDue) || bySortOrder(a, b);
      });
    }

    return filteredTasks;
  }, [activeListTasks, recurrenceByTask, subtasksByTask, taskSortMode, taskViewFilter]);

  const calendarTasks = useMemo(
    () =>
      workspace.tasks
        .filter((task) => unarchivedListIds.has(task.listId) && Boolean(task.dueDate))
        .sort((a, b) => {
          const aSchedule = `${a.dueDate ?? "9999-12-31"}T${a.dueTime ?? "23:59"}`;
          const bSchedule = `${b.dueDate ?? "9999-12-31"}T${b.dueTime ?? "23:59"}`;
          return aSchedule.localeCompare(bSchedule) || bySortOrder(a, b);
        }),
    [unarchivedListIds, workspace.tasks],
  );

  const searchMatchCount = useMemo(() => {
    if (!searchQuery) {
      return 0;
    }

    let count = 0;

    for (const list of sortedLists) {
      count += countTextMatches(list.name, searchQuery);
    }

    for (const task of workspace.tasks) {
      if (!visibleBoardListIds.has(task.listId)) {
        continue;
      }

      const subtasks = subtasksByTask.get(task.id) ?? [];
      const dueLabel = humanDue(task);

      count += countTextMatches(task.title, searchQuery);
      count += countTextMatches(task.details, searchQuery);
      count += countTextMatches(dueLabel, searchQuery);

      for (const subtask of subtasks) {
        count += countTextMatches(subtask.title, searchQuery);
      }
    }

    return count;
  }, [searchQuery, sortedLists, subtasksByTask, visibleBoardListIds, workspace.tasks]);
  const searchSummary = searchQuery
    ? searchMatchCount
      ? `${searchMatchCount} ${plural(searchMatchCount, "match", "matches")}`
      : "No matches"
    : "Find";

  const boardColumns = useMemo<BoardColumn[]>(() => {
    const todayKey = localDateKey();

    function visibleTasksForList(tasks: StickyTask[]) {
      const filteredTasks = tasks.filter((task) => {
        if (taskViewFilter === "due") {
          return Boolean(task.dueDate);
        }

        if (taskViewFilter === "today") {
          return task.dueDate === todayKey;
        }

        if (taskViewFilter === "overdue") {
          return Boolean(task.dueDate && task.dueDate < todayKey);
        }

        if (taskViewFilter === "recurring") {
          return recurrenceByTask.has(task.id);
        }

        if (taskViewFilter === "subtasks") {
          return (subtasksByTask.get(task.id) ?? []).some((subtask) => !subtask.isCompleted);
        }

        return true;
      });

      if (taskSortMode === "due") {
        return filteredTasks.slice().sort((a, b) => {
          const aDue = `${a.dueDate ?? "9999-12-31"}T${a.dueTime ?? "23:59"}`;
          const bDue = `${b.dueDate ?? "9999-12-31"}T${b.dueTime ?? "23:59"}`;
          return aDue.localeCompare(bDue) || bySortOrder(a, b);
        });
      }

      return filteredTasks;
    }

    const matchingLists = searchQuery
      ? visibleBoardLists.filter((list) => {
          const listTasks = workspace.tasks.filter((task) => task.listId === list.id);

          return (
            countTextMatches(list.name, searchQuery) > 0 ||
            listTasks.some((task) =>
              taskFindText(task, subtasksByTask.get(task.id) ?? [], humanDue(task))
                .toLowerCase()
                .includes(searchQuery),
            )
          );
        })
      : [];
    const searchHasMatches = Boolean(searchQuery && matchingLists.length);
    const boardLists = searchHasMatches ? matchingLists : visibleBoardLists;

    return boardLists.map((list) => {
      const listActiveTasks = workspace.tasks
        .filter((task) => task.listId === list.id && !task.isCompleted)
        .sort(bySortOrder);
      const listCompletedTasks = workspace.tasks
        .filter((task) => task.listId === list.id && task.isCompleted)
        .sort((a, b) => {
          const aOrder = a.completedSortOrder ?? 0;
          const bOrder = b.completedSortOrder ?? 0;
          return aOrder - bOrder || (b.completedAt ?? "").localeCompare(a.completedAt ?? "");
        });

      return {
        list,
        activeTasks: listActiveTasks,
        visibleTasks: visibleTasksForList(listActiveTasks),
        completedTasks: listCompletedTasks,
        completedOpen: workspace.preferences.completedOpenByList[list.id] ?? false,
      };
    });
  }, [
    recurrenceByTask,
    searchQuery,
    subtasksByTask,
    taskSortMode,
    taskViewFilter,
    visibleBoardLists,
    workspace.preferences.completedOpenByList,
    workspace.tasks,
  ]);
  const taskViewFiltered = taskViewFilter !== "all";
  const taskSorted = taskSortMode !== "custom";
  const reorderLocked = Boolean(taskViewFiltered || taskSorted);

  useEffect(() => {
    if (!selectedTaskId) {
      return;
    }

    const timer = window.setTimeout(() => {
      const selectedCard = Array.from(document.querySelectorAll<HTMLElement>("[data-task-id]")).find(
        (element) => element.dataset.taskId === selectedTaskId,
      );

      selectedCard?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
        behavior: "smooth",
      });
    }, 0);

    return () => window.clearTimeout(timer);
  }, [activeListId, activeTasks, selectedTaskId]);

  const recurringCatchUps = useMemo(() => {
    if (!activeListId) {
      return [];
    }

    return workspace.tasks
      .filter((task) => task.listId === activeListId && !task.isCompleted)
      .map((task) => {
        const rule = recurrenceByTask.get(task.id) ?? null;
        const target = rule ? recurrenceCatchUpTarget(rule, task) : null;

        return rule && target ? { task, rule, target } : null;
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
  }, [activeListId, recurrenceByTask, workspace.tasks]);

  const completedTasks = useMemo(() => {
    return workspace.tasks
      .filter((task) => task.listId === activeListId && task.isCompleted)
      .sort((a, b) => {
        const aOrder = a.completedSortOrder ?? 0;
        const bOrder = b.completedSortOrder ?? 0;
        return aOrder - bOrder || (b.completedAt ?? "").localeCompare(a.completedAt ?? "");
      });
  }, [activeListId, workspace.tasks]);

  const selectedTask = selectedTaskId
    ? workspace.tasks.find((task) => task.id === selectedTaskId) ?? null
    : null;

  const selectedTaskSubtasks = selectedTask
    ? subtasksByTask.get(selectedTask.id) ?? []
    : [];

  const selectedTaskRecurrence = selectedTask
    ? recurrenceByTask.get(selectedTask.id) ?? null
    : null;
  const selectedTaskCatchUp =
    selectedTask && selectedTaskRecurrence
      ? recurrenceCatchUpTarget(selectedTaskRecurrence, selectedTask)
      : null;

  const completedOpen = activeListId
    ? workspace.preferences.completedOpenByList[activeListId] ?? false
    : false;
  const currentSaveStatus = saveStatus(saveState, mode, demoReady);
  const quickCaptureIntent = useMemo(
    () => parseQuickCaptureIntent(quickTitle, unarchivedLists),
    [quickTitle, unarchivedLists],
  );
  const workspacePulse = useMemo<WorkspacePulse>(() => {
    const todayKey = format(new Date(), "yyyy-MM-dd");
    const workspaceTasks = workspace.tasks.filter((task) => unarchivedListIds.has(task.listId));
    const activeAll = workspaceTasks.filter((task) => !task.isCompleted);
    const completedCount = workspaceTasks.length - activeAll.length;
    const workspaceTaskIds = new Set(workspaceTasks.map((task) => task.id));
    const openSubtasks = workspace.subtasks.filter(
      (subtask) => workspaceTaskIds.has(subtask.taskId) && !subtask.isCompleted,
    );
    const listById = new Map(workspace.lists.map((list) => [list.id, list]));
    const listActiveCounts = new Map(unarchivedLists.map((list) => [list.id, 0]));

    activeAll.forEach((task) => {
      listActiveCounts.set(task.listId, (listActiveCounts.get(task.listId) ?? 0) + 1);
    });

    const busiestList = unarchivedLists
      .slice()
      .sort((a, b) => {
        const countDelta = (listActiveCounts.get(b.id) ?? 0) - (listActiveCounts.get(a.id) ?? 0);
        return countDelta || bySortOrder(a, b);
      })[0] ?? null;

    const focusTasks = activeAll
      .slice()
      .sort((a, b) => {
        const aDue = `${a.dueDate ?? "9999-12-31"}T${a.dueTime ?? "23:59"}`;
        const bDue = `${b.dueDate ?? "9999-12-31"}T${b.dueTime ?? "23:59"}`;
        return aDue.localeCompare(bDue) || bySortOrder(a, b);
      })
      .slice(0, 3)
      .map((task) => ({
        id: task.id,
        title: task.title,
        listName: listById.get(task.listId)?.name ?? "No list",
        dueLabel: humanDue(task),
        color: task.color,
        openSubtasks: (subtasksByTask.get(task.id) ?? []).filter((subtask) => !subtask.isCompleted).length,
        isRecurring: recurrenceByTask.has(task.id),
        isOverdue: Boolean(task.dueDate && task.dueDate < todayKey),
      }));

    return {
      activeCount: activeAll.length,
      completedCount,
      dueTodayCount: activeAll.filter((task) => task.dueDate === todayKey).length,
      overdueCount: activeAll.filter((task) => task.dueDate && task.dueDate < todayKey).length,
      recurringCount: activeAll.filter((task) => recurrenceByTask.has(task.id)).length,
      openSubtasksCount: openSubtasks.length,
      completionRate: workspaceTasks.length
        ? Math.round((completedCount / workspaceTasks.length) * 100)
        : 0,
      focusTasks,
      busiestListName: busiestList?.name ?? null,
      busiestListActiveCount: busiestList ? listActiveCounts.get(busiestList.id) ?? 0 : 0,
    };
  }, [
    recurrenceByTask,
    subtasksByTask,
    unarchivedListIds,
    unarchivedLists,
    workspace.lists,
    workspace.subtasks,
    workspace.tasks,
  ]);
  const commandItems: CommandItem[] = [
    {
      id: "action-capture",
      kind: "action",
      title: "Capture a new task",
      detail: activeList ? `Add to ${activeList.name}` : "Focus the quick capture tray",
      keywords: "new add quick capture task sticky n",
      run: () => focusCommandTarget("capture"),
    },
    {
      id: "action-search",
      kind: "action",
      title: "Find in workspace",
      detail: "Highlight tasks, lists, and subtasks",
      keywords: "find search highlight workspace page current list",
      run: () => focusCommandTarget("search"),
    },
    {
      id: "action-overview",
      kind: "action",
      title: "Open command deck",
      detail: "Full-screen workspace overview",
      keywords: "overview command deck dashboard hud radar stats o",
      run: () => setOverviewOpen(true),
    },
    {
      id: "action-new-list",
      kind: "action",
      title: "Create a list",
      detail: "Open the list editor",
      keywords: "new list create",
      run: () => openListEditor("new"),
    },
    ...(activeList
      ? [
          {
            id: "action-rename-list",
            kind: "action" as const,
            title: "Rename current list",
            detail: activeList.name,
            keywords: "rename edit list current",
            run: () => openListEditor(activeList),
          },
          {
            id: "action-completed",
            kind: "action" as const,
            title: completedOpen ? "Hide completed pile" : "Open completed pile",
            detail: `${completedTasks.length} completed ${plural(completedTasks.length, "task")}`,
            keywords: "completed pile done archive show hide",
            run: toggleCompletedPile,
          },
        ]
      : []),
    ...(selectedTask
      ? [
          selectedTask.isCompleted
            ? {
                id: "action-restore-selected",
                kind: "action" as const,
                title: "Restore selected task",
                detail: selectedTask.title,
                keywords: "restore uncomplete reopen selected sticky task",
                run: () => restoreTask(selectedTask.id),
              }
            : {
                id: "action-complete-selected",
                kind: "action" as const,
                title: "Complete selected task",
                detail: selectedTask.title,
                keywords: "complete done finish selected sticky task",
                run: () => completeTask(selectedTask),
              },
          {
            id: "action-duplicate-selected",
            kind: "action" as const,
            title: "Duplicate selected task",
            detail: selectedTask.title,
            keywords: "copy duplicate selected sticky task template",
            run: () => duplicateTask(selectedTask),
          },
          {
            id: "action-delete-selected",
            kind: "action" as const,
            title: "Delete selected task",
            detail: selectedTask.title,
            keywords: "delete remove trash selected sticky task",
            run: () => requestDeleteTask(selectedTask),
          },
        ]
      : []),
    ...(completedTasks.length
      ? [
          {
            id: "action-clear-completed",
            kind: "action" as const,
            title: "Clear completed pile",
            detail: `${completedTasks.length} completed ${plural(completedTasks.length, "task")}`,
            keywords: "clear delete completed pile archive done",
            run: requestClearCompleted,
          },
        ]
      : []),
    ...TASK_VIEW_ORDER.map((filter) => ({
      id: `view-${filter}`,
      kind: "action" as const,
      title: `Show ${TASK_VIEW_LABELS[filter].toLowerCase()} tasks`,
      detail: `${taskFilterCounts[filter]} in ${activeList?.name ?? "current list"}`,
      keywords: `view filter ${filter} ${TASK_VIEW_LABELS[filter]}`,
      run: () => setTaskViewFilter(filter),
    })),
    {
      id: "sort-custom",
      kind: "action",
      title: `Sort by ${TASK_SORT_LABELS.custom.toLowerCase()} order`,
      detail: taskSortMode === "custom" ? "Already active" : "Use your saved order",
      keywords: "sort order custom manual reorder",
      run: () => setTaskSortMode("custom"),
    },
    {
      id: "sort-due",
      kind: "action",
      title: `Sort by ${TASK_SORT_LABELS.due.toLowerCase()}`,
      detail: taskSortMode === "due" ? "Already active" : "Earliest scheduled tasks first",
      keywords: "sort order due date schedule time",
      run: () => setTaskSortMode("due"),
    },
    ...unarchivedLists.map((list) => {
      const stats = listStats.get(list.id) ?? { active: 0, completed: 0 };

      return {
        id: `list-${list.id}`,
        kind: "list" as const,
        title: list.name,
        detail: `${stats.active} active, ${stats.completed} completed`,
        keywords: `open switch list ${list.name}`,
        color: list.color,
        run: () => switchList(list.id),
      };
    }),
    ...workspace.tasks
      .filter((task) => unarchivedListIds.has(task.listId) && !task.isCompleted)
      .slice()
      .sort((a, b) => {
        const aDue = `${a.dueDate ?? "9999-12-31"}T${a.dueTime ?? "23:59"}`;
        const bDue = `${b.dueDate ?? "9999-12-31"}T${b.dueTime ?? "23:59"}`;
        return aDue.localeCompare(bDue) || bySortOrder(a, b);
      })
      .map((task) => {
        const listName = listById.get(task.listId)?.name ?? "No list";
        const due = humanDue(task);
        const openSubtasks = (subtasksByTask.get(task.id) ?? []).filter((subtask) => !subtask.isCompleted).length;
        const recurring = recurrenceByTask.has(task.id);

        return {
          id: `task-${task.id}`,
          kind: "task" as const,
          title: task.title,
          detail: [
            listName,
            due,
            openSubtasks ? `${openSubtasks} open ${plural(openSubtasks, "subtask")}` : null,
            recurring ? "Repeats" : null,
          ]
            .filter(Boolean)
            .join(" - "),
          keywords: `open sticky task ${task.title} ${task.details} ${listName}`,
          color: task.color,
          run: () => openTaskInContext(task.id),
        };
      }),
  ];
  const commandSearch = commandQuery.trim().toLowerCase();
  const visibleCommandItems = commandItems
    .filter((item) => commandMatches(item, commandSearch))
    .slice(0, 10);
  const selectedCommandIndex = visibleCommandItems.length
    ? Math.min(commandIndex, visibleCommandItems.length - 1)
    : -1;

  function pushToast(toast: Omit<Toast, "id">) {
    const id = createId();
    setToasts((current) => [...current.slice(-2), { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 5200);
  }

  function runCommand(item: CommandItem) {
    closeCommandCenter();
    item.run();
  }

  async function persist(
    label: string,
    operation: () => unknown,
    rollbackData?: StickyWorkspaceData,
  ) {
    if (mode !== "supabase") {
      return true;
    }

    const saveAttempt = latestSaveAttemptRef.current + 1;
    latestSaveAttemptRef.current = saveAttempt;

    setSaveState((current) => ({
      ...current,
      pending: current.pending + 1,
      error: null,
    }));

    let rawSaveError: string | null = null;

    try {
      if (!supabase) {
        rawSaveError = "Sticky is not connected in this environment.";
      } else {
        const result = await operation();
        const results = Array.isArray(result) ? result : [result];
        const failed = results.find(hasResultError);
        rawSaveError = failed?.error?.message ?? null;
      }
    } catch (error) {
      rawSaveError = errorMessageFromUnknown(error);
    }

    const saveError = rawSaveError ? userFacingStickySaveMessage(rawSaveError) : null;

    if (saveError) {
      if (rollbackData && saveAttempt === latestSaveAttemptRef.current) {
        setWorkspace(rollbackData);
      }
      pushToast({
        title: `${label} did not save`,
        body: saveError,
      });
    }

    setSaveState((current) => ({
      pending: Math.max(0, current.pending - 1),
      lastSavedAt: saveError ? current.lastSavedAt : nowIso(),
      error: saveError,
    }));

    return !saveError;
  }

  function updateUserState(patch: Partial<StickyWorkspaceData["userState"]>) {
    const before = workspace;
    const nextState = { ...workspace.userState, ...patch };
    setWorkspace((current) => ({
      ...current,
      userState: { ...current.userState, ...patch },
    }));
    void persist(
      "Workspace state",
      () =>
        supabase!
          .from("user_state")
          .update({
            selected_list_id: nextState.selectedListId,
            search_query: nextState.searchQuery,
            last_opened_at: nowIso(),
          })
          .eq("user_id", workspace.user.id),
      before,
    );
  }

  function updatePreferences(patch: Partial<StickyWorkspaceData["preferences"]>) {
    const before = workspace;
    const preferences = { ...workspace.preferences, ...patch };
    setWorkspace((current) => ({
      ...current,
      preferences: { ...current.preferences, ...patch },
    }));
    void persist(
      "Preferences",
      () =>
        supabase!
          .from("user_preferences")
          .update({
            completed_open_by_list: preferences.completedOpenByList,
            density: preferences.density,
            color_mode: preferences.colorMode,
            board_style: preferences.boardStyle,
            task_view_filter: preferences.taskViewFilter,
            task_sort_mode: preferences.taskSortMode,
          })
          .eq("user_id", workspace.user.id),
      before,
    );
  }

  function setTaskViewFilter(nextFilter: StickyTaskViewFilter) {
    if (nextFilter === taskViewFilter) {
      return;
    }

    setTaskViewFilterState(nextFilter);
    updatePreferences({ taskViewFilter: nextFilter });
  }

  function setTaskSortMode(nextMode: StickyTaskSortMode) {
    if (nextMode === taskSortMode) {
      return;
    }

    setTaskSortModeState(nextMode);
    updatePreferences({ taskSortMode: nextMode });
  }

  function setSearchQuery(query: string) {
    updateUserState({ searchQuery: query });
  }

  function switchList(listId: string) {
    const list = workspace.lists.find((item) => item.id === listId);

    if (list && !list.archivedAt && !list.isVisibleOnBoard) {
      const before = workspace;
      const timestamp = nowIso();

      setWorkspace({
        ...workspace,
        lists: workspace.lists.map((item) =>
          item.id === listId ? { ...item, isVisibleOnBoard: true, updatedAt: timestamp } : item,
        ),
        userState: { ...workspace.userState, selectedListId: listId, searchQuery: "" },
      });
      setSelectedTaskId(null);
      persistListPatch(
        "List shown",
        listId,
        { isVisibleOnBoard: true, archivedAt: null, updatedAt: timestamp },
        before,
        listId,
      );
      return;
    }

    updateUserState({ selectedListId: listId, searchQuery: "" });
    setSelectedTaskId(null);
  }

  function fallbackListId(excludingListId: string) {
    return (
      visibleBoardLists.find((list) => list.id !== excludingListId)?.id ??
      unarchivedLists.find((list) => list.id !== excludingListId)?.id ??
      null
    );
  }

  function persistListPatch(
    label: string,
    listId: string,
    patch: Pick<Partial<StickyList>, "isVisibleOnBoard" | "archivedAt" | "updatedAt">,
    before: StickyWorkspaceData,
    selectedListId = workspace.userState.selectedListId,
  ) {
    void persist(
      label,
      () => {
        const operations = [
          supabase!
            .from("lists")
            .update({
              is_visible_on_board: patch.isVisibleOnBoard ?? true,
              archived_at: patch.archivedAt ?? null,
            })
            .eq("id", listId),
        ];

        if (selectedListId !== before.userState.selectedListId) {
          operations.push(
            supabase!
              .from("user_state")
              .update({
                selected_list_id: selectedListId,
                search_query: "",
                last_opened_at: nowIso(),
              })
              .eq("user_id", before.user.id),
          );
        }

        return Promise.all(operations);
      },
      before,
    );
  }

  function toggleListBoardVisibility(list: StickyList) {
    if (list.archivedAt) {
      return;
    }

    const before = workspace;
    const timestamp = nowIso();
    const nextVisible = !list.isVisibleOnBoard;
    const nextSelectedListId =
      !nextVisible && activeListId === list.id
        ? fallbackListId(list.id)
        : workspace.userState.selectedListId;

    setWorkspace({
      ...workspace,
      lists: workspace.lists.map((item) =>
        item.id === list.id
          ? { ...item, isVisibleOnBoard: nextVisible, updatedAt: timestamp }
          : item,
      ),
      userState: {
        ...workspace.userState,
        selectedListId: nextSelectedListId,
        searchQuery: nextSelectedListId === workspace.userState.selectedListId ? workspace.userState.searchQuery : "",
      },
    });

    persistListPatch(
      nextVisible ? "List shown" : "List hidden",
      list.id,
      { isVisibleOnBoard: nextVisible, updatedAt: timestamp },
      before,
      nextSelectedListId,
    );
  }

  function archiveList(list: StickyList) {
    if (unarchivedLists.length <= 1) {
      pushToast({
        title: "Keep one active list",
        body: "Archive another list after creating or restoring a replacement.",
      });
      return;
    }

    const before = workspace;
    const timestamp = nowIso();
    const nextSelectedListId =
      activeListId === list.id ? fallbackListId(list.id) : workspace.userState.selectedListId;

    setWorkspace({
      ...workspace,
      lists: workspace.lists.map((item) =>
        item.id === list.id
          ? {
              ...item,
              isVisibleOnBoard: false,
              archivedAt: timestamp,
              updatedAt: timestamp,
            }
          : item,
      ),
      userState: {
        ...workspace.userState,
        selectedListId: nextSelectedListId,
        searchQuery: "",
      },
    });
    setSelectedTaskId(null);
    persistListPatch(
      "List archive",
      list.id,
      { isVisibleOnBoard: false, archivedAt: timestamp, updatedAt: timestamp },
      before,
      nextSelectedListId,
    );
    pushToast({
      title: "List archived",
      body: `${list.name} moved out of the main board.`,
      actionLabel: "Restore",
      onAction: () => restoreArchivedList(list.id),
    });
  }

  function restoreArchivedList(listId: string) {
    const before = workspaceRef.current;
    const list = before.lists.find((item) => item.id === listId);

    if (!list) {
      return;
    }

    const timestamp = nowIso();
    setWorkspace({
      ...before,
      lists: before.lists.map((item) =>
        item.id === listId
          ? {
              ...item,
              isVisibleOnBoard: true,
              archivedAt: null,
              updatedAt: timestamp,
            }
          : item,
      ),
      userState: {
        ...before.userState,
        selectedListId: listId,
        searchQuery: "",
      },
    });
    setSelectedTaskId(null);
    persistListPatch(
      "List restore",
      listId,
      { isVisibleOnBoard: true, archivedAt: null, updatedAt: timestamp },
      before,
      listId,
    );
  }

  function openTaskInContext(taskId: string) {
    const task = workspace.tasks.find((item) => item.id === taskId);

    if (!task) {
      return;
    }

    quickCaptureClosedDetailsRef.current = false;

    if (task.listId !== activeListId || workspace.userState.searchQuery) {
      updateUserState({ selectedListId: task.listId, searchQuery: "" });
    }

    if (taskViewFilter !== "all") {
      setTaskViewFilter("all");
    }

    setSelectedTaskId(task.id);
  }

  function saveList(name: string, color: StickyColor) {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }

    const before = workspace;

    if (listEditor === "new") {
      const list: StickyList = {
        id: createId(),
        userId: workspace.user.id,
        name: trimmed,
        color,
        sortOrder: nextSortOrder(workspace.lists),
        isVisibleOnBoard: true,
        archivedAt: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };

      setWorkspace({
        ...workspace,
        lists: [...workspace.lists, list],
        userState: { ...workspace.userState, selectedListId: list.id, searchQuery: "" },
      });
      closeListEditor();
      void persist(
        "List",
        async () => {
          const listResult = await supabase!.from("lists").insert(listInsertPayload(list));

          if (listResult.error) {
            return listResult;
          }

          return supabase!
            .from("user_state")
            .update({
              selected_list_id: list.id,
              search_query: "",
              last_opened_at: nowIso(),
            })
            .eq("user_id", workspace.user.id);
        },
        before,
      );
      return;
    }

    if (listEditor) {
      const list = listEditor;
      setWorkspace({
        ...workspace,
        lists: workspace.lists.map((item) =>
          item.id === list.id
            ? { ...item, name: trimmed, color, updatedAt: nowIso() }
            : item,
        ),
      });
      closeListEditor();
      void persist(
        "List",
        () =>
          supabase!
            .from("lists")
            .update({
              name: trimmed,
              color,
            })
            .eq("id", list.id),
        before,
      );
    }
  }

  function requestDeleteList(list: StickyList) {
    if (workspace.lists.length <= 1) {
      pushToast({
        title: "Keep one list",
        body: "Sticky needs at least one list for capture.",
      });
      return;
    }

    if (!list.archivedAt && unarchivedLists.length <= 1) {
      pushToast({
        title: "Keep one active list",
        body: "Archive or restore another list before removing this active list.",
      });
      return;
    }

    const taskCount = workspace.tasks.filter((task) => task.listId === list.id).length;
    openConfirmDialog({
      title: `Delete ${list.name}?`,
      body: `This removes ${taskCount} ${plural(taskCount, "task")} and their subtasks.`,
      actionLabel: "Delete list",
      tone: "danger",
      onConfirm: () => deleteList(list),
    });
  }

  function deleteList(list: StickyList) {
    const before = workspace;
    const fallbackList = workspace.lists.find((item) => item.id !== list.id && !item.archivedAt) ?? null;
    const deletedTasks = workspace.tasks.filter((task) => task.listId === list.id);
    const deletedTaskIds = new Set(deletedTasks.map((task) => task.id));
    const deletedSubtasks = workspace.subtasks.filter((subtask) =>
      deletedTaskIds.has(subtask.taskId),
    );
    const deletedRules = workspace.recurrenceRules.filter((rule) =>
      deletedTaskIds.has(rule.taskId),
    );

    setWorkspace({
      ...workspace,
      lists: workspace.lists.filter((item) => item.id !== list.id),
      tasks: workspace.tasks.filter((task) => task.listId !== list.id),
      subtasks: workspace.subtasks.filter((subtask) => !deletedTaskIds.has(subtask.taskId)),
      recurrenceRules: workspace.recurrenceRules.filter((rule) => !deletedTaskIds.has(rule.taskId)),
      userState: {
        ...workspace.userState,
        selectedListId: fallbackList?.id ?? null,
        searchQuery: "",
      },
    });
    setConfirmRequest(null);
    setSelectedTaskId(null);
    const deleteRequest = persist(
      "List delete",
      () => supabase!.from("lists").delete().eq("id", list.id),
      before,
    );
    let undoUsed = false;
    pushToast({
      title: "List deleted",
      body: `${list.name} and ${deletedTasks.length} ${plural(deletedTasks.length, "task")} can be restored.`,
      actionLabel: "Undo",
      onAction: () => {
        if (undoUsed) {
          return;
        }
        undoUsed = true;

        void deleteRequest.then((deleteSaved) => {
          if (!deleteSaved) {
            return;
          }

          const restoreBefore = workspaceRef.current;
          setWorkspace((current) => {
            const restoredState = {
              ...current.userState,
              selectedListId: list.id,
              searchQuery: "",
            };

            if (current.lists.some((item) => item.id === list.id)) {
              return {
                ...current,
                userState: restoredState,
              };
            }

            return {
              ...current,
              lists: [...current.lists, list],
              tasks: [...current.tasks, ...deletedTasks],
              subtasks: [...current.subtasks, ...deletedSubtasks],
              recurrenceRules: [...current.recurrenceRules, ...deletedRules],
              userState: restoredState,
            };
          });
          setSelectedTaskId(null);
          void persist(
            "Undo list delete",
            async () => {
              const listResult = await supabase!.from("lists").insert(listInsertPayload(list));

              if (listResult.error) {
                return listResult;
              }

              if (deletedTasks.length) {
                const tasksResult = await supabase!
                  .from("tasks")
                  .insert(deletedTasks.map(taskInsertPayload));

                if (tasksResult.error) {
                  return tasksResult;
                }
              }

              if (deletedSubtasks.length) {
                const subtasksResult = await supabase!
                  .from("subtasks")
                  .insert(deletedSubtasks.map(subtaskInsertPayload));

                if (subtasksResult.error) {
                  return subtasksResult;
                }
              }

              if (deletedRules.length) {
                const rulesResult = await supabase!
                  .from("task_recurrence_rules")
                  .insert(deletedRules.map(recurrenceInsertPayload));

                if (rulesResult.error) {
                  return rulesResult;
                }
              }

              return supabase!
                .from("user_state")
                .update({
                  selected_list_id: list.id,
                  search_query: "",
                  last_opened_at: nowIso(),
                })
                .eq("user_id", list.userId);
            },
            restoreBefore,
          );
        });
      },
    });
  }

  function saveListOrder(ordered: StickyList[], before: StickyWorkspaceData) {
    const timestamp = nowIso();
    const moved = ordered.map((list, index) => ({
      ...list,
      sortOrder: (index + 1) * 1000,
      updatedAt: timestamp,
    }));
    const movedById = new Map(moved.map((list) => [list.id, list]));

    setWorkspace({
      ...workspace,
      lists: workspace.lists.map((list) => movedById.get(list.id) ?? list),
    });
    void persist(
      "List order",
      () =>
        supabase!.rpc("reorder_lists", {
          p_list_ids: moved.map((list) => list.id),
        }),
      before,
    );
  }

  function moveListInOrder(listId: string, direction: -1 | 1) {
    const ordered = unarchivedLists.slice().sort(bySortOrder);
    const oldIndex = ordered.findIndex((list) => list.id === listId);
    const newIndex = oldIndex + direction;

    if (oldIndex < 0 || newIndex < 0 || newIndex >= ordered.length) {
      return;
    }

    saveListOrder(arrayMove(ordered, oldIndex, newIndex), workspace);
  }

  function createTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const intent = parseQuickCaptureIntent(quickTitle, unarchivedLists);
    const title = intent.title.trim();
    const targetList = intent.listId
      ? unarchivedLists.find((list) => list.id === intent.listId)
      : activeList;
    const targetListId = targetList?.id ?? activeListId;

    if (!title || !targetListId) {
      return;
    }

    const before = workspace;
    const stateShouldReveal =
      targetListId !== activeListId || Boolean(workspace.userState.searchQuery);
    const nextUserState = stateShouldReveal
      ? { ...workspace.userState, selectedListId: targetListId, searchQuery: "" }
      : workspace.userState;
    const nextPreferences =
      taskViewFilter === "all"
        ? workspace.preferences
        : { ...workspace.preferences, taskViewFilter: "all" as const };
    // Composer fields win over parsed ones; a bare time implies today.
    const draftDueTime = captureDraft.dueTime || intent.dueTime;
    const draftDueDate =
      captureDraft.dueDate || intent.dueDate || (draftDueTime ? localDateKey() : null);
    const task: StickyTask = {
      id: createId(),
      userId: workspace.user.id,
      listId: targetListId,
      title,
      details: captureDraft.details.trim(),
      color: targetList?.color ?? activeList?.color ?? "sun",
      dueDate: draftDueDate,
      dueTime: draftDueTime,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago",
      isCompleted: false,
      completedAt: null,
      sortOrder: nextSortOrder(workspace.tasks.filter((item) => item.listId === targetListId && !item.isCompleted)),
      completedSortOrder: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    const repeatDraft = captureDraft.repeat;
    const captureRule: StickyRecurrenceRule | null = !repeatDraft
      ? null
      : {
          id: createId(),
          userId: workspace.user.id,
          taskId: task.id,
          frequency: repeatDraft.frequency,
          intervalCount: Math.max(1, repeatDraft.interval),
          daysOfWeek:
            repeatDraft.frequency === "weekly"
              ? repeatDraft.daysOfWeek.length
                ? [...new Set(repeatDraft.daysOfWeek)].sort((a, b) => a - b)
                : [startDayOfWeek(task.dueDate ?? localDateKey())]
              : [],
          monthDay: recurrenceUsesMonthDay(repeatDraft.frequency)
            ? startMonthDay(task.dueDate ?? localDateKey())
            : null,
          startsOn: task.dueDate ?? localDateKey(),
          endType: "never",
          endDate: null,
          occurrenceCount: null,
          timezone: task.timezone,
          paused: false,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };

    setQuickTitle("");
    setCaptureDraft({ details: "", dueDate: "", dueTime: "", repeat: null });
    setCaptureExpanded(false);
    setTaskViewFilter("all");
    const shouldSelectCreatedTask = !quickCaptureClosedDetailsRef.current;
    quickCaptureClosedDetailsRef.current = false;
    setWorkspace({
      ...workspace,
      tasks: [...workspace.tasks, task],
      recurrenceRules: captureRule
        ? [...workspace.recurrenceRules, captureRule]
        : workspace.recurrenceRules,
      preferences: nextPreferences,
      userState: nextUserState,
    });
    setSelectedTaskId(shouldSelectCreatedTask ? task.id : null);
    void persist(
      "Sticky",
      async () => {
        const taskResult = await supabase!.from("tasks").insert({
          id: task.id,
          user_id: task.userId,
          list_id: task.listId,
          title: task.title,
          details: task.details,
          color: task.color,
          due_date: task.dueDate,
          due_time: task.dueTime,
          timezone: task.timezone,
          is_completed: task.isCompleted,
          completed_at: task.completedAt,
          sort_order: task.sortOrder,
          completed_sort_order: task.completedSortOrder,
        });

        if (taskResult.error) {
          return taskResult;
        }

        if (captureRule) {
          const ruleResult = await supabase!
            .from("task_recurrence_rules")
            .insert(recurrenceInsertPayload(captureRule));
          if (ruleResult.error) {
            return ruleResult;
          }
        }

        if (!stateShouldReveal) {
          return taskResult;
        }

        return supabase!
          .from("user_state")
          .update({
            selected_list_id: nextUserState.selectedListId,
            search_query: nextUserState.searchQuery,
            last_opened_at: nowIso(),
          })
          .eq("user_id", workspace.user.id);
      },
      before,
    );
  }

  function updateTask(taskId: string, patch: Partial<StickyTask>, save = true) {
    const before = workspace;
    const updatedAt = nowIso();
    const nextTasks = workspace.tasks.map((task) =>
      task.id === taskId ? { ...task, ...patch, updatedAt } : task,
    );
    setWorkspace({ ...workspace, tasks: nextTasks });

    if (!save) {
      return;
    }

    void persist(
      "Sticky",
      () =>
        supabase!
          .from("tasks")
          .update(taskToDb({ ...patch, updatedAt } as Partial<StickyTask>))
          .eq("id", taskId),
      before,
    );
  }

  function moveTask(task: StickyTask, listId: string) {
    if (task.listId === listId) {
      return;
    }

    const before = workspace;
    const targetActive = workspace.tasks.filter((item) => item.listId === listId && !item.isCompleted);
    const targetCompleted = workspace.tasks.filter(
      (item) => item.listId === listId && item.isCompleted,
    );
    const patch: Partial<StickyTask> = task.isCompleted
      ? {
          listId,
          completedSortOrder: nextCompletedSortOrder(targetCompleted),
        }
      : {
          listId,
          sortOrder: nextSortOrder(targetActive),
        };

    setWorkspace({
      ...workspace,
      tasks: workspace.tasks.map((item) =>
        item.id === task.id ? { ...item, ...patch, updatedAt: nowIso() } : item,
      ),
    });
    void persist(
      "Sticky move",
      () =>
        supabase!.rpc("move_task", {
          p_task_id: task.id,
          p_target_list_id: listId,
        }),
      before,
    );
  }

  function saveTaskOrder(ordered: StickyTask[], before: StickyWorkspaceData, listId = activeListId) {
    if (!listId) {
      return;
    }

    const moved = ordered.map((task, index) => ({
      ...task,
      sortOrder: (index + 1) * 1000,
    }));
    const movedMap = new Map(moved.map((task) => [task.id, task]));

    setWorkspace({
      ...workspace,
      tasks: workspace.tasks.map((task) => movedMap.get(task.id) ?? task),
    });
    void persist(
      "Sticky order",
      () =>
        supabase!.rpc("reorder_tasks", {
          p_list_id: listId,
          p_task_ids: moved.map((task) => task.id),
        }),
      before,
    );
  }

  function moveTaskInOrder(taskId: string, direction: -1 | 1) {
    if (reorderLocked) {
      pushToast({
        title: "Reorder paused during alternate views",
        body: "Use All and Custom order before changing saved order.",
      });
      return;
    }

    const task = workspace.tasks.find((item) => item.id === taskId);
    const listId = task?.listId ?? activeListId;
    const ordered = workspace.tasks
      .filter((item) => item.listId === listId && !item.isCompleted)
      .sort(bySortOrder);
    const oldIndex = ordered.findIndex((item) => item.id === taskId);
    const newIndex = oldIndex + direction;

    if (oldIndex < 0 || newIndex < 0 || newIndex >= ordered.length) {
      return;
    }

    saveTaskOrder(arrayMove(ordered, oldIndex, newIndex), workspace, listId);
  }

  function completeTask(task: StickyTask) {
    const before = workspace;
    const completedAt = nowIso();
    const completedInList = workspace.tasks.filter(
      (item) => item.listId === task.listId && item.isCompleted,
    );
    const recurrenceRule = recurrenceByTask.get(task.id) ?? null;
    const nextOccurrence = recurrenceRule
      ? createNextRecurringOccurrence(workspace, task, recurrenceRule)
      : null;

    setWorkspace({
      ...workspace,
      tasks: [
        ...workspace.tasks.map((item) =>
          item.id === task.id
            ? {
                ...item,
                isCompleted: true,
                completedAt,
                completedSortOrder: nextCompletedSortOrder(completedInList),
                updatedAt: completedAt,
              }
            : item,
        ),
        ...(nextOccurrence ? [nextOccurrence.task] : []),
      ],
      recurrenceRules: nextOccurrence
        ? workspace.recurrenceRules.map((rule) =>
            rule.id === nextOccurrence.rule.id ? nextOccurrence.rule : rule,
          )
        : workspace.recurrenceRules,
    });
    void persist(
      "Sticky completion",
      () =>
        nextOccurrence
          ? supabase!.rpc("complete_task_with_recurrence", {
              p_task_id: task.id,
              p_next_task_id: nextOccurrence.task.id,
              p_next_due_date: nextOccurrence.task.dueDate,
              p_next_due_time: nextOccurrence.task.dueTime,
              p_next_occurrence_count: nextOccurrence.rule.occurrenceCount,
            })
          : supabase!.rpc("set_task_completed", {
              p_task_id: task.id,
              p_completed: true,
            }),
      before,
    );
    pushToast({
      title: "Task completed",
      body: nextOccurrence?.task.dueDate
        ? `Next repeat: ${humanDate(nextOccurrence.task.dueDate)}`
        : task.title,
      actionLabel: "Undo",
      onAction: () => {
        if (!nextOccurrence || !recurrenceRule) {
          restoreTask(task.id);
          return;
        }

        const restoreBefore = workspaceRef.current;
        setWorkspace((current) => ({
          ...current,
          tasks: current.tasks
            .filter((item) => item.id !== nextOccurrence.task.id)
            .map((item) =>
              item.id === task.id
                ? {
                    ...item,
                    isCompleted: false,
                    completedAt: null,
                    completedSortOrder: null,
                    sortOrder: nextSortOrder(
                      current.tasks.filter(
                        (active) =>
                          active.listId === task.listId &&
                          !active.isCompleted &&
                          active.id !== nextOccurrence.task.id,
                      ),
                    ),
                    updatedAt: nowIso(),
                  }
                : item,
            ),
          recurrenceRules: current.recurrenceRules.map((rule) =>
            rule.id === recurrenceRule.id ? recurrenceRule : rule,
          ),
        }));
        void persist(
          "Undo completion",
          () =>
            supabase!.rpc("undo_recurring_completion", {
              p_task_id: task.id,
              p_generated_task_id: nextOccurrence.task.id,
              p_recurrence_rule_id: recurrenceRule.id,
              p_occurrence_count: recurrenceRule.occurrenceCount,
            }),
          restoreBefore,
        );
      },
    });
  }

  function restoreTask(taskId: string) {
    const task = workspace.tasks.find((item) => item.id === taskId);
    if (!task) {
      return;
    }
    const before = workspace;
    const activeInList = workspace.tasks.filter(
      (item) => item.listId === task.listId && !item.isCompleted,
    );

    setWorkspace({
      ...workspace,
      tasks: workspace.tasks.map((item) =>
        item.id === taskId
          ? {
              ...item,
              isCompleted: false,
              completedAt: null,
              completedSortOrder: null,
              sortOrder: nextSortOrder(activeInList),
              updatedAt: nowIso(),
            }
          : item,
      ),
    });
    void persist(
      "Sticky restore",
      () =>
        supabase!.rpc("set_task_completed", {
          p_task_id: taskId,
          p_completed: false,
        }),
      before,
    );
  }

  function requestDeleteTask(task: StickyTask) {
    openConfirmDialog({
      title: `Delete ${task.title}?`,
      body: "The task, subtasks, and recurrence settings will be removed.",
      actionLabel: "Delete task",
      tone: "danger",
      onConfirm: () => deleteTask(task),
    });
  }

  function deleteTask(task: StickyTask) {
    const before = workspace;
    const deletedSubtasks = workspace.subtasks.filter((subtask) => subtask.taskId === task.id);
    const deletedRules = workspace.recurrenceRules.filter((rule) => rule.taskId === task.id);

    setWorkspace({
      ...workspace,
      tasks: workspace.tasks.filter((item) => item.id !== task.id),
      subtasks: workspace.subtasks.filter((subtask) => subtask.taskId !== task.id),
      recurrenceRules: workspace.recurrenceRules.filter((rule) => rule.taskId !== task.id),
    });
    setSelectedTaskId((current) => (current === task.id ? null : current));
    setConfirmRequest(null);
    void persist("Sticky delete", () => supabase!.from("tasks").delete().eq("id", task.id), before);
    pushToast({
      title: "Task deleted",
      body: task.title,
      actionLabel: "Undo",
      onAction: () => {
        const restoreBefore = workspaceRef.current;
        setWorkspace((current) => ({
          ...current,
          tasks: [...current.tasks, task],
          subtasks: [...current.subtasks, ...deletedSubtasks],
          recurrenceRules: [...current.recurrenceRules, ...deletedRules],
        }));
        void persist(
          "Undo delete",
          () =>
            Promise.all([
              supabase!.from("tasks").insert({
                id: task.id,
                user_id: task.userId,
                list_id: task.listId,
                title: task.title,
                details: task.details,
                color: task.color,
                due_date: task.dueDate,
                due_time: task.dueTime,
                timezone: task.timezone,
                is_completed: task.isCompleted,
                completed_at: task.completedAt,
                sort_order: task.sortOrder,
                completed_sort_order: task.completedSortOrder,
              }),
              deletedSubtasks.length
                ? supabase!.from("subtasks").insert(
                    deletedSubtasks.map((subtask) => ({
                      id: subtask.id,
                      user_id: subtask.userId,
                      task_id: subtask.taskId,
                      title: subtask.title,
                      is_completed: subtask.isCompleted,
                      completed_at: subtask.completedAt,
                      sort_order: subtask.sortOrder,
                    })),
                  )
                : Promise.resolve({ error: null }),
              deletedRules.length
                ? supabase!.from("task_recurrence_rules").insert(
                    deletedRules.map((rule) => ({
                      id: rule.id,
                      user_id: rule.userId,
                      task_id: rule.taskId,
                      frequency: rule.frequency,
                      interval_count: rule.intervalCount,
                      days_of_week: rule.daysOfWeek,
                      month_day: rule.monthDay,
                      starts_on: rule.startsOn,
                      end_type: rule.endType,
                      end_date: rule.endDate,
                      occurrence_count: rule.occurrenceCount,
                      timezone: rule.timezone,
                      paused: rule.paused,
                    })),
                  )
                : Promise.resolve({ error: null }),
            ]),
          restoreBefore,
        );
      },
    });
  }

  function duplicateTask(task: StickyTask) {
    const before = workspace;
    const timestamp = nowIso();
    const duplicateId = createId();
    const activeInList = workspace.tasks.filter(
      (item) => item.listId === task.listId && !item.isCompleted,
    );
    const sourceSubtasks = (subtasksByTask.get(task.id) ?? []).slice().sort(bySortOrder);
    const sourceRule = recurrenceByTask.get(task.id) ?? null;
    const duplicate: StickyTask = {
      ...task,
      id: duplicateId,
      title: `${task.title} copy`,
      isCompleted: false,
      completedAt: null,
      completedSortOrder: null,
      sortOrder: nextSortOrder(activeInList),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const duplicateSubtasks = sourceSubtasks.map((subtask, index) => ({
      ...subtask,
      id: createId(),
      taskId: duplicate.id,
      isCompleted: false,
      completedAt: null,
      sortOrder: (index + 1) * 1000,
      createdAt: timestamp,
      updatedAt: timestamp,
    }));
    const duplicateRule =
      sourceRule && duplicateSubtasks.length === 0
        ? {
            ...sourceRule,
            id: createId(),
            taskId: duplicate.id,
            createdAt: timestamp,
            updatedAt: timestamp,
          }
        : null;
    const shouldUpdateState =
      task.listId !== activeListId || Boolean(workspace.userState.searchQuery) || taskViewFilter !== "all";
    const nextUserState = shouldUpdateState
      ? { ...workspace.userState, selectedListId: task.listId, searchQuery: "" }
      : workspace.userState;
    const nextPreferences =
      taskViewFilter === "all"
        ? workspace.preferences
        : { ...workspace.preferences, taskViewFilter: "all" as const };

    setTaskViewFilter("all");
    setWorkspace({
      ...workspace,
      tasks: [...workspace.tasks, duplicate],
      subtasks: [...workspace.subtasks, ...duplicateSubtasks],
      recurrenceRules: duplicateRule
        ? [...workspace.recurrenceRules, duplicateRule]
        : workspace.recurrenceRules,
      preferences: nextPreferences,
      userState: nextUserState,
    });
    setSelectedTaskId(duplicate.id);
    void persist(
      "Sticky duplicate",
      async () => {
        const taskResult = await supabase!.from("tasks").insert(taskInsertPayload(duplicate));

        if (taskResult.error) {
          return taskResult;
        }

        if (duplicateSubtasks.length) {
          const subtasksResult = await supabase!
            .from("subtasks")
            .insert(duplicateSubtasks.map(subtaskInsertPayload));

          if (subtasksResult.error) {
            return subtasksResult;
          }
        }

        if (duplicateRule) {
          const ruleResult = await supabase!
            .from("task_recurrence_rules")
            .insert(recurrenceInsertPayload(duplicateRule));

          if (ruleResult.error) {
            return ruleResult;
          }
        }

        if (!shouldUpdateState) {
          return taskResult;
        }

        return supabase!
          .from("user_state")
          .update({
            selected_list_id: nextUserState.selectedListId,
            search_query: nextUserState.searchQuery,
            last_opened_at: nowIso(),
          })
          .eq("user_id", workspace.user.id);
      },
      before,
    );
    pushToast({
      title: "Task duplicated",
      body: duplicate.title,
      actionLabel: "Undo",
      onAction: () => {
        const restoreBefore = workspaceRef.current;
        setWorkspace((current) => ({
          ...current,
          tasks: current.tasks.filter((item) => item.id !== duplicate.id),
          subtasks: current.subtasks.filter((subtask) => subtask.taskId !== duplicate.id),
          recurrenceRules: current.recurrenceRules.filter((rule) => rule.taskId !== duplicate.id),
        }));
        setSelectedTaskId((current) => (current === duplicate.id ? task.id : current));
        void persist(
          "Undo duplicate",
          () => supabase!.from("tasks").delete().eq("id", duplicate.id),
          restoreBefore,
        );
      },
    });
  }

  function requestClearCompleted() {
    if (!activeListId || completedTasks.length === 0) {
      return;
    }

    openConfirmDialog({
      title: "Clear completed pile?",
      body: `This deletes ${completedTasks.length} completed ${plural(completedTasks.length, "task")} from ${activeList?.name ?? "this list"}.`,
      actionLabel: "Clear completed",
      tone: "danger",
      onConfirm: clearCompleted,
    });
  }

  function clearCompleted() {
    if (!activeListId) {
      return;
    }

    const before = workspace;
    const deletedIds = new Set(completedTasks.map((task) => task.id));
    const deletedTasks = completedTasks;
    const deletedSubtasks = workspace.subtasks.filter((subtask) => deletedIds.has(subtask.taskId));
    const deletedRules = workspace.recurrenceRules.filter((rule) => deletedIds.has(rule.taskId));

    setWorkspace({
      ...workspace,
      tasks: workspace.tasks.filter((task) => !deletedIds.has(task.id)),
      subtasks: workspace.subtasks.filter((subtask) => !deletedIds.has(subtask.taskId)),
      recurrenceRules: workspace.recurrenceRules.filter((rule) => !deletedIds.has(rule.taskId)),
    });
    setConfirmRequest(null);
    void persist(
      "Clear completed",
      () =>
        supabase!.rpc("clear_completed_tasks", {
          p_list_id: activeListId,
        }),
      before,
    );
    pushToast({
      title: "Completed pile cleared",
      body: "You can undo this while the toast is visible.",
      actionLabel: "Undo",
      onAction: () => {
        const restoreBefore = workspaceRef.current;
        setWorkspace((current) => ({
          ...current,
          tasks: [...current.tasks, ...deletedTasks],
          subtasks: [...current.subtasks, ...deletedSubtasks],
          recurrenceRules: [...current.recurrenceRules, ...deletedRules],
        }));
        void persist(
          "Undo clear",
          () =>
            Promise.all([
              supabase!.from("tasks").insert(
                deletedTasks.map((task) => ({
                  id: task.id,
                  user_id: task.userId,
                  list_id: task.listId,
                  title: task.title,
                  details: task.details,
                  color: task.color,
                  due_date: task.dueDate,
                  due_time: task.dueTime,
                  timezone: task.timezone,
                  is_completed: task.isCompleted,
                  completed_at: task.completedAt,
                  sort_order: task.sortOrder,
                  completed_sort_order: task.completedSortOrder,
                })),
              ),
              deletedSubtasks.length
                ? supabase!.from("subtasks").insert(
                    deletedSubtasks.map((subtask) => ({
                      id: subtask.id,
                      user_id: subtask.userId,
                      task_id: subtask.taskId,
                      title: subtask.title,
                      is_completed: subtask.isCompleted,
                      completed_at: subtask.completedAt,
                      sort_order: subtask.sortOrder,
                    })),
                  )
                : Promise.resolve({ error: null }),
              deletedRules.length
                ? supabase!.from("task_recurrence_rules").insert(
                    deletedRules.map((rule) => ({
                      id: rule.id,
                      user_id: rule.userId,
                      task_id: rule.taskId,
                      frequency: rule.frequency,
                      interval_count: rule.intervalCount,
                      days_of_week: rule.daysOfWeek,
                      month_day: rule.monthDay,
                      starts_on: rule.startsOn,
                      end_type: rule.endType,
                      end_date: rule.endDate,
                      occurrence_count: rule.occurrenceCount,
                      timezone: rule.timezone,
                      paused: rule.paused,
                    })),
                  )
                : Promise.resolve({ error: null }),
            ]),
          restoreBefore,
        );
      },
    });
  }

  function addSubtask(task: StickyTask, title: string) {
    const trimmed = title.trim();
    if (!trimmed) {
      return;
    }

    if (recurrenceByTask.has(task.id)) {
      pushToast({
        title: "Repeating tasks stay simple",
        body: "Remove the recurrence before adding subtasks.",
      });
      return;
    }

    const before = workspace;
    const existing = subtasksByTask.get(task.id) ?? [];
    const subtask: StickySubtask = {
      id: createId(),
      userId: workspace.user.id,
      taskId: task.id,
      title: trimmed,
      isCompleted: false,
      completedAt: null,
      sortOrder: nextSortOrder(existing),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    setWorkspace({ ...workspace, subtasks: [...workspace.subtasks, subtask] });
    void persist(
      "Subtask",
      () => supabase!.from("subtasks").insert(subtaskInsertPayload(subtask)),
      before,
    );
  }

  function updateSubtask(subtaskId: string, patch: Partial<StickySubtask>, save = true) {
    const before = workspace;
    setWorkspace({
      ...workspace,
      subtasks: workspace.subtasks.map((subtask) =>
        subtask.id === subtaskId ? { ...subtask, ...patch, updatedAt: nowIso() } : subtask,
      ),
    });

    if (!save) {
      return;
    }

    void persist(
      "Subtask",
      () =>
        supabase!
          .from("subtasks")
          .update(subtaskToDb(patch))
          .eq("id", subtaskId),
      before,
    );
  }

  function saveSubtaskOrder(
    taskId: string,
    ordered: StickySubtask[],
    before: StickyWorkspaceData,
  ) {
    const timestamp = nowIso();
    const moved = ordered.map((subtask, index) => ({
      ...subtask,
      sortOrder: (index + 1) * 1000,
      updatedAt: timestamp,
    }));
    const movedMap = new Map(moved.map((subtask) => [subtask.id, subtask]));

    setWorkspace({
      ...workspace,
      subtasks: workspace.subtasks.map((subtask) => movedMap.get(subtask.id) ?? subtask),
    });
    void persist(
      "Subtask order",
      () =>
        supabase!.rpc("reorder_subtasks", {
          p_task_id: taskId,
          p_subtask_ids: moved.map((subtask) => subtask.id),
        }),
      before,
    );
  }

  function moveSubtaskInOrder(taskId: string, subtaskId: string, direction: -1 | 1) {
    const ordered = (subtasksByTask.get(taskId) ?? []).slice().sort(bySortOrder);
    const oldIndex = ordered.findIndex((subtask) => subtask.id === subtaskId);
    const newIndex = oldIndex + direction;

    if (oldIndex < 0 || newIndex < 0 || newIndex >= ordered.length) {
      return;
    }

    saveSubtaskOrder(taskId, arrayMove(ordered, oldIndex, newIndex), workspace);
  }

  function deleteSubtask(subtaskId: string) {
    const subtask = workspace.subtasks.find((item) => item.id === subtaskId);

    if (!subtask) {
      return;
    }

    const before = workspace;
    setWorkspace({
      ...workspace,
      subtasks: workspace.subtasks.filter((subtask) => subtask.id !== subtaskId),
    });
    const deleteRequest = persist(
      "Subtask delete",
      () => supabase!.from("subtasks").delete().eq("id", subtaskId),
      before,
    );
    let undoUsed = false;
    pushToast({
      title: "Subtask deleted",
      body: subtask.title,
      actionLabel: "Undo",
      onAction: () => {
        if (undoUsed) {
          return;
        }
        undoUsed = true;

        void deleteRequest.then((deleteSaved) => {
          if (!deleteSaved) {
            return;
          }

          const restoreBefore = workspaceRef.current;

          if (!restoreBefore.tasks.some((task) => task.id === subtask.taskId)) {
            pushToast({
              title: "Subtask could not be restored",
              body: "The parent task is no longer available.",
            });
            return;
          }

          setWorkspace((current) => {
            if (
              current.subtasks.some((item) => item.id === subtask.id) ||
              !current.tasks.some((task) => task.id === subtask.taskId)
            ) {
              return current;
            }

            return {
              ...current,
              subtasks: [...current.subtasks, subtask],
            };
          });
          void persist(
            "Undo subtask delete",
            () => supabase!.from("subtasks").insert(subtaskInsertPayload(subtask)),
            restoreBefore,
          );
        });
      },
    });
  }

  function toggleRecurrence(task: StickyTask, enabled: boolean) {
    const before = workspace;

    if (enabled) {
      if ((subtasksByTask.get(task.id) ?? []).length > 0) {
        pushToast({
          title: "Repeating tasks cannot have subtasks",
          body: "This matches Google Tasks behavior and is enforced in the database.",
        });
        return;
      }

      const rule: StickyRecurrenceRule = {
        id: createId(),
        userId: workspace.user.id,
        taskId: task.id,
        frequency: "daily",
        intervalCount: 1,
        daysOfWeek: [],
        monthDay: null,
        startsOn: task.dueDate ?? localDateKey(),
        endType: "never",
        endDate: null,
        occurrenceCount: null,
        timezone: task.timezone,
        paused: false,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };

      setWorkspace({ ...workspace, recurrenceRules: [...workspace.recurrenceRules, rule] });
      void persist(
        "Recurrence",
        () =>
          supabase!.from("task_recurrence_rules").insert({
            id: rule.id,
            user_id: rule.userId,
            task_id: rule.taskId,
            frequency: rule.frequency,
            interval_count: rule.intervalCount,
            days_of_week: rule.daysOfWeek,
            month_day: rule.monthDay,
            starts_on: rule.startsOn,
            end_type: rule.endType,
            end_date: rule.endDate,
            occurrence_count: rule.occurrenceCount,
            timezone: rule.timezone,
            paused: rule.paused,
          }),
        before,
      );
      return;
    }

    setWorkspace({
      ...workspace,
      recurrenceRules: workspace.recurrenceRules.filter((rule) => rule.taskId !== task.id),
    });
    void persist(
      "Recurrence",
      () => supabase!.from("task_recurrence_rules").delete().eq("task_id", task.id),
      before,
    );
  }

  function updateRecurrence(ruleId: string, patch: Partial<StickyRecurrenceRule>) {
    const before = workspace;
    setWorkspace({
      ...workspace,
      recurrenceRules: workspace.recurrenceRules.map((rule) =>
        rule.id === ruleId ? { ...rule, ...patch, updatedAt: nowIso() } : rule,
      ),
    });
    void persist(
      "Recurrence",
      () =>
        supabase!
          .from("task_recurrence_rules")
          .update(recurrenceToDb(patch))
          .eq("id", ruleId),
      before,
    );
  }

  function toggleCompletedPile(listId = activeListId) {
    if (!listId) {
      return;
    }

    updatePreferences({
      completedOpenByList: {
        ...workspace.preferences.completedOpenByList,
        [listId]: !(workspace.preferences.completedOpenByList[listId] ?? false),
      },
    });
  }

  function advanceRecurringCatchUps(targets = recurringCatchUps) {
    if (targets.length === 0) {
      return;
    }

    const before = workspace;
    const timestamp = nowIso();
    const taskTargets = new Map(
      targets.map((item) => [
        item.task.id,
        {
          dueDate: item.target.dueDate,
          skippedCount: item.target.skippedCount,
        },
      ]),
    );
    const ruleTargets = new Map(
      targets.map((item) => [
        item.rule.id,
        {
          occurrenceCount: item.target.occurrenceCount,
        },
      ]),
    );
    const totalSkipped = targets.reduce(
      (count, item) => count + item.target.skippedCount,
      0,
    );

    setWorkspace({
      ...workspace,
      tasks: workspace.tasks.map((task) => {
        const target = taskTargets.get(task.id);

        return target ? { ...task, dueDate: target.dueDate, updatedAt: timestamp } : task;
      }),
      recurrenceRules: workspace.recurrenceRules.map((rule) => {
        const target = ruleTargets.get(rule.id);

        return target
          ? { ...rule, occurrenceCount: target.occurrenceCount, updatedAt: timestamp }
          : rule;
      }),
    });

    void persist(
      "Recurring catch-up",
      () =>
        Promise.all(
          targets.map((item) =>
            supabase!.rpc("advance_recurring_task", {
              p_task_id: item.task.id,
              p_next_due_date: item.target.dueDate,
              p_next_occurrence_count: item.target.occurrenceCount,
            }),
          ),
        ),
      before,
    );
    pushToast({
      title: "Repeats caught up",
      body: `${targets.length} ${plural(targets.length, "task")} advanced across ${totalSkipped} ${plural(totalSkipped, "missed repeat")}.`,
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    const type = active.data.current?.type as "list" | "board-list" | "task" | "subtask" | undefined;

    if (type === "list" || type === "board-list") {
      const activeListKey = String(active.id).replace(/^board:/, "");
      let overListKey = String(over.id).replace(/^board:/, "");
      if (!unarchivedLists.some((list) => list.id === overListKey)) {
        // The drop can resolve to a card inside the target column; walk up to its list.
        const overTask = workspace.tasks.find((task) => task.id === overListKey);
        if (!overTask) {
          return;
        }
        overListKey = overTask.listId;
      }
      const ordered = unarchivedLists.slice().sort(bySortOrder);
      const oldIndex = ordered.findIndex((list) => list.id === activeListKey);
      const newIndex = ordered.findIndex((list) => list.id === overListKey);
      if (oldIndex < 0 || newIndex < 0) {
        return;
      }
      saveListOrder(arrayMove(ordered, oldIndex, newIndex), workspace);
    }

    if (type === "task") {
      if (reorderLocked) {
          pushToast({
            title: "Reorder paused during alternate views",
            body: "Use All and Custom order before changing saved order.",
          });
        return;
      }

      const activeTask = workspace.tasks.find((task) => task.id === active.id);
      const overTask = workspace.tasks.find((task) => task.id === over.id);

      if (!activeTask || !overTask || activeTask.listId !== overTask.listId) {
        return;
      }

      const ordered = workspace.tasks
        .filter((task) => task.listId === activeTask.listId && !task.isCompleted)
        .sort(bySortOrder);
      const oldIndex = ordered.findIndex((task) => task.id === active.id);
      const newIndex = ordered.findIndex((task) => task.id === over.id);
      if (oldIndex < 0 || newIndex < 0) {
        return;
      }
      saveTaskOrder(arrayMove(ordered, oldIndex, newIndex), workspace, activeTask.listId);
    }

    if (type === "subtask" && selectedTask) {
      const ordered = (subtasksByTask.get(selectedTask.id) ?? []).slice().sort(bySortOrder);
      const oldIndex = ordered.findIndex((subtask) => subtask.id === active.id);
      const newIndex = ordered.findIndex((subtask) => subtask.id === over.id);
      if (oldIndex < 0 || newIndex < 0) {
        return;
      }
      saveSubtaskOrder(selectedTask.id, arrayMove(ordered, oldIndex, newIndex), workspace);
    }
  }

  async function signOut() {
    if (mode === "demo") {
      window.localStorage.removeItem(DEMO_STORAGE_KEY);
      window.location.reload();
      return;
    }
    await supabase?.auth.signOut();
    window.location.reload();
  }

  return (
    <MotionConfig reducedMotion="user">
    <main
      className={`sticky-app${
        selectedTask || pulseOpen ? " details-open" : ""
      }${railCollapsed ? " rail-collapsed" : ""}`}
    >
      <DndContext
        id="sticky-workspace-dnd"
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <aside className="list-rail" aria-label="Sticky lists">
          <div className="brand-block">
            <button
              className="rail-menu-button"
              type="button"
              onClick={() => setRailCollapsed((current) => !current)}
              aria-label={railCollapsed ? "Expand list sidebar" : "Collapse list sidebar"}
              aria-expanded={!railCollapsed}
            >
              <Menu size={20} />
            </button>
            <div className="brand-symbol" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <h1>Sticky</h1>
          </div>

          <button
            className="new-list-button"
            type="button"
            onClick={() => openListEditor("new")}
            aria-label="New list"
          >
            <Plus size={20} />
            <span>Create</span>
          </button>

          <nav className="rail-primary-nav" aria-label="Task shortcuts">
            <button
              type="button"
              className={taskViewFilter === "all" ? "active" : ""}
              onClick={() => {
                setTaskViewFilter("all");
                setSearchQuery("");
              }}
              aria-label={`Show all tasks, ${totalActiveTasks} active tasks`}
            >
              <Check size={16} />
              <span>All tasks</span>
              <AnimatedNumber value={totalActiveTasks} className="rail-count" />
            </button>
          </nav>

          <div className="rail-section-heading">
            <span>Lists</span>
            <button type="button" onClick={() => openListEditor("new")} aria-label="Add list">
              <Plus size={16} />
            </button>
          </div>

          <SortableContext
            items={unarchivedLists.map((list) => list.id)}
            strategy={horizontalListSortingStrategy}
          >
            <nav className="list-stack">
              {unarchivedLists
                .map((list, index, orderedLists) => (
                  <SortableListItem
                    key={list.id}
                    list={list}
                    active={list.id === activeListId}
                    stats={listStats.get(list.id) ?? { active: 0, completed: 0 }}
                    searchQuery={searchQuery}
                    canMoveUp={index > 0}
                    canMoveDown={index < orderedLists.length - 1}
                    onToggleBoardVisibility={() => toggleListBoardVisibility(list)}
                    onSelect={() => switchList(list.id)}
                    onRename={() => openListEditor(list)}
                    onArchive={() => archiveList(list)}
                    onMoveUp={() => moveListInOrder(list.id, -1)}
                    onMoveDown={() => moveListInOrder(list.id, 1)}
                    onDelete={() => requestDeleteList(list)}
                  />
                ))}
            </nav>
          </SortableContext>

          {archivedLists.length ? (
            <>
              <div className="rail-section-heading archived-heading">
                <span>Archived</span>
                <strong>{archivedLists.length}</strong>
              </div>
              <nav className="archived-list-stack" aria-label="Archived lists">
                {archivedLists.map((list) => (
                  <ArchivedListItem
                    key={list.id}
                    list={list}
                    stats={listStats.get(list.id) ?? { active: 0, completed: 0 }}
                    searchQuery={searchQuery}
                    onRestore={() => restoreArchivedList(list.id)}
                    onDelete={() => requestDeleteList(list)}
                  />
                ))}
              </nav>
            </>
          ) : null}

          <button className="rail-add-list-button" type="button" onClick={() => openListEditor("new")} aria-label="Add list">
            <Plus size={18} />
            Add list
          </button>

        </aside>

        <section className="task-stage" aria-label="Sticky workspace">
          {systemMessage ? (
            <div className="system-banner">
              <Sparkles size={16} />
              {systemMessage}
            </div>
          ) : null}
          {saveState.error ? (
            <div className="sync-banner" role="alert">
              <TriangleAlert size={17} />
              <div>
                <strong>Last save did not stick</strong>
                <span>{saveState.error}</span>
              </div>
              <button
                type="button"
                onClick={() =>
                  setSaveState((current) => ({
                    ...current,
                    error: null,
                  }))
                }
              >
                Dismiss
              </button>
            </div>
          ) : null}

          <header className="workspace-topbar">
            <div className="workspace-title">
              <p className="eyebrow">Workspace</p>
              <h2>{viewMode === "calendar" ? "Calendar" : "All tasks"}</h2>
              <div className="metric-strip">
                <span><AnimatedNumber value={totalActiveTasks} /> active</span>
                <span><AnimatedNumber value={totalCompletedTasks} /> completed</span>
                <span><AnimatedNumber value={totalOpenSubtasks} /> open subtasks</span>
                <span className={`save-status ${currentSaveStatus.tone}`} aria-live="polite">
                  <span className="save-status-label">{currentSaveStatus.label}</span>
                  <span className="save-status-short">{currentSaveStatus.shortLabel}</span>
                </span>
              </div>
            </div>

            <div className={`workspace-tools${searchExpanded ? " search-expanded" : ""}`}>
              <div
                className={`search-control workspace-find-control${searchExpanded ? " expanded" : ""}`}
                onFocusCapture={() => setSearchFocused(true)}
                onBlurCapture={(event) => {
                  if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
                    setSearchFocused(false);
                  }
                }}
              >
                <button
                  className="workspace-find-trigger"
                  type="button"
                  aria-label="Open workspace search"
                  onClick={() => setSearchFocused(true)}
                >
                  <Search size={17} />
                </button>
                <input
                  ref={searchInputRef}
                  value={workspace.userState.searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      if (workspace.userState.searchQuery) {
                        setSearchQuery("");
                      } else {
                        event.currentTarget.blur();
                      }
                    }
                  }}
                  type="search"
                  placeholder="Find in workspace"
                  aria-label="Find in workspace"
                />
                {searchExpanded && workspace.userState.searchQuery ? (
                  <button
                    className="workspace-find-clear"
                    type="button"
                    aria-label="Clear workspace search"
                    onClick={() => {
                      setSearchQuery("");
                      searchInputRef.current?.focus();
                    }}
                  >
                    <X size={14} />
                  </button>
                ) : null}
                {searchExpanded && searchQuery ? (
                  <span
                    className={`search-match-count${searchQuery && !searchMatchCount ? " empty" : ""}`}
                    aria-live="polite"
                  >
                    {searchSummary}
                  </span>
                ) : null}
              </div>
              <button
                ref={commandTriggerRef}
                className="command-trigger command-trigger-hidden"
                type="button"
                onClick={() => setCommandOpen(true)}
                aria-label="Open command center"
                aria-haspopup="dialog"
                aria-expanded={commandOpen}
                aria-controls="sticky-command-dialog"
              >
                <CommandIcon size={16} />
                Command
              </button>
              <button
                className={`tool-button ${overviewOpen ? "active" : ""}`}
                type="button"
                aria-label="Open command deck overview"
                aria-pressed={overviewOpen}
                onClick={() => setOverviewOpen(true)}
              >
                <Monitor size={17} />
              </button>
              <button
                className={`tool-button ${viewMode === "calendar" ? "active" : ""}`}
                type="button"
                aria-label={viewMode === "calendar" ? "Show board view" : "Show calendar view"}
                aria-pressed={viewMode === "calendar"}
                onClick={() => setViewMode(viewMode === "calendar" ? "board" : "calendar")}
              >
                <CalendarDays size={17} />
              </button>
              <button
                className={`tool-button ${pulseOpen && !selectedTask ? "active" : ""}`}
                type="button"
                aria-label={pulseOpen ? "Close workspace pulse" : "Open workspace pulse"}
                aria-pressed={pulseOpen}
                onClick={() => {
                  if (pulseOpen && !selectedTask) {
                    setPulseOpen(false);
                    return;
                  }
                  setSelectedTaskId(null);
                  setPulseOpen(true);
                }}
              >
                <Sparkles size={17} />
              </button>
              <button
                className="tool-button"
                type="button"
                aria-label="Open notifications"
                onClick={() => setConnectionsOpen(true)}
              >
                <Bell size={17} />
              </button>
              <details className="appearance-menu profile-appearance-menu">
                <summary
                  className="appearance-trigger profile-chip profile-appearance-trigger"
                  aria-label="Open appearance settings"
                >
                  <Settings2 className="profile-settings-icon" size={17} aria-hidden="true" />
                </summary>
                <div className="preference-controls" aria-label="Workspace appearance">
                  <div className="profile-card">
                    <span className="profile-card-avatar" aria-hidden="true">
                      {(workspace.user.displayName || workspace.user.email || "AR").slice(0, 2).toUpperCase()}
                      <i className="profile-card-status" />
                    </span>
                    <div className="profile-card-identity">
                      <strong title={workspace.user.email}>
                        {workspace.user.displayName || workspace.user.email}
                      </strong>
                      <span>{workspace.user.email}</span>
                      <small>Operator online</small>
                    </div>
                  </div>
                  <div className="appearance-group">
                    <span className="appearance-group-label">Accent</span>
                    <AccentWheel hue={accentHue} onChange={setAccentHue} />
                  </div>
                  <div className="preference-actions">
                    <button className="preference-connections-button" type="button" onClick={() => setConnectionsOpen(true)}>
                      <PlugZap size={16} aria-hidden="true" />
                      Connections
                    </button>
                    <button className="preference-signout-button" type="button" onClick={signOut}>
                      <LogOut size={16} aria-hidden="true" />
                      Sign out
                    </button>
                  </div>
                </div>
              </details>
            </div>
          </header>

          {viewMode === "board" ? <>
          <div className="task-filter-bar" aria-label="Task views">
            {TASK_VIEW_ORDER.map((filter) => {
              const active = taskViewFilter === filter;
              const count = taskFilterCounts[filter];

              return (
                <button
                  key={filter}
                  type="button"
                  className={active ? "active" : ""}
                  aria-pressed={active}
                  aria-label={taskViewButtonLabel(TASK_VIEW_LABELS[filter], count, active)}
                  onClick={() => setTaskViewFilter(filter)}
                >
                  {active ? (
                    <motion.span
                      className="filter-active-pill"
                      layoutId="filter-active-pill"
                      transition={springs.snappy}
                      aria-hidden="true"
                    />
                  ) : null}
                  {filter === "all" ? <Layers3 size={15} /> : null}
                  {filter === "today" ? <Sun size={15} /> : null}
                  {filter === "due" ? <CalendarDays size={15} /> : null}
                  {filter === "overdue" ? <TriangleAlert size={15} /> : null}
                  {filter === "recurring" ? <Repeat2 size={15} /> : null}
                  {filter === "subtasks" ? <ListChecks size={15} /> : null}
                  <span>{TASK_VIEW_LABELS[filter]}</span>
                  <strong>{count}</strong>
                </button>
              );
            })}
          </div>

          <div className="task-sort-row">
            <div className="segmented-control task-sort-control" aria-label="Task sort order">
              <button
                type="button"
                className={taskSortMode === "custom" ? "active" : ""}
                onClick={() => setTaskSortMode("custom")}
                aria-pressed={taskSortMode === "custom"}
                aria-label={taskSortButtonLabel("custom", taskSortMode === "custom")}
              >
                <Rows3 size={15} />
                {TASK_SORT_LABELS.custom}
              </button>
              <button
                type="button"
                className={taskSortMode === "due" ? "active" : ""}
                onClick={() => setTaskSortMode("due")}
                aria-pressed={taskSortMode === "due"}
                aria-label={taskSortButtonLabel("due", taskSortMode === "due")}
              >
                <CalendarDays size={15} />
                {TASK_SORT_LABELS.due}
              </button>
            </div>
            <span>{taskSortMode === "due" ? "Earliest scheduled tasks first" : "My order"}</span>
          </div>

          {reorderLocked ? (
            <div className="filter-banner">
              <Search size={15} />
              Reordering is locked while filters or due-date sorting are active, so custom order stays intact.
            </div>
          ) : null}

          {recurringCatchUps.length ? (
            <div className="recurrence-catchup-banner">
              <div>
                <Repeat2 size={16} />
                <span>
                  {recurringCatchUps.length} repeating{" "}
                  {plural(recurringCatchUps.length, "task")} behind schedule
                </span>
              </div>
              <button type="button" onClick={() => advanceRecurringCatchUps()}>
                Advance repeats
              </button>
            </div>
          ) : null}
          </> : null}

          {viewMode === "calendar" ? (
            <StickyCalendar
              mode={mode}
              tasks={calendarTasks}
              lists={unarchivedLists}
              onTaskSelect={(taskId) => {
                setSelectedTaskId(taskId);
              }}
            />
          ) : (
            <section
              className="board-scroll"
              aria-label="Active tasks"
              {...boardPan}
              onClick={(event) => {
                if (event.target !== event.currentTarget) {
                  return;
                }
                updateUserState({ selectedListId: null });
                setSelectedTaskId(null);
              }}
            >
              {boardColumns.length ? (
                <SortableContext
                  items={boardColumns.map((column) => `board:${column.list.id}`)}
                  strategy={horizontalListSortingStrategy}
                >
                {boardColumns.map((column, index) => (
                  <StickyBoardColumn
                    key={column.list.id}
                    column={column}
                    columnIndex={index}
                    active={column.list.id === activeListId}
                    renderImmediately={
                      Boolean(searchQuery) || column.list.id === activeListId || index < 3
                    }
                    quickTitle={quickTitle}
                    quickCaptureIntent={quickCaptureIntent}
                    quickInputRef={quickInputRef}
                    captureDraft={captureDraft}
                    captureExpanded={captureExpanded}
                    onCaptureDraftChange={setCaptureDraft}
                    onCaptureExpandedChange={setCaptureExpanded}
                    searchQuery={searchQuery}
                    taskViewFiltered={taskViewFiltered}
                    taskViewFilter={taskViewFilter}
                    reorderLocked={reorderLocked}
                    selectedTaskId={selectedTaskId}
                    subtasksByTask={subtasksByTask}
                    recurrenceByTask={recurrenceByTask}
                    onActivate={() => switchList(column.list.id)}
                    onActivateQuickAdd={() => {
                      if (selectedTaskId) {
                        quickCaptureClosedDetailsRef.current = true;
                      }
                      switchList(column.list.id);
                      window.setTimeout(() => quickInputRef.current?.focus(), 0);
                    }}
                    onPrepareQuickAdd={() => {
                      if (selectedTaskId) {
                        quickCaptureClosedDetailsRef.current = true;
                      }
                      setSelectedTaskId(null);
                    }}
                    onQuickTitleChange={setQuickTitle}
                    onSubmitQuickTask={createTask}
                    onRenameList={() => openListEditor(column.list)}
                    onDeleteList={() => requestDeleteList(column.list)}
                    onOpenTask={(task) => openTaskInContext(task.id)}
                    onCompleteTask={completeTask}
                    onDeleteTask={requestDeleteTask}
                    onMoveTask={moveTaskInOrder}
                    onToggleCompleted={() => toggleCompletedPile(column.list.id)}
                    onRestoreTask={restoreTask}
                    onClearCompleted={requestClearCompleted}
                  />
                ))}
                </SortableContext>
              ) : (
                <div className="board-empty-state" role="status">
                  <Layers3 size={24} />
                  <strong>No lists shown</strong>
                  <span>Check a list in the sidebar to put it back on the All tasks board.</span>
                </div>
              )}
            </section>
          )}
        </section>

        <TaskDetailsPanel
          task={selectedTask}
          lists={unarchivedLists}
          subtasks={selectedTaskSubtasks}
          recurrenceRule={selectedTaskRecurrence}
          catchUpTarget={selectedTaskCatchUp}
          pulse={workspacePulse}
          onClose={() => {
            setSelectedTaskId(null);
            setPulseOpen(false);
          }}
          onOpenTask={openTaskInContext}
          onSavePatch={(patch) => selectedTask && updateTask(selectedTask.id, patch)}
          onMove={(listId) => selectedTask && moveTask(selectedTask, listId)}
          onDuplicate={() => selectedTask && duplicateTask(selectedTask)}
          onDelete={() => selectedTask && requestDeleteTask(selectedTask)}
          onComplete={() => selectedTask && completeTask(selectedTask)}
          onRestore={() => selectedTask && restoreTask(selectedTask.id)}
          onAddSubtask={(title) => selectedTask && addSubtask(selectedTask, title)}
          onUpdateSubtask={updateSubtask}
          onMoveSubtask={(subtaskId, direction) =>
            selectedTask && moveSubtaskInOrder(selectedTask.id, subtaskId, direction)
          }
          onDeleteSubtask={deleteSubtask}
          onToggleRecurrence={(enabled) => selectedTask && toggleRecurrence(selectedTask, enabled)}
          onUpdateRecurrence={updateRecurrence}
          onAdvanceRecurrence={() => {
            if (!selectedTask) {
              return;
            }

            const target = recurringCatchUps.find((item) => item.task.id === selectedTask.id);

            if (target) {
              advanceRecurringCatchUps([target]);
            }
          }}
        />

        {listEditor ? (
          <ListEditorDialog
            list={listEditor}
            onClose={closeListEditor}
            onSave={saveList}
          />
        ) : null}

        {confirmRequest ? (
          <ConfirmDialog
            request={confirmRequest}
            onCancel={cancelConfirmDialog}
          />
        ) : null}

        {commandOpen ? (
          <CommandCenter
            items={visibleCommandItems}
            query={commandQuery}
            selectedIndex={selectedCommandIndex}
            inputRef={commandInputRef}
            onQueryChange={(nextQuery) => {
              setCommandQuery(nextQuery);
              setCommandIndex(0);
            }}
            onSelectIndex={setCommandIndex}
            onRun={runCommand}
            onClose={() => closeCommandCenter(true)}
          />
        ) : null}

        <AnimatePresence>
          {overviewOpen ? (
            <StickyOverview
              lists={unarchivedLists}
              tasks={workspace.tasks}
              subtasks={workspace.subtasks}
              recurrenceByTask={recurrenceByTask}
              onClose={() => setOverviewOpen(false)}
              onOpenTask={(taskId) => {
                setOverviewOpen(false);
                openTaskInContext(taskId);
              }}
              onSelectList={(listId) => {
                setOverviewOpen(false);
                setViewMode("board");
                switchList(listId);
              }}
              onShowFilter={(filter) => {
                setOverviewOpen(false);
                setViewMode("board");
                setTaskViewFilter(filter);
              }}
              onOpenCalendar={() => {
                setOverviewOpen(false);
                setViewMode("calendar");
              }}
            />
          ) : null}
        </AnimatePresence>

        <StickyConnections open={connectionsOpen} onClose={() => setConnectionsOpen(false)} />

        <ToastStack toasts={toasts} onDismiss={(id) => setToasts((items) => items.filter((item) => item.id !== id))} />
      </DndContext>
    </main>
    </MotionConfig>
  );
}

function StickyBoardColumn({
  column,
  columnIndex,
  active,
  renderImmediately,
  quickTitle,
  quickCaptureIntent,
  quickInputRef,
  captureDraft,
  captureExpanded,
  onCaptureDraftChange,
  onCaptureExpandedChange,
  searchQuery,
  taskViewFiltered,
  taskViewFilter,
  reorderLocked,
  selectedTaskId,
  subtasksByTask,
  recurrenceByTask,
  onActivate,
  onActivateQuickAdd,
  onPrepareQuickAdd,
  onQuickTitleChange,
  onSubmitQuickTask,
  onRenameList,
  onDeleteList,
  onOpenTask,
  onCompleteTask,
  onDeleteTask,
  onMoveTask,
  onToggleCompleted,
  onRestoreTask,
  onClearCompleted,
}: {
  column: BoardColumn;
  columnIndex: number;
  active: boolean;
  renderImmediately: boolean;
  quickTitle: string;
  quickCaptureIntent: QuickCaptureIntent;
  quickInputRef: React.RefObject<HTMLInputElement | null>;
  captureDraft: QuickCaptureDraft;
  captureExpanded: boolean;
  onCaptureDraftChange: (draft: QuickCaptureDraft) => void;
  onCaptureExpandedChange: (expanded: boolean) => void;
  searchQuery: string;
  taskViewFiltered: boolean;
  taskViewFilter: StickyTaskViewFilter;
  reorderLocked: boolean;
  selectedTaskId: string | null;
  subtasksByTask: Map<string, StickySubtask[]>;
  recurrenceByTask: Map<string, StickyRecurrenceRule>;
  onActivate: () => void;
  onActivateQuickAdd: () => void;
  onPrepareQuickAdd: () => void;
  onQuickTitleChange: (title: string) => void;
  onSubmitQuickTask: (event: React.FormEvent<HTMLFormElement>) => void;
  onRenameList: () => void;
  onDeleteList: () => void;
  onOpenTask: (task: StickyTask) => void;
  onCompleteTask: (task: StickyTask) => void;
  onDeleteTask: (task: StickyTask) => void;
  onMoveTask: (taskId: string, direction: -1 | 1) => void;
  onToggleCompleted: () => void;
  onRestoreTask: (taskId: string) => void;
  onClearCompleted: () => void;
}) {
  const columnRef = useRef<HTMLElement | null>(null);
  const [nearViewport, setNearViewport] = useState(renderImmediately);
  const { list, activeTasks, visibleTasks, completedTasks, completedOpen } = column;
  const contentReady = renderImmediately || nearViewport;
  const completedListId = active ? "completed-stickies-list" : `completed-tasks-${list.id}`;
  const plateGroups = list.name.toLowerCase() === "plate" ? getPlateTaskGroups(visibleTasks) : [];
  const shouldShowPlateGroups = plateGroups.length > 0 && !taskViewFiltered;
  const paperDepth = (columnIndex % 3) + 1;
  const emptyTitle = taskViewFiltered ? `No ${TASK_VIEW_LABELS[taskViewFilter].toLowerCase()} tasks` : "No tasks yet";
  const emptyBody = taskViewFiltered ? "Switch back to All to see this saved order." : "Add a task to start this list.";
  const sortable = useSortable({ id: `board:${list.id}`, data: { type: "board-list" } });

  useEffect(() => {
    if (renderImmediately) {
      setNearViewport(true);
      return;
    }

    const node = columnRef.current;

    if (!node || typeof IntersectionObserver === "undefined") {
      setNearViewport(true);
      return;
    }

    const root = node.closest<HTMLElement>(".board-scroll");
    const observer = new IntersectionObserver(
      ([entry]) => setNearViewport(entry?.isIntersecting ?? false),
      {
        root,
        rootMargin: "0px 420px",
        threshold: 0.01,
      },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [renderImmediately]);

  return (
    <section
      ref={(node) => {
        columnRef.current = node;
        sortable.setNodeRef(node);
      }}
      className={`board-column color-${list.color} paper-depth-${paperDepth}${active ? " active" : ""}${
        sortable.isDragging ? " dragging-column" : ""
      }`}
      aria-label={`List ${list.name}`}
      data-list-id={list.id}
      data-list-slug={listSlug(list.name)}
      data-paper-depth={paperDepth}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
        ["--col-delay" as string]: `${Math.min(columnIndex * 55, 500)}ms`,
      }}
      onPointerMove={(event) => {
        const node = columnRef.current;
        if (!node) return;
        const rect = node.getBoundingClientRect();
        node.style.setProperty("--mx", `${event.clientX - rect.left}px`);
        node.style.setProperty("--my", `${event.clientY - rect.top}px`);
      }}
    >
      <span className="column-paper-stack" aria-hidden="true" />
      <motion.span
        className="column-pin"
        aria-hidden="true"
        initial={{ y: -16, opacity: 0, scale: 1.25 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={{ ...springs.bouncy, delay: Math.min(columnIndex * 0.055, 0.5) + 0.16 }}
      />
      {list.color === "violet" ? <span className="column-paperclip" aria-hidden="true" /> : null}

      <header
        className="column-header"
        {...sortable.attributes}
        {...sortable.listeners}
        aria-label={`Reorder list ${list.name}`}
      >
        <button className="column-title-button" type="button" onClick={onActivate}>
          <h2>
            <HighlightText text={list.name} query={searchQuery} />
          </h2>
          <span>
            {activeTasks.length} active / {completedTasks.length} done
          </span>
        </button>
        <div className="column-header-actions">
          <button
            className="column-menu"
            type="button"
            onClick={onRenameList}
            aria-label={active ? `Rename current list ${list.name}` : `Rename list ${list.name}`}
          >
            <span className="column-menu-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </button>
          <button
            className="sr-only"
            type="button"
            onClick={onDeleteList}
            aria-label={`Delete ${list.name}`}
          >
            Delete list
          </button>
        </div>
      </header>

      {active ? (
        <form
          className={`quick-capture board-quick-capture${captureExpanded ? " expanded" : ""}`}
          onSubmit={onSubmitQuickTask}
        >
          <div className="capture-main">
            <div className="capture-icon">
              <Plus size={17} />
            </div>
            <input
              ref={quickInputRef}
              value={quickTitle}
              onChange={(event) => onQuickTitleChange(event.target.value)}
              onFocus={() => {
                onPrepareQuickAdd();
                onCaptureExpandedChange(true);
              }}
              placeholder="Add a task"
              aria-label="Quick add task"
            />
            <button
              type="submit"
              disabled={!quickCaptureIntent.title.trim()}
              aria-label={`Add task to ${quickCaptureIntent.listName ?? list.name}`}
            >
              Add
            </button>
          </div>
          <AnimatePresence initial={false}>
            {captureExpanded ? (
              <motion.div
                className="capture-composer"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ type: "spring", stiffness: 420, damping: 38 }}
              >
                <textarea
                  value={captureDraft.details}
                  onChange={(event) => onCaptureDraftChange({ ...captureDraft, details: event.target.value })}
                  placeholder="Details"
                  rows={2}
                  aria-label="New task details"
                />
                <div className="capture-composer-row">
                  <CaptureScheduler
                    schedule={{
                      dueDate: captureDraft.dueDate,
                      dueTime: captureDraft.dueTime,
                      repeat: captureDraft.repeat,
                    }}
                    onChange={(next) => onCaptureDraftChange({ ...captureDraft, ...next })}
                  />
                  <button
                    type="button"
                    className="capture-collapse"
                    onClick={() => onCaptureExpandedChange(false)}
                    aria-label="Collapse task composer"
                  >
                    <ChevronUp size={15} />
                  </button>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
          <AnimatePresence>
            {quickCaptureIntent.dueDate || quickCaptureIntent.dueTime || quickCaptureIntent.listName ? (
              <motion.div
                className="quick-schedule-preview"
                aria-live="polite"
                initial={{ opacity: 0, y: -6, scale: 0.94 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.94 }}
                transition={springs.snappy}
              >
                {quickCaptureIntent.dueDate || quickCaptureIntent.dueTime ? (
                  <CalendarDays size={14} />
                ) : (
                  <Layers3 size={14} />
                )}
                {quickCaptureIntent.listName ? <span>{quickCaptureIntent.listName}</span> : null}
                {quickCaptureIntent.dateLabel ? <span>{quickCaptureIntent.dateLabel}</span> : null}
                {quickCaptureIntent.timeLabel ? <span>{quickCaptureIntent.timeLabel}</span> : null}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </form>
      ) : (
        <button className="board-add-task" type="button" onClick={onActivateQuickAdd}>
          <span>
            <Plus size={17} />
          </span>
          Add a task
        </button>
      )}

      <div className="task-lane">
        {!contentReady && visibleTasks.length ? (
          <button
            className="deferred-task-loader"
            type="button"
            onClick={() => setNearViewport(true)}
            aria-label={`Load ${visibleTasks.length} ${plural(visibleTasks.length, "task")} in ${list.name}`}
          >
            <Layers3 size={15} aria-hidden="true" />
            <span>{visibleTasks.length} {plural(visibleTasks.length, "task")}</span>
          </button>
        ) : shouldShowPlateGroups ? (
            <PlateTaskGroups
              groups={plateGroups}
              searchQuery={searchQuery}
              selectedTaskId={selectedTaskId}
              onOpenTask={onOpenTask}
              onCompleteTask={onCompleteTask}
          />
        ) : visibleTasks.length ? (
          <SortableContext
            items={visibleTasks.map((task) => task.id)}
            strategy={verticalListSortingStrategy}
          >
            <AnimatePresence initial={false}>
              {visibleTasks.map((task) => {
                const orderIndex = activeTasks.findIndex((item) => item.id === task.id);

                return (
                  <SortableTaskCard
                    key={task.id}
                    task={task}
                    active={task.id === selectedTaskId}
                    subtasks={subtasksByTask.get(task.id) ?? []}
                    recurrenceRule={recurrenceByTask.get(task.id) ?? null}
                    dueLabel={humanDue(task)}
                    searchQuery={searchQuery}
                    reorderDisabled={reorderLocked}
                    canMoveUp={!reorderLocked && orderIndex > 0}
                    canMoveDown={!reorderLocked && orderIndex >= 0 && orderIndex < activeTasks.length - 1}
                    onOpen={() => onOpenTask(task)}
                    onComplete={() => onCompleteTask(task)}
                    onDelete={() => onDeleteTask(task)}
                    onMoveUp={() => onMoveTask(task.id, -1)}
                    onMoveDown={() => onMoveTask(task.id, 1)}
                  />
                );
              })}
            </AnimatePresence>
          </SortableContext>
        ) : active ? (
          <EmptyState title={emptyTitle} body={emptyBody} />
        ) : null}
      </div>

      <section
        className="completed-pile"
        aria-label={active ? "Completed tasks" : `${list.name} completed tasks`}
      >
        <button
          className="completed-toggle"
          type="button"
          onClick={() => {
            setNearViewport(true);
            onToggleCompleted();
          }}
          aria-expanded={completedOpen}
          aria-controls={completedListId}
        >
          <motion.span
            className="completed-chevron"
            aria-hidden="true"
            initial={false}
            animate={{ rotate: completedOpen ? 90 : 0 }}
            transition={springs.snappy}
          >
            <ChevronRight size={17} />
          </motion.span>
          <span>Completed</span>
          <AnimatedNumber value={completedTasks.length} className="completed-count" />
        </button>

        <AnimatePresence initial={false}>
          {completedOpen && contentReady ? (
            <motion.div
              id={completedListId}
              className="completed-list"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 380, damping: 38 }}
            >
              {completedTasks.map((task) => (
                <CompletedTaskRow
                  key={task.id}
                  task={task}
                  searchQuery={searchQuery}
                  onRestore={() => onRestoreTask(task.id)}
                  onOpen={() => onOpenTask(task)}
                  onDelete={() => onDeleteTask(task)}
                />
              ))}
              {active && completedTasks.length ? (
                <button className="clear-completed" type="button" onClick={onClearCompleted}>
                  <Archive size={15} />
                  Clear completed
                </button>
              ) : null}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </section>
    </section>
  );
}

function PlateTaskGroups({
  groups,
  searchQuery,
  selectedTaskId,
  onOpenTask,
  onCompleteTask,
}: {
  groups: PlateTaskGroup[];
  searchQuery: string;
  selectedTaskId: string | null;
  onOpenTask: (task: StickyTask) => void;
  onCompleteTask: (task: StickyTask) => void;
}) {
  return (
    <div className="plate-groups" role="list">
      {groups.map((group) => {
        const visibleLimit = PLATE_VISIBLE_LIMITS[group.name] ?? group.tasks.length;
        const visibleTasks = group.tasks.slice(0, visibleLimit);
        const collapsed = visibleLimit === 0;

        return (
          <section
            key={group.name}
            className={`plate-group color-${group.color}${collapsed ? " collapsed" : ""}`}
            data-paper-variant={visualVariant(group.name, 3)}
            role="listitem"
            >
              <header className="plate-group-title">
                {collapsed ? <ChevronRight size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
                <span>
                  <HighlightText text={group.name} query={searchQuery} />
                </span>
              </header>
            {visibleTasks.length ? (
              <div className="plate-group-tasks">
                {visibleTasks.map((task) => (
                  <article
                    key={task.id}
                    className={`plate-task-row color-${task.color}${task.id === selectedTaskId ? " selected" : ""}`}
                    data-task-id={task.id}
                    data-paper-variant={visualVariant(task.id, 3)}
                  >
                    <button
                      className="task-check"
                      type="button"
                      onClick={() => onCompleteTask(task)}
                      aria-label={`Complete ${task.title}`}
                    >
                      <Check size={16} />
                    </button>
                    <button className="plate-task-title" type="button" onClick={() => onOpenTask(task)}>
                      <HighlightText text={task.title} query={searchQuery} />
                    </button>
                  </article>
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function SortableListItem({
  list,
  active,
  stats,
  searchQuery,
  canMoveUp,
  canMoveDown,
  onToggleBoardVisibility,
  onSelect,
  onRename,
  onArchive,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  list: StickyList;
  active: boolean;
  stats: { active: number; completed: number };
  searchQuery: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onToggleBoardVisibility: () => void;
  onSelect: () => void;
  onRename: () => void;
  onArchive: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}) {
  const sortable = useSortable({ id: list.id, data: { type: "list" } });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };
  const listTabLabel = [
    `Open list ${list.name}`,
    `${stats.active} active ${plural(stats.active, "task")}`,
    `${stats.completed} completed ${plural(stats.completed, "task")}`,
    list.isVisibleOnBoard ? "shown on All tasks" : "hidden from All tasks",
    active ? "current list" : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div ref={sortable.setNodeRef} style={style} className={`list-tab-wrap ${sortable.isDragging ? "dragging" : ""}`}>
      <div className={`list-tab-row color-${list.color}`}>
        <label
          className="list-board-toggle"
          title={list.isVisibleOnBoard ? "Shown on All tasks" : "Hidden from All tasks"}
        >
          <input
            type="checkbox"
            checked={list.isVisibleOnBoard}
            onChange={onToggleBoardVisibility}
            aria-label={
              list.isVisibleOnBoard
                ? `Hide ${list.name} from All tasks`
                : `Show ${list.name} on All tasks`
            }
          />
          <span aria-hidden="true" />
        </label>
        <button
          className={`list-tab color-${list.color}${active ? " active" : ""}${
            list.isVisibleOnBoard ? "" : " hidden-on-board"
          }`}
          type="button"
          onClick={onSelect}
          aria-label={listTabLabel}
        >
          {active ? (
            <motion.span
              className="list-tab-active-glow"
              layoutId="list-tab-active-glow"
              transition={springs.snappy}
              aria-hidden="true"
            />
          ) : null}
          <span
            className="drag-handle"
            {...sortable.attributes}
            {...sortable.listeners}
            aria-label={`Drag list named ${list.name}`}
          >
            <GripVertical size={15} />
          </span>
          <span className="list-tab-dot" aria-hidden="true" />
          <span className="list-tab-name">
            <HighlightText text={list.name} query={searchQuery} />
          </span>
          <span className="list-tab-counts">
            {stats.active}<small>{stats.completed}</small>
          </span>
        </button>
      </div>
      <div className="list-tab-actions">
        <button
          type="button"
          onClick={onMoveUp}
          disabled={!canMoveUp}
          aria-label={`Move list named ${list.name} up`}
        >
          <ChevronUp size={14} />
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={!canMoveDown}
          aria-label={`Move list named ${list.name} down`}
        >
          <ChevronDown size={14} />
        </button>
        <button type="button" onClick={onRename} aria-label={`Rename ${list.name}`}>
          <Pencil size={14} />
        </button>
        <button type="button" onClick={onArchive} aria-label={`Archive ${list.name}`}>
          <Archive size={14} />
        </button>
        <button type="button" onClick={onDelete} aria-label={`Delete ${list.name}`}>
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

function ArchivedListItem({
  list,
  stats,
  searchQuery,
  onRestore,
  onDelete,
}: {
  list: StickyList;
  stats: { active: number; completed: number };
  searchQuery: string;
  onRestore: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`archived-list-item color-${list.color}`}>
      <Archive size={15} aria-hidden="true" />
      <span className="archived-list-name">
        <HighlightText text={list.name} query={searchQuery} />
      </span>
      <span className="archived-list-counts">
        {stats.active}<small>{stats.completed}</small>
      </span>
      <button type="button" onClick={onRestore} aria-label={`Restore archived list ${list.name}`}>
        <Undo2 size={14} />
      </button>
      <button type="button" onClick={onDelete} aria-label={`Delete archived list ${list.name}`}>
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function SortableTaskCard({
  task,
  active,
  subtasks,
  recurrenceRule,
  dueLabel,
  searchQuery,
  reorderDisabled,
  canMoveUp,
  canMoveDown,
  onOpen,
  onComplete,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  task: StickyTask;
  active: boolean;
  subtasks: StickySubtask[];
  recurrenceRule: StickyRecurrenceRule | null;
  dueLabel: string | null;
  searchQuery: string;
  reorderDisabled: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onOpen: () => void;
  onComplete: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const sortable = useSortable({
    id: task.id,
    data: { type: "task" },
    disabled: reorderDisabled,
  });
  const reduceMotion = useReducedMotion();
  const [completing, setCompleting] = useState(false);
  const completeTimerRef = useRef<number | null>(null);
  const openSubtasks = subtasks.filter((subtask) => !subtask.isCompleted).length;
  const recurrenceLabel = recurrenceRule
    ? recurrenceRule.paused
      ? "Repeat paused"
      : recurrenceCadence(recurrenceRule)
    : null;
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };

  useEffect(() => {
    return () => {
      if (completeTimerRef.current) {
        window.clearTimeout(completeTimerRef.current);
      }
    };
  }, []);

  function handleComplete() {
    if (completing) {
      return;
    }

    if (reduceMotion) {
      onComplete();
      return;
    }

    setCompleting(true);
    completeTimerRef.current = window.setTimeout(onComplete, 520);
  }

  return (
    <motion.article
      ref={sortable.setNodeRef}
      layout
      initial={{ opacity: 0, y: 14, scale: 0.97 }}
      animate={
        completing
          ? { opacity: 1, y: 0, scale: 0.98, rotate: -1.1 }
          : { opacity: 1, y: 0, scale: 1, rotate: 0 }
      }
      exit={
        completing
          ? { opacity: 0, y: 44, scale: 0.86, rotate: 2.2, transition: { duration: 0.3, ease: [0.5, 0, 0.75, 0.4] } }
          : { opacity: 0, x: -22, scale: 0.96 }
      }
      transition={springs.paper}
      style={style}
      data-task-id={task.id}
      data-paper-variant={visualVariant(task.id, 3)}
      data-tape-variant={visualVariant(`${task.id}:tape`, 3)}
      className={`task-card color-${task.color}${active ? " selected" : ""}${sortable.isDragging ? " dragging" : ""}${completing ? " completing" : ""}`}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button")) {
          return;
        }
        onOpen();
      }}
    >
      <span className="task-card-tape" aria-hidden="true" />
      <button
        className="task-check"
        type="button"
        onClick={handleComplete}
        aria-label={`Complete ${task.title}`}
      >
        <Check size={15} className="task-check-hint" aria-hidden="true" />
        <DrawnCheck checked={completing} size={16} />
        {completing ? <ConfettiBurst /> : null}
      </button>
      <button className="task-body-button" type="button" onClick={onOpen}>
        <span className="task-title">
          <HighlightText text={task.title} query={searchQuery} />
        </span>
        {task.details ? (
          <span className="task-details">
            <HighlightText text={task.details} query={searchQuery} />
          </span>
        ) : null}
        {dueLabel || openSubtasks || recurrenceLabel ? (
          <span className="task-meta-row">
            {dueLabel ? (
              <span className={task.dueDate && task.dueDate < localDateKey() ? "meta-chip overdue" : "meta-chip"}>
                <CalendarDays size={13} /> <HighlightText text={dueLabel} query={searchQuery} />
              </span>
            ) : null}
            {openSubtasks ? <span className="meta-chip"><ListChecks size={13} /> {openSubtasks} subtasks</span> : null}
            {recurrenceLabel ? (
              <span className="meta-chip">
                <Repeat2 size={13} /> <HighlightText text={recurrenceLabel} query={searchQuery} />
              </span>
            ) : null}
          </span>
        ) : null}
      </button>
      <div className="task-actions">
        <button
          className="task-move"
          type="button"
          onClick={onMoveUp}
          disabled={!canMoveUp}
          aria-label={`Move ${task.title} up`}
        >
          <ChevronUp size={15} />
        </button>
        <button
          className="task-move"
          type="button"
          onClick={onMoveDown}
          disabled={!canMoveDown}
          aria-label={`Move ${task.title} down`}
        >
          <ChevronDown size={15} />
        </button>
        <button
          className="task-drag"
          type="button"
          {...sortable.attributes}
          {...sortable.listeners}
          aria-label={`Reorder ${task.title}`}
        >
          <GripVertical size={16} />
        </button>
        <button className="task-more" type="button" onClick={onDelete} aria-label={`Delete ${task.title}`}>
          <Trash2 size={15} />
        </button>
      </div>
    </motion.article>
  );
}

function CompletedTaskRow({
  task,
  searchQuery,
  onRestore,
  onOpen,
  onDelete,
}: {
  task: StickyTask;
  searchQuery: string;
  onRestore: () => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <motion.div
      className="completed-row"
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 18 }}
      transition={springs.snappy}
    >
      <button type="button" className="completed-check" onClick={onRestore} aria-label={`Restore ${task.title}`}>
        <Undo2 size={14} />
      </button>
      <button type="button" className="completed-title" onClick={onOpen}>
        <HighlightText text={task.title} query={searchQuery} />
      </button>
      <button type="button" className="icon-chip subtle" onClick={onDelete} aria-label={`Delete ${task.title}`}>
        <Trash2 size={14} />
      </button>
    </motion.div>
  );
}

function TaskDetailsPanel({
  task,
  lists,
  subtasks,
  recurrenceRule,
  catchUpTarget,
  pulse,
  onClose,
  onOpenTask,
  onSavePatch,
  onMove,
  onDuplicate,
  onDelete,
  onComplete,
  onRestore,
  onAddSubtask,
  onUpdateSubtask,
  onMoveSubtask,
  onDeleteSubtask,
  onToggleRecurrence,
  onUpdateRecurrence,
  onAdvanceRecurrence,
}: {
  task: StickyTask | null;
  lists: StickyList[];
  subtasks: StickySubtask[];
  recurrenceRule: StickyRecurrenceRule | null;
  catchUpTarget: ReturnType<typeof recurrenceCatchUpTarget>;
  pulse: WorkspacePulse;
  onClose: () => void;
  onOpenTask: (taskId: string) => void;
  onSavePatch: (patch: Partial<StickyTask>) => void;
  onMove: (listId: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onComplete: () => void;
  onRestore: () => void;
  onAddSubtask: (title: string) => void;
  onUpdateSubtask: (subtaskId: string, patch: Partial<StickySubtask>) => void;
  onMoveSubtask: (subtaskId: string, direction: -1 | 1) => void;
  onDeleteSubtask: (subtaskId: string) => void;
  onToggleRecurrence: (enabled: boolean) => void;
  onUpdateRecurrence: (ruleId: string, patch: Partial<StickyRecurrenceRule>) => void;
  onAdvanceRecurrence: () => void;
}) {
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [titleDraft, setTitleDraft] = useState(task?.title ?? "");
  const [detailsDraft, setDetailsDraft] = useState(task?.details ?? "");
  const dueTimeRestrictionId = useId();
  const subtaskTitleId = useId();
  const recurrenceRestrictionId = useId();
  const subtaskRestrictionId = useId();
  const canHaveSubtasks = !recurrenceRule;
  const canRepeat = subtasks.length === 0;
  const recurrenceBlockedBySubtasks = !recurrenceRule && !canRepeat;
  const subtasksBlockedByRepeat = !canHaveSubtasks;

  useEffect(() => {
    setNewSubtaskTitle("");
    setTitleDraft(task?.title ?? "");
    setDetailsDraft(task?.details ?? "");
  }, [task?.details, task?.id, task?.title]);

  if (!task) {
    return (
      <aside className="details-panel empty-details" aria-label="Task details">
        <motion.div
          className="pulse-panel details-scroll"
          key="pulse"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springs.drawer}
        >
          <div className="pulse-head">
            <div className="pulse-mark">
              <Sparkles size={20} />
            </div>
            <div>
              <p className="eyebrow">Details</p>
              <h3>Select a task</h3>
            </div>
            <button
              className="icon-chip pulse-close"
              type="button"
              onClick={onClose}
              aria-label="Close workspace pulse"
            >
              <X size={18} />
            </button>
          </div>

          <div className="pulse-scoreboard">
            <div>
              <span>Active</span>
              <AnimatedNumber value={pulse.activeCount} className="pulse-number" />
            </div>
            <div>
              <span>Due today</span>
              <AnimatedNumber value={pulse.dueTodayCount} className="pulse-number" />
            </div>
            <div className={pulse.overdueCount ? "needs-attention" : ""}>
              <span>Overdue</span>
              <AnimatedNumber value={pulse.overdueCount} className="pulse-number" />
            </div>
            <div className="pulse-arc-tile">
              <span>Done</span>
              <ArcRing value={pulse.completionRate} size={84} />
            </div>
          </div>

          <div className="pulse-balance">
            <div>
              <ListChecks size={16} />
              <span>{pulse.openSubtasksCount} open {plural(pulse.openSubtasksCount, "subtask")}</span>
            </div>
            <div>
              <Repeat2 size={16} />
              <span>{pulse.recurringCount} repeating {plural(pulse.recurringCount, "task")}</span>
            </div>
          </div>

          <div className="pulse-focus">
            <div className="mini-section-title">
              <CalendarDays size={16} />
              <span>Focus next</span>
              {pulse.busiestListName ? <strong>{pulse.busiestListName}</strong> : null}
            </div>

            {pulse.focusTasks.length ? (
              <div className="pulse-task-list">
                {pulse.focusTasks.map((item) => (
                  <button
                    key={item.id}
                    className={`pulse-task color-${item.color}`}
                    type="button"
                    onClick={() => onOpenTask(item.id)}
                  >
                    <span className="pulse-task-title">{item.title}</span>
                    <span className="pulse-task-meta">
                      {item.isOverdue ? <strong>Overdue</strong> : null}
                      {item.dueLabel ? <span>{item.dueLabel}</span> : null}
                      <span>{item.listName}</span>
                      {item.openSubtasks ? <span>{item.openSubtasks} subtasks</span> : null}
                      {item.isRecurring ? <span>Repeats</span> : null}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="pulse-empty">
                <Layers3 size={20} />
                <span>All clear</span>
              </div>
            )}
          </div>

          {pulse.busiestListName ? (
            <div className="pulse-footer">
              <span>{pulse.busiestListActiveCount} active in {pulse.busiestListName}</span>
              <strong>{pulse.completedCount} completed</strong>
            </div>
          ) : null}
        </motion.div>
      </aside>
    );
  }

  const activeTask = task;
  const dueTimeNeedsDate = !activeTask.dueDate;
  const hasDueSchedule = Boolean(activeTask.dueDate || activeTask.dueTime);

  function submitSubtask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canHaveSubtasks || !newSubtaskTitle.trim()) {
      return;
    }

    onAddSubtask(newSubtaskTitle);
    setNewSubtaskTitle("");
  }

  function saveTitleDraft() {
    const title = titleDraft.trim();
    if (!title) {
      setTitleDraft(activeTask.title);
      return;
    }

    setTitleDraft(title);
    if (title !== activeTask.title) {
      onSavePatch({ title });
    }
  }

  function saveDetailsDraft() {
    if (detailsDraft !== activeTask.details) {
      onSavePatch({ details: detailsDraft });
    }
  }

  function updateFrequency(frequency: RecurrenceFrequency) {
    if (!recurrenceRule) {
      return;
    }

    const patch: Partial<StickyRecurrenceRule> = { frequency };

    if (recurrenceUsesDays(frequency) && recurrenceRule.daysOfWeek.length === 0) {
      patch.daysOfWeek = [startDayOfWeek(recurrenceRule.startsOn)];
    }

    if (!recurrenceUsesDays(frequency)) {
      patch.daysOfWeek = [];
    }

    if (recurrenceUsesMonthDay(frequency) && recurrenceRule.monthDay === null) {
      patch.monthDay = startMonthDay(recurrenceRule.startsOn);
    }

    if (!recurrenceUsesMonthDay(frequency)) {
      patch.monthDay = null;
    }

    onUpdateRecurrence(recurrenceRule.id, patch);
  }

  function updateEndType(endType: StickyRecurrenceRule["endType"]) {
    if (!recurrenceRule) {
      return;
    }

    onUpdateRecurrence(recurrenceRule.id, {
      endType,
      endDate: endType === "on_date" ? recurrenceRule.endDate ?? recurrenceRule.startsOn : null,
      occurrenceCount:
        endType === "after_count" ? recurrenceRule.occurrenceCount ?? 5 : null,
    });
  }

  function toggleRepeatDay(day: number) {
    if (!recurrenceRule) {
      return;
    }

    const daySet = new Set(recurrenceRule.daysOfWeek);
    if (daySet.has(day) && daySet.size > 1) {
      daySet.delete(day);
    } else {
      daySet.add(day);
    }

    onUpdateRecurrence(recurrenceRule.id, {
      daysOfWeek: [...daySet].sort((a, b) => a - b),
    });
  }

  function setQuickDueDate(dueDate: string | null) {
    onSavePatch(dueDate ? { dueDate } : { dueDate: null, dueTime: null });
  }

  function setQuickDueTime(dueTime: string | null) {
    onSavePatch({
      dueDate: activeTask.dueDate ?? localDateKey(),
      dueTime,
    });
  }

  return (
    <aside className="details-panel" aria-label="Task details">
      <motion.div
        className="details-scroll"
        key={task.id}
        initial={{ opacity: 0, x: 26 }}
        animate={{ opacity: 1, x: 0 }}
        transition={springs.drawer}
      >
        <div className="details-head">
          <div>
            <p className="eyebrow">Task details</p>
            <h3>{task.isCompleted ? "Completed task" : "Task details"}</h3>
          </div>
          <button className="icon-chip" type="button" onClick={onClose} aria-label="Close details">
            <X size={18} />
          </button>
        </div>

        <label className="detail-field title-field">
          <span>Title</span>
          <input
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={saveTitleDraft}
          />
        </label>

        <label className="detail-field">
          <span>Details</span>
          <textarea
            value={detailsDraft}
            onChange={(event) => setDetailsDraft(event.target.value)}
            onBlur={saveDetailsDraft}
            placeholder="Add context, links, or a note to future you."
          />
        </label>

        <div className="details-grid">
          <label className="detail-field">
            <span>List</span>
            <select value={task.listId} onChange={(event) => onMove(event.target.value)}>
              {lists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
                </option>
              ))}
            </select>
          </label>

          <label className="detail-field">
            <span>Color</span>
            <select
              value={task.color}
              onChange={(event) => onSavePatch({ color: event.target.value as StickyColor })}
            >
              {COLORS.map((color) => (
                <option key={color} value={color}>
                  {colorLabel(color)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <section className="due-card" aria-label="Due date and time">
          <div className="mini-section-title">
            <CalendarDays size={16} />
            Due
            {task.dueDate ? <strong>{humanDue(task)}</strong> : <strong>No date</strong>}
          </div>
          <div className="due-chip-row" aria-label="Quick due dates">
            {QUICK_DUE_OPTIONS.map((option) => {
              const dueDate = localDateKey(option.offsetDays);
              const active = task.dueDate === dueDate;

              return (
                <button
                  key={option.label}
                  type="button"
                  className={active ? "active" : ""}
                  aria-pressed={active}
                  onClick={() => setQuickDueDate(dueDate)}
                >
                  {option.label}
                </button>
              );
            })}
            <button
              type="button"
              className={!task.dueDate ? "active" : ""}
              aria-pressed={!task.dueDate}
              onClick={() => setQuickDueDate(null)}
            >
              No date
            </button>
          </div>
          <div className="due-controls">
            <input
              type="date"
              value={task.dueDate ?? ""}
              onChange={(event) =>
                onSavePatch(
                  event.target.value
                    ? { dueDate: event.target.value }
                    : { dueDate: null, dueTime: null },
                )
              }
              aria-label="Due date"
            />
            <input
              type="time"
              value={task.dueTime ?? ""}
              onChange={(event) => onSavePatch({ dueTime: event.target.value || null })}
              aria-label="Due time"
              disabled={dueTimeNeedsDate}
              aria-describedby={dueTimeNeedsDate ? dueTimeRestrictionId : undefined}
            />
            <button
              type="button"
              onClick={() => onSavePatch({ dueDate: null, dueTime: null })}
              disabled={!hasDueSchedule}
              aria-label="Remove due date and time"
            >
              Remove
            </button>
          </div>
          {dueTimeNeedsDate ? (
            <p className="helper-copy" id={dueTimeRestrictionId}>
              Choose a due date before adding a time.
            </p>
          ) : null}
          <div className="due-chip-row time-chip-row" aria-label="Quick due times">
            {QUICK_TIME_OPTIONS.map((option) => {
              const active = task.dueTime === option.value;

              return (
                <button
                  key={option.value}
                  type="button"
                  className={active ? "active" : ""}
                  aria-pressed={active}
                  onClick={() => setQuickDueTime(option.value)}
                >
                  {option.label}
                </button>
              );
            })}
            <button
              type="button"
              className={task.dueDate && !task.dueTime ? "active" : ""}
              aria-pressed={Boolean(task.dueDate && !task.dueTime)}
              onClick={() => setQuickDueTime(null)}
            >
              Any time
            </button>
          </div>
        </section>

        <TaskReminderControl task={task} />

        <section className="recurrence-card" aria-label="Recurrence">
          <div className="mini-section-title">
            <Repeat2 size={16} />
            Repeat
          </div>
          <label className="toggle-line">
            <input
              type="checkbox"
              checked={Boolean(recurrenceRule)}
              disabled={recurrenceBlockedBySubtasks}
              aria-describedby={recurrenceBlockedBySubtasks ? recurrenceRestrictionId : undefined}
              onChange={(event) => onToggleRecurrence(event.target.checked)}
            />
            <span>{recurrenceRule ? "Repeating" : "Not repeating"}</span>
          </label>

          {recurrenceBlockedBySubtasks ? (
            <p className="helper-copy" id={recurrenceRestrictionId}>
              Repeating tasks cannot have subtasks. Remove subtasks first.
            </p>
          ) : null}

          {recurrenceRule ? (
            <div className="recurrence-grid">
              <div className={`recurrence-preview${recurrenceRule.paused ? " paused" : ""}`}>
                <strong>{recurrenceRule.paused ? "Repeat paused" : recurrenceCadence(recurrenceRule)}</strong>
                <span>
                  {recurrenceRule.paused
                    ? "New occurrences are held until this repeat is resumed."
                    : recurrenceBoundary(recurrenceRule)}
                </span>
              </div>
              <label className="toggle-line recurrence-state-toggle">
                <input
                  type="checkbox"
                  checked={recurrenceRule.paused}
                  onChange={(event) =>
                    onUpdateRecurrence(recurrenceRule.id, {
                      paused: event.target.checked,
                    })
                  }
                />
                <span>Pause repeat</span>
              </label>
              {catchUpTarget ? (
                <div className="recurrence-inline-catchup">
                  <span>Behind schedule - next is {humanDate(catchUpTarget.dueDate)}</span>
                  <button type="button" onClick={onAdvanceRecurrence}>
                    Advance repeat
                  </button>
                </div>
              ) : null}
              <label className="detail-field">
                <span>Every</span>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={recurrenceRule.intervalCount}
                  onChange={(event) =>
                    onUpdateRecurrence(recurrenceRule.id, {
                      intervalCount: Number(event.target.value) || 1,
                    })
                  }
                />
              </label>
              <label className="detail-field">
                <span>Frequency</span>
                <select
                  value={recurrenceRule.frequency}
                  onChange={(event) => updateFrequency(event.target.value as RecurrenceFrequency)}
                >
                  <option value="daily">Days</option>
                  <option value="weekly">Weeks</option>
                  <option value="monthly">Months</option>
                  <option value="yearly">Years</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
              <label className="detail-field">
                <span>Starts</span>
                <input
                  type="date"
                  value={recurrenceRule.startsOn}
                  onChange={(event) =>
                    onUpdateRecurrence(recurrenceRule.id, {
                      startsOn: event.target.value,
                    })
                  }
                />
              </label>
              {recurrenceUsesDays(recurrenceRule.frequency) ? (
                <div className="repeat-days" aria-label="Repeat days">
                  {WEEKDAYS.map((day) => {
                    const active = recurrenceRule.daysOfWeek.includes(day.value);
                    return (
                      <button
                        key={day.value}
                        type="button"
                        className={active ? "active" : ""}
                        aria-pressed={active}
                        aria-label={day.name}
                        onClick={() => toggleRepeatDay(day.value)}
                      >
                        {day.label}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {recurrenceUsesMonthDay(recurrenceRule.frequency) ? (
                <label className="detail-field">
                  <span>Month day</span>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={recurrenceRule.monthDay ?? startMonthDay(recurrenceRule.startsOn)}
                    onChange={(event) =>
                      onUpdateRecurrence(recurrenceRule.id, {
                        monthDay: clampMonthDay(Number(event.target.value)),
                      })
                    }
                  />
                </label>
              ) : null}
              <label className="detail-field">
                <span>Ends</span>
                <select
                  value={recurrenceRule.endType}
                  onChange={(event) => updateEndType(event.target.value as StickyRecurrenceRule["endType"])}
                >
                  <option value="never">Never</option>
                  <option value="on_date">On date</option>
                  <option value="after_count">After count</option>
                </select>
              </label>
              {recurrenceRule.endType === "on_date" ? (
                <label className="detail-field">
                  <span>End date</span>
                  <input
                    type="date"
                    value={recurrenceRule.endDate ?? ""}
                    onChange={(event) =>
                      onUpdateRecurrence(recurrenceRule.id, {
                        endDate: event.target.value || recurrenceRule.startsOn,
                      })
                    }
                  />
                </label>
              ) : null}
              {recurrenceRule.endType === "after_count" ? (
                <label className="detail-field">
                  <span>Count</span>
                  <input
                    type="number"
                    min={1}
                    value={recurrenceRule.occurrenceCount ?? 5}
                    onChange={(event) =>
                      onUpdateRecurrence(recurrenceRule.id, {
                        occurrenceCount: Number(event.target.value) || 1,
                      })
                    }
                  />
                </label>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="subtask-card" aria-label="Subtasks">
          <div className="mini-section-title">
            <ListChecks size={16} />
            Subtasks
            <strong>{subtasks.filter((subtask) => !subtask.isCompleted).length}</strong>
          </div>

          <form className="subtask-form" onSubmit={submitSubtask}>
            <label className="sr-only" htmlFor={subtaskTitleId}>
              New subtask title
            </label>
            <input
              id={subtaskTitleId}
              value={newSubtaskTitle}
              onChange={(event) => setNewSubtaskTitle(event.target.value)}
              placeholder={canHaveSubtasks ? "Add subtask" : "Subtasks are disabled for repeats"}
              disabled={subtasksBlockedByRepeat}
              aria-describedby={subtasksBlockedByRepeat ? subtaskRestrictionId : undefined}
            />
            <button
              type="submit"
              disabled={!newSubtaskTitle.trim() || subtasksBlockedByRepeat}
              aria-label="Add subtask"
              aria-describedby={subtasksBlockedByRepeat ? subtaskRestrictionId : undefined}
            >
              <Plus size={16} />
            </button>
          </form>

          {subtasksBlockedByRepeat ? (
            <p className="helper-copy" id={subtaskRestrictionId}>
              Repeating tasks do not support subtasks. Remove repeat to add subtasks.
            </p>
          ) : null}

          <SortableContext
            items={subtasks.map((subtask) => subtask.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="subtask-list">
              <AnimatePresence initial={false}>
                {subtasks.map((subtask, index) => (
                  <SortableSubtaskRow
                    key={subtask.id}
                    subtask={subtask}
                    canMoveUp={index > 0}
                    canMoveDown={index < subtasks.length - 1}
                    onUpdate={(patch) => onUpdateSubtask(subtask.id, patch)}
                    onMoveUp={() => onMoveSubtask(subtask.id, -1)}
                    onMoveDown={() => onMoveSubtask(subtask.id, 1)}
                    onDelete={() => onDeleteSubtask(subtask.id)}
                  />
                ))}
              </AnimatePresence>
            </div>
          </SortableContext>
        </section>

        <div className="details-actions">
          <button
            className="secondary-action compact"
            type="button"
            onClick={onDuplicate}
            aria-label={`Duplicate ${task.title}`}
          >
            <Copy size={16} />
            Duplicate
          </button>
          {task.isCompleted ? (
            <button
              className="secondary-action compact"
              type="button"
              onClick={onRestore}
              aria-label={`Restore ${task.title}`}
            >
              <Undo2 size={16} />
              Restore
            </button>
          ) : (
            <button
              className="primary-action compact"
              type="button"
              onClick={onComplete}
              aria-label={`Complete ${task.title}`}
            >
              <Check size={16} />
              Complete
            </button>
          )}
          <button
            className="danger-action"
            type="button"
            onClick={onDelete}
            aria-label={`Delete ${task.title}`}
          >
            <Trash2 size={16} />
            Delete
          </button>
        </div>
      </motion.div>
    </aside>
  );
}

function SortableSubtaskRow({
  subtask,
  canMoveUp,
  canMoveDown,
  onUpdate,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  subtask: StickySubtask;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onUpdate: (patch: Partial<StickySubtask>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}) {
  const [titleDraft, setTitleDraft] = useState(subtask.title);
  const sortable = useSortable({ id: subtask.id, data: { type: "subtask" } });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };

  useEffect(() => {
    setTitleDraft(subtask.title);
  }, [subtask.id, subtask.title]);

  function saveTitleDraft() {
    const title = titleDraft.trim();
    if (!title) {
      setTitleDraft(subtask.title);
      return;
    }
    if (title !== subtask.title) {
      setTitleDraft(title);
      onUpdate({ title });
    }
  }

  return (
    <motion.div
      ref={sortable.setNodeRef}
      style={style}
      className={`subtask-row ${sortable.isDragging ? "dragging" : ""}`}
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -14 }}
      transition={springs.snappy}
    >
      <button
        className={`subtask-check${subtask.isCompleted ? " done" : ""}`}
        type="button"
        onClick={() =>
          onUpdate({
            isCompleted: !subtask.isCompleted,
            completedAt: subtask.isCompleted ? null : nowIso(),
          })
        }
        aria-label={`${subtask.isCompleted ? "Restore" : "Complete"} subtask: ${subtask.title}`}
      >
        <DrawnCheck checked={subtask.isCompleted} size={13} />
      </button>
      <input
        value={titleDraft}
        onChange={(event) => setTitleDraft(event.target.value)}
        onBlur={saveTitleDraft}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setTitleDraft(subtask.title);
            event.currentTarget.blur();
          }
        }}
        aria-label={`Subtask title: ${subtask.title}`}
        className={subtask.isCompleted ? "done" : ""}
      />
      <button
        className="subtask-move"
        type="button"
        onClick={onMoveUp}
        disabled={!canMoveUp}
        aria-label={`Move ${subtask.title} up`}
      >
        <ChevronUp size={14} />
      </button>
      <button
        className="subtask-move"
        type="button"
        onClick={onMoveDown}
        disabled={!canMoveDown}
        aria-label={`Move ${subtask.title} down`}
      >
        <ChevronDown size={14} />
      </button>
      <button
        className="subtask-drag"
        type="button"
        {...sortable.attributes}
        {...sortable.listeners}
        aria-label={`Reorder subtask: ${subtask.title}`}
      >
        <GripVertical size={15} />
      </button>
      <button
        className="subtask-delete"
        type="button"
        onClick={onDelete}
        aria-label={`Delete subtask: ${subtask.title}`}
      >
        <X size={14} />
      </button>
    </motion.div>
  );
}

function ListEditorDialog({
  list,
  onClose,
  onSave,
}: {
  list: StickyList | "new";
  onClose: () => void;
  onSave: (name: string, color: StickyColor) => void;
}) {
  const [name, setName] = useState(list === "new" ? "" : list.name);
  const [color, setColor] = useState<StickyColor>(list === "new" ? "sun" : list.color);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave(name, color);
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <motion.form
        className="sticky-dialog"
        onSubmit={submit}
        onKeyDown={trapDialogFocus}
        role="dialog"
        aria-modal="true"
        aria-label={list === "new" ? "New list" : "Rename list"}
        initial={{ opacity: 0, y: 22, scale: 0.95, rotate: -0.6 }}
        animate={{ opacity: 1, y: 0, scale: 1, rotate: 0 }}
        transition={springs.paper}
      >
        <div className="details-head">
          <div>
            <p className="eyebrow">List</p>
            <h3>{list === "new" ? "New list" : "Rename list"}</h3>
          </div>
          <button className="icon-chip" type="button" onClick={onClose} aria-label="Close list editor">
            <X size={18} />
          </button>
        </div>
        <label className="detail-field title-field">
          <span>Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        </label>
        <div className="color-picker-row">
          <ListColorWheel value={color} onChange={(next) => setColor(next as StickyColor)} />
          <div className="color-grid" aria-label="List color">
            {COLORS.map((item) => (
              <label key={item} className={`color-choice color-${item}`}>
                <input
                  type="radio"
                  name="list-color"
                  value={item}
                  checked={color === item}
                  onChange={() => setColor(item)}
                />
                <span>{colorLabel(item)}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="dialog-actions">
          <button className="secondary-action compact" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-action compact" type="submit" disabled={!name.trim()}>
            Save list
          </button>
        </div>
      </motion.form>
    </div>
  );
}

function ConfirmDialog({
  request,
  onCancel,
}: {
  request: ConfirmRequest;
  onCancel: () => void;
}) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <motion.div
        className="sticky-dialog confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={request.title}
        onKeyDown={trapDialogFocus}
        initial={{ opacity: 0, y: 22, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={springs.paper}
      >
        <div className="dialog-icon danger">
          <Trash2 size={24} />
        </div>
        <h3>{request.title}</h3>
        <p>{request.body}</p>
        <div className="dialog-actions">
          <button className="secondary-action compact" type="button" onClick={onCancel} autoFocus>
            Cancel
          </button>
          <button
            className={request.tone === "danger" ? "danger-action" : "primary-action compact"}
            type="button"
            onClick={request.onConfirm}
          >
            {request.actionLabel}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function CommandCenter({
  items,
  query,
  selectedIndex,
  inputRef,
  onQueryChange,
  onSelectIndex,
  onRun,
  onClose,
}: {
  items: CommandItem[];
  query: string;
  selectedIndex: number;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onQueryChange: (query: string) => void;
  onSelectIndex: (index: number) => void;
  onRun: (item: CommandItem) => void;
  onClose: () => void;
}) {
  const selectedItem = selectedIndex >= 0 ? items[selectedIndex] : null;
  const listboxId = "sticky-command-results";
  const selectedOptionId = selectedItem ? `sticky-command-option-${selectedIndex}` : undefined;

  function iconFor(item: CommandItem) {
    if (item.kind === "list") {
      return <Layers3 size={17} />;
    }

    if (item.kind === "task") {
      return <CalendarDays size={17} />;
    }

    if (item.kind === "preference") {
      return <Monitor size={17} />;
    }

    return <CommandIcon size={17} />;
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <motion.div
        id="sticky-command-dialog"
        className="sticky-dialog command-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Command center"
        onKeyDown={trapDialogFocus}
        initial={{ opacity: 0, y: 20, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.97 }}
        transition={springs.paper}
      >
        <div className="command-head">
          <div>
            <p className="eyebrow">Command center</p>
            <h3>Move fast</h3>
          </div>
          <button className="icon-chip" type="button" onClick={onClose} aria-label="Close command center">
            <X size={18} />
          </button>
        </div>

        <label className="command-search">
          <Search size={17} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                onSelectIndex(Math.min(selectedIndex + 1, Math.max(items.length - 1, 0)));
              }

              if (event.key === "ArrowUp") {
                event.preventDefault();
                onSelectIndex(Math.max(selectedIndex - 1, 0));
              }

              if (event.key === "Enter" && selectedItem) {
                event.preventDefault();
                onRun(selectedItem);
              }

              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                onClose();
              }
            }}
            type="search"
            placeholder="Search tasks, lists, or actions"
            aria-label="Search commands"
            role="combobox"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-activedescendant={selectedOptionId}
            aria-autocomplete="list"
          />
          <kbd className="command-kbd" aria-hidden="true">Esc</kbd>
        </label>

        <div id={listboxId} className="command-list" role="listbox" aria-label="Command results">
          {items.length ? (
            items.map((item, index) => (
              <motion.button
                key={item.id}
                id={`sticky-command-option-${index}`}
                className={`command-item ${index === selectedIndex ? "active" : ""}`}
                type="button"
                role="option"
                aria-selected={index === selectedIndex}
                onMouseEnter={() => onSelectIndex(index)}
                onClick={() => onRun(item)}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...springs.snappy, delay: Math.min(index * 0.022, 0.2) }}
              >
                {index === selectedIndex ? (
                  <motion.span
                    className="command-active-pill"
                    layoutId="command-active-pill"
                    transition={springs.snappy}
                    aria-hidden="true"
                  />
                ) : null}
                <span className={`command-item-icon ${item.color ? `color-${item.color}` : ""}`}>
                  {iconFor(item)}
                </span>
                <span className="command-item-copy">
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </span>
                <ChevronRight size={16} />
              </motion.button>
            ))
          ) : (
            <div className="command-empty">
              <Search size={19} />
              <strong>No command found</strong>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  function toastAccessibleName(toast: Toast) {
    return toast.body ? `${toast.title}: ${toast.body}` : toast.title;
  }

  return (
    <div className="toast-stack" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.div
            className="toast"
            key={toast.id}
            role="group"
            aria-label={toastAccessibleName(toast)}
            layout
            initial={{ opacity: 0, y: 22, scale: 0.95, rotate: -1.2 }}
            animate={{ opacity: 1, y: 0, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, y: 14, scale: 0.96, rotate: 0.8 }}
            transition={springs.paper}
          >
            <div>
              <strong>{toast.title}</strong>
              {toast.body ? <p>{toast.body}</p> : null}
            </div>
            {toast.actionLabel && toast.onAction ? (
              <button type="button" onClick={toast.onAction}>
                {toast.actionLabel}
                <span className="sr-only"> {toast.title}</span>
              </button>
            ) : null}
            <button
              type="button"
              className="toast-close"
              onClick={() => onDismiss(toast.id)}
              aria-label={`Dismiss ${toast.title}`}
            >
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <div className="empty-stack" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}
