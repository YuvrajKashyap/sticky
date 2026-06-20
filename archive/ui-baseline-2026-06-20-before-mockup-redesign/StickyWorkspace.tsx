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
import { AnimatePresence, motion } from "framer-motion";
import {
  Archive,
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
  Monitor,
  Moon,
  Rows3,
  Pencil,
  Plus,
  Repeat2,
  Search,
  Sparkles,
  Sun,
  Trash2,
  TriangleAlert,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { listToDb, recurrenceToDb, subtaskToDb, taskToDb } from "@/lib/sticky/mappers";
import { userFacingStickySaveMessage } from "@/lib/sticky/messages";
import {
  nextOccurrenceCount,
  nextRecurrenceDate,
  recurrenceCatchUpTarget,
} from "@/lib/sticky/recurrence";
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

type QuickCaptureIntent = {
  title: string;
  dueDate: string | null;
  dueTime: string | null;
  dateLabel: string | null;
  timeLabel: string | null;
  listId: string | null;
  listName: string | null;
};

const DEMO_STORAGE_KEY = "sticky.demo.workspace.v1";
const COLORS: StickyColor[] = ["sun", "coral", "mint", "sky", "violet", "ink"];
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
const TASK_SORT_ACCESSIBLE_LABELS: Record<StickyTaskSortMode, string> = {
  custom: "Custom order",
  due: "Due date",
};

function normalizeWorkspacePreferences(data: StickyWorkspaceData): StickyWorkspaceData {
  return {
    ...data,
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

  return { tone: "clean", label: "Supabase-backed", shortLabel: "Live" };
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
  const searchInputRef = useRef<HTMLInputElement>(null);
  const commandInputRef = useRef<HTMLInputElement>(null);
  const commandTriggerRef = useRef<HTMLButtonElement>(null);
  const supabase = useMemo(
    () => (mode === "supabase" ? createSupabaseBrowserClient() : null),
    [mode],
  );

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

    target.scrollIntoView({ block: "center", inline: "nearest" });
    target.focus({ preventScroll: true });
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
        if (selectedTaskId) {
          setSelectedTaskId(null);
        }
        return;
      }

      if (!isTyping && (event.key.toLowerCase() === "n" || event.code === "KeyN")) {
        event.preventDefault();
        quickInputRef.current?.focus();
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
    listEditor,
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

  const activeListId = useMemo(() => {
    const selected = workspace.userState.selectedListId;
    if (selected && workspace.lists.some((list) => list.id === selected)) {
      return selected;
    }
    return workspace.lists[0]?.id ?? null;
  }, [workspace.lists, workspace.userState.selectedListId]);

  const activeList = workspace.lists.find((list) => list.id === activeListId) ?? null;
  const searchQuery = workspace.userState.searchQuery.trim().toLowerCase();

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

    const filteredTasks = activeListTasks
      .filter((task) => {
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
      })
      .filter((task) => {
        if (!searchQuery) {
          return true;
        }
        const subtaskText = (subtasksByTask.get(task.id) ?? [])
          .map((subtask) => subtask.title)
          .join(" ");
        return `${task.title} ${task.details} ${subtaskText}`.toLowerCase().includes(searchQuery);
      });

    if (taskSortMode === "due") {
      return filteredTasks.slice().sort((a, b) => {
        const aDue = `${a.dueDate ?? "9999-12-31"}T${a.dueTime ?? "23:59"}`;
        const bDue = `${b.dueDate ?? "9999-12-31"}T${b.dueTime ?? "23:59"}`;
        return aDue.localeCompare(bDue) || bySortOrder(a, b);
      });
    }

    return filteredTasks;
  }, [activeListTasks, recurrenceByTask, searchQuery, subtasksByTask, taskSortMode, taskViewFilter]);
  const taskViewFiltered = taskViewFilter !== "all";
  const taskSorted = taskSortMode !== "custom";
  const reorderLocked = Boolean(searchQuery || taskViewFiltered || taskSorted);

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
  const density = workspace.preferences.density;
  const colorMode = workspace.preferences.colorMode;
  const boardStyle = workspace.preferences.boardStyle;
  const currentSaveStatus = saveStatus(saveState, mode, demoReady);
  const quickCaptureIntent = useMemo(
    () => parseQuickCaptureIntent(quickTitle, workspace.lists),
    [quickTitle, workspace.lists],
  );
  const workspacePulse = useMemo<WorkspacePulse>(() => {
    const todayKey = format(new Date(), "yyyy-MM-dd");
    const activeAll = workspace.tasks.filter((task) => !task.isCompleted);
    const completedCount = workspace.tasks.length - activeAll.length;
    const openSubtasks = workspace.subtasks.filter((subtask) => !subtask.isCompleted);
    const listById = new Map(workspace.lists.map((list) => [list.id, list]));
    const listActiveCounts = new Map(workspace.lists.map((list) => [list.id, 0]));

    activeAll.forEach((task) => {
      listActiveCounts.set(task.listId, (listActiveCounts.get(task.listId) ?? 0) + 1);
    });

    const busiestList = workspace.lists
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
      completionRate: workspace.tasks.length
        ? Math.round((completedCount / workspace.tasks.length) * 100)
        : 0,
      focusTasks,
      busiestListName: busiestList?.name ?? null,
      busiestListActiveCount: busiestList ? listActiveCounts.get(busiestList.id) ?? 0 : 0,
    };
  }, [recurrenceByTask, subtasksByTask, workspace.lists, workspace.subtasks, workspace.tasks]);
  const listById = new Map(workspace.lists.map((list) => [list.id, list]));
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
      title: "Search this list",
      detail: activeList ? `Filter ${activeList.name}` : "Focus search",
      keywords: "find filter search current list",
      run: () => focusCommandTarget("search"),
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
    {
      id: "preference-comfy",
      kind: "preference",
      title: "Use comfy density",
      detail: density === "comfortable" ? "Already active" : "Roomier task cards",
      keywords: "comfortable roomy density layout",
      run: () => setDensity("comfortable"),
    },
    {
      id: "preference-compact",
      kind: "preference",
      title: "Use compact density",
      detail: density === "compact" ? "Already active" : "Denser task scan",
      keywords: "compact dense density layout",
      run: () => setDensity("compact"),
    },
    {
      id: "preference-light",
      kind: "preference",
      title: "Use light theme",
      detail: colorMode === "light" ? "Already active" : "Bright workspace",
      keywords: "theme color mode light sun",
      run: () => setColorMode("light"),
    },
    {
      id: "preference-dark",
      kind: "preference",
      title: "Use dark theme",
      detail: colorMode === "dark" ? "Already active" : "Low-light workspace",
      keywords: "theme color mode dark moon",
      run: () => setColorMode("dark"),
    },
    {
      id: "preference-pad",
      kind: "preference",
      title: "Use sticky pads",
      detail: boardStyle === "pad" ? "Already active" : "Paper pad workspace",
      keywords: "appearance board style pad sticky pads paper",
      run: () => setBoardStyle("pad"),
    },
    {
      id: "preference-wood",
      kind: "preference",
      title: "Use wood board",
      detail: boardStyle === "wood" ? "Already active" : "Wood board workspace",
      keywords: "appearance board style wood board",
      run: () => setBoardStyle("wood"),
    },
    ...workspace.lists.slice().sort(bySortOrder).map((list) => {
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
      .filter((task) => !task.isCompleted)
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
    updateUserState({ selectedListId: listId, searchQuery: "" });
    setSelectedTaskId(null);
  }

  function openTaskInContext(taskId: string) {
    const task = workspace.tasks.find((item) => item.id === taskId);

    if (!task) {
      return;
    }

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
    const fallbackList = workspace.lists.find((item) => item.id !== list.id) ?? null;
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

    setWorkspace({ ...workspace, lists: moved });
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
    const ordered = workspace.lists.slice().sort(bySortOrder);
    const oldIndex = ordered.findIndex((list) => list.id === listId);
    const newIndex = oldIndex + direction;

    if (oldIndex < 0 || newIndex < 0 || newIndex >= ordered.length) {
      return;
    }

    saveListOrder(arrayMove(ordered, oldIndex, newIndex), workspace);
  }

  function createTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const intent = parseQuickCaptureIntent(quickTitle, workspace.lists);
    const title = intent.title.trim();
    const targetList = intent.listId
      ? workspace.lists.find((list) => list.id === intent.listId)
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
    const task: StickyTask = {
      id: createId(),
      userId: workspace.user.id,
      listId: targetListId,
      title,
      details: "",
      color: targetList?.color ?? activeList?.color ?? "sun",
      dueDate: intent.dueDate,
      dueTime: intent.dueTime,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago",
      isCompleted: false,
      completedAt: null,
      sortOrder: nextSortOrder(workspace.tasks.filter((item) => item.listId === targetListId && !item.isCompleted)),
      completedSortOrder: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    setQuickTitle("");
    setTaskViewFilter("all");
    setWorkspace({
      ...workspace,
      tasks: [...workspace.tasks, task],
      preferences: nextPreferences,
      userState: nextUserState,
    });
    setSelectedTaskId(task.id);
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

        if (taskResult.error || !stateShouldReveal) {
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

  function saveTaskOrder(ordered: StickyTask[], before: StickyWorkspaceData) {
    if (!activeListId) {
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
          p_list_id: activeListId,
          p_task_ids: moved.map((task) => task.id),
        }),
      before,
    );
  }

  function moveTaskInOrder(taskId: string, direction: -1 | 1) {
    if (reorderLocked) {
      pushToast({
        title: "Reorder paused during alternate views",
        body: "Use All, Custom order, and clear search before changing saved order.",
      });
      return;
    }

    const ordered = workspace.tasks
      .filter((task) => task.listId === activeListId && !task.isCompleted)
      .sort(bySortOrder);
    const oldIndex = ordered.findIndex((task) => task.id === taskId);
    const newIndex = oldIndex + direction;

    if (oldIndex < 0 || newIndex < 0 || newIndex >= ordered.length) {
      return;
    }

    saveTaskOrder(arrayMove(ordered, oldIndex, newIndex), workspace);
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

  function toggleCompletedPile() {
    if (!activeListId) {
      return;
    }

    updatePreferences({
      completedOpenByList: {
        ...workspace.preferences.completedOpenByList,
        [activeListId]: !completedOpen,
      },
    });
  }

  function setDensity(nextDensity: StickyWorkspaceData["preferences"]["density"]) {
    if (nextDensity === density) {
      return;
    }

    updatePreferences({ density: nextDensity });
  }

  function setColorMode(nextMode: StickyWorkspaceData["preferences"]["colorMode"]) {
    if (nextMode === colorMode) {
      return;
    }

    updatePreferences({ colorMode: nextMode });
  }

  function setBoardStyle(nextStyle: StickyWorkspaceData["preferences"]["boardStyle"]) {
    if (nextStyle === boardStyle) {
      return;
    }

    updatePreferences({ boardStyle: nextStyle });
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

    const type = active.data.current?.type as "list" | "task" | "subtask" | undefined;

    if (type === "list") {
      const ordered = workspace.lists.slice().sort(bySortOrder);
      const oldIndex = ordered.findIndex((list) => list.id === active.id);
      const newIndex = ordered.findIndex((list) => list.id === over.id);
      if (oldIndex < 0 || newIndex < 0) {
        return;
      }
      saveListOrder(arrayMove(ordered, oldIndex, newIndex), workspace);
    }

    if (type === "task") {
      if (reorderLocked) {
        pushToast({
          title: "Reorder paused during alternate views",
          body: "Use All, Custom order, and clear search before changing saved order.",
        });
        return;
      }

      const ordered = workspace.tasks
        .filter((task) => task.listId === activeListId && !task.isCompleted)
        .sort(bySortOrder);
      const oldIndex = ordered.findIndex((task) => task.id === active.id);
      const newIndex = ordered.findIndex((task) => task.id === over.id);
      if (!activeListId || oldIndex < 0 || newIndex < 0) {
        return;
      }
      saveTaskOrder(arrayMove(ordered, oldIndex, newIndex), workspace);
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
    <main className={`sticky-app density-${density} tone-${colorMode} board-${boardStyle}`}>
      <DndContext
        id="sticky-workspace-dnd"
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <aside className="list-rail" aria-label="Sticky lists">
          <div className="brand-block">
            <div className="brand-symbol" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div>
              <p className="eyebrow">Sticky</p>
              <h1>Tasks</h1>
            </div>
          </div>

          <button className="new-list-button" type="button" onClick={() => openListEditor("new")}>
            <Plus size={18} />
            New list
          </button>

          <SortableContext
            items={workspace.lists.slice().sort(bySortOrder).map((list) => list.id)}
            strategy={horizontalListSortingStrategy}
          >
            <nav className="list-stack">
              {workspace.lists
                .slice()
                .sort(bySortOrder)
                .map((list, index, sortedLists) => (
                  <SortableListItem
                    key={list.id}
                    list={list}
                    active={list.id === activeListId}
                    stats={listStats.get(list.id) ?? { active: 0, completed: 0 }}
                    canMoveUp={index > 0}
                    canMoveDown={index < sortedLists.length - 1}
                    onSelect={() => switchList(list.id)}
                    onRename={() => openListEditor(list)}
                    onMoveUp={() => moveListInOrder(list.id, -1)}
                    onMoveDown={() => moveListInOrder(list.id, 1)}
                    onDelete={() => requestDeleteList(list)}
                  />
                ))}
            </nav>
          </SortableContext>

          <div className="rail-footer">
            <div>
              <p>{workspace.user.displayName || workspace.user.email}</p>
              <span
                className={`save-status ${currentSaveStatus.tone}`}
                role="status"
                aria-live="polite"
                title={saveState.error ?? currentSaveStatus.label}
              >
                <span className="save-status-label">{currentSaveStatus.label}</span>
                <span className="save-status-short" aria-hidden="true">
                  {currentSaveStatus.shortLabel}
                </span>
              </span>
            </div>
            <button className="icon-chip" type="button" onClick={signOut} aria-label="Sign out">
              <LogOut size={17} />
            </button>
          </div>
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
              <p className="eyebrow">Current list</p>
              <h2>{activeList?.name ?? "No list"}</h2>
              <div className="metric-strip">
                <span>{activeListTasks.length} active</span>
                <span>{completedTasks.length} completed</span>
                <span>{workspace.subtasks.filter((subtask) => !subtask.isCompleted).length} open subtasks</span>
              </div>
            </div>

            <div className="workspace-tools">
              <label className="search-control">
                <Search size={17} />
                <input
                  ref={searchInputRef}
                  value={workspace.userState.searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  type="search"
                  placeholder="Search current list"
                  aria-label="Search current list"
                />
              </label>
              <details className="appearance-menu">
                <summary className="appearance-trigger" aria-label="Open appearance settings">
                  <Monitor size={16} />
                  Appearance
                  <ChevronDown size={14} aria-hidden="true" />
                </summary>
                <div className="preference-controls" aria-label="Workspace appearance">
                  <div className="appearance-group">
                    <span className="appearance-group-label">Theme</span>
                    <div className="segmented-control" aria-label="Theme">
                      <button
                        type="button"
                        className={colorMode === "light" ? "active" : ""}
                        onClick={() => setColorMode("light")}
                        aria-pressed={colorMode === "light"}
                      >
                        <Sun size={15} />
                        Light
                      </button>
                      <button
                        type="button"
                        className={colorMode === "dark" ? "active" : ""}
                        onClick={() => setColorMode("dark")}
                        aria-pressed={colorMode === "dark"}
                      >
                        <Moon size={15} />
                        Dark
                      </button>
                    </div>
                  </div>
                  <div className="appearance-group">
                    <span className="appearance-group-label">Board style</span>
                    <div className="segmented-control" aria-label="Board style">
                      <button
                        type="button"
                        className={boardStyle === "pad" ? "active" : ""}
                        onClick={() => setBoardStyle("pad")}
                        aria-pressed={boardStyle === "pad"}
                      >
                        <Layers3 size={15} />
                        Sticky pads
                      </button>
                      <button
                        type="button"
                        className={boardStyle === "wood" ? "active" : ""}
                        onClick={() => setBoardStyle("wood")}
                        aria-pressed={boardStyle === "wood"}
                      >
                        <Archive size={15} />
                        Wood board
                      </button>
                    </div>
                  </div>
                  <div className="appearance-group">
                    <span className="appearance-group-label">Density</span>
                    <div className="segmented-control" aria-label="Density">
                      <button
                        type="button"
                        className={density === "comfortable" ? "active" : ""}
                        onClick={() => setDensity("comfortable")}
                        aria-pressed={density === "comfortable"}
                      >
                        <Rows3 size={15} />
                        Comfy
                      </button>
                      <button
                        type="button"
                        className={density === "compact" ? "active" : ""}
                        onClick={() => setDensity("compact")}
                        aria-pressed={density === "compact"}
                      >
                        <ListChecks size={15} />
                        Compact
                      </button>
                    </div>
                  </div>
                </div>
              </details>
              <button
                ref={commandTriggerRef}
                className="command-trigger"
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
                className="tool-button"
                type="button"
                onClick={() => activeList && openListEditor(activeList)}
                aria-label={`Rename current list ${activeList?.name ?? ""}`.trim()}
              >
                <Pencil size={16} />
                Rename
              </button>
            </div>
          </header>

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

          <form className="quick-capture" onSubmit={createTask}>
            <div className="capture-icon">
              <Plus size={20} />
            </div>
            <input
              ref={quickInputRef}
              value={quickTitle}
              onChange={(event) => setQuickTitle(event.target.value)}
              placeholder="Add a task"
              aria-label="Quick add task"
            />
            <button
              type="submit"
              disabled={!quickCaptureIntent.title.trim() || !activeListId}
              aria-label={`Add task to ${quickCaptureIntent.listName ?? activeList?.name ?? "current list"}`}
            >
              Add
            </button>
            {quickCaptureIntent.dueDate || quickCaptureIntent.dueTime || quickCaptureIntent.listName ? (
              <div className="quick-schedule-preview" aria-live="polite">
                {quickCaptureIntent.dueDate || quickCaptureIntent.dueTime ? (
                  <CalendarDays size={14} />
                ) : (
                  <Layers3 size={14} />
                )}
                {quickCaptureIntent.listName ? <span>{quickCaptureIntent.listName}</span> : null}
                {quickCaptureIntent.dateLabel ? <span>{quickCaptureIntent.dateLabel}</span> : null}
                {quickCaptureIntent.timeLabel ? <span>{quickCaptureIntent.timeLabel}</span> : null}
              </div>
            ) : null}
          </form>

          {reorderLocked ? (
            <div className="filter-banner">
              <Search size={15} />
              Reordering is locked while search, filters, or due-date sorting are active, so custom order stays intact.
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

          <section className="task-lane" aria-label="Active tasks">
            {activeTasks.length ? (
              <SortableContext
                items={activeTasks.map((task) => task.id)}
                strategy={verticalListSortingStrategy}
              >
                <AnimatePresence initial={false}>
                  {activeTasks.map((task) => {
                    const orderIndex = activeListTasks.findIndex((item) => item.id === task.id);

                    return (
                      <SortableTaskCard
                        key={task.id}
                        task={task}
                        active={task.id === selectedTaskId}
                        subtasks={subtasksByTask.get(task.id) ?? []}
                        recurrenceRule={recurrenceByTask.get(task.id) ?? null}
                        dueLabel={humanDue(task)}
                        reorderDisabled={reorderLocked}
                        canMoveUp={!reorderLocked && orderIndex > 0}
                        canMoveDown={!reorderLocked && orderIndex >= 0 && orderIndex < activeListTasks.length - 1}
                        onOpen={() => setSelectedTaskId(task.id)}
                        onComplete={() => completeTask(task)}
                        onDelete={() => requestDeleteTask(task)}
                        onMoveUp={() => moveTaskInOrder(task.id, -1)}
                        onMoveDown={() => moveTaskInOrder(task.id, 1)}
                      />
                    );
                  })}
                </AnimatePresence>
              </SortableContext>
            ) : (
              <EmptyState
                title={
                  searchQuery
                    ? "No matching tasks"
                    : taskViewFiltered
                      ? `No ${TASK_VIEW_LABELS[taskViewFilter].toLowerCase()} tasks`
                      : "No tasks yet"
                }
                body={
                  searchQuery
                    ? "Try a different phrase or clear search to see the full order."
                    : taskViewFiltered
                      ? "Switch back to All to see the full custom order."
                    : "Add a task to start this list."
                }
              />
            )}
          </section>

          <section className="completed-pile" aria-label="Completed tasks">
            <button
              className="completed-toggle"
              type="button"
              onClick={toggleCompletedPile}
              aria-expanded={completedOpen}
              aria-controls="completed-stickies-list"
            >
              {completedOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
              <span>Completed</span>
              <strong>{completedTasks.length}</strong>
            </button>

            <AnimatePresence initial={false}>
              {completedOpen ? (
                <motion.div
                  id="completed-stickies-list"
                  className="completed-list"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                >
                  {completedTasks.map((task) => (
                    <CompletedTaskRow
                      key={task.id}
                      task={task}
                      onRestore={() => restoreTask(task.id)}
                      onOpen={() => setSelectedTaskId(task.id)}
                      onDelete={() => requestDeleteTask(task)}
                    />
                  ))}
                  {completedTasks.length ? (
                    <button className="clear-completed" type="button" onClick={requestClearCompleted}>
                      <Archive size={15} />
                      Clear completed
                    </button>
                  ) : (
                    <p className="completed-empty">Completed tasks land here.</p>
                  )}
                </motion.div>
              ) : null}
            </AnimatePresence>
          </section>
        </section>

        <TaskDetailsPanel
          task={selectedTask}
          lists={workspace.lists.slice().sort(bySortOrder)}
          subtasks={selectedTaskSubtasks}
          recurrenceRule={selectedTaskRecurrence}
          catchUpTarget={selectedTaskCatchUp}
          pulse={workspacePulse}
          onClose={() => setSelectedTaskId(null)}
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
            onQueryChange={setCommandQuery}
            onSelectIndex={setCommandIndex}
            onRun={runCommand}
            onClose={() => closeCommandCenter(true)}
          />
        ) : null}

        <ToastStack toasts={toasts} onDismiss={(id) => setToasts((items) => items.filter((item) => item.id !== id))} />
      </DndContext>
    </main>
  );
}

function SortableListItem({
  list,
  active,
  stats,
  canMoveUp,
  canMoveDown,
  onSelect,
  onRename,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  list: StickyList;
  active: boolean;
  stats: { active: number; completed: number };
  canMoveUp: boolean;
  canMoveDown: boolean;
  onSelect: () => void;
  onRename: () => void;
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
    active ? "current list" : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div ref={sortable.setNodeRef} style={style} className={`list-tab-wrap ${sortable.isDragging ? "dragging" : ""}`}>
      <button
        className={`list-tab color-${list.color}${active ? " active" : ""}`}
        type="button"
        onClick={onSelect}
        aria-label={listTabLabel}
      >
        <span
          className="drag-handle"
          {...sortable.attributes}
          {...sortable.listeners}
          aria-label={`Drag list named ${list.name}`}
        >
          <GripVertical size={16} />
        </span>
        <span className="list-tab-name">{list.name}</span>
        <span className="list-tab-counts">
          {stats.active}<small>{stats.completed}</small>
        </span>
      </button>
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
        <button type="button" onClick={onDelete} aria-label={`Delete ${list.name}`}>
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

function SortableTaskCard({
  task,
  active,
  subtasks,
  recurrenceRule,
  dueLabel,
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
  const openSubtasks = subtasks.filter((subtask) => !subtask.isCompleted).length;
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };

  return (
    <motion.article
      ref={sortable.setNodeRef}
      layout
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: -20, scale: 0.98 }}
      style={style}
      data-task-id={task.id}
      className={`task-card color-${task.color}${active ? " selected" : ""}${sortable.isDragging ? " dragging" : ""}`}
    >
      <button
        className="task-check"
        type="button"
        onClick={onComplete}
        aria-label={`Complete ${task.title}`}
      >
        <Check size={18} />
      </button>
      <button className="task-body-button" type="button" onClick={onOpen}>
        <span className="task-title">{task.title}</span>
        {task.details ? <span className="task-details">{task.details}</span> : null}
        <span className="task-meta-row">
          {dueLabel ? <span><CalendarDays size={14} /> {dueLabel}</span> : null}
          {openSubtasks ? <span><ListChecks size={14} /> {openSubtasks} subtasks</span> : null}
          {recurrenceRule ? (
            <span>
              <Repeat2 size={14} /> {recurrenceRule.paused ? "Repeat paused" : recurrenceCadence(recurrenceRule)}
            </span>
          ) : null}
        </span>
      </button>
      <div className="task-actions">
        <button
          className="task-move"
          type="button"
          onClick={onMoveUp}
          disabled={!canMoveUp}
          aria-label={`Move ${task.title} up`}
        >
          <ChevronUp size={16} />
        </button>
        <button
          className="task-move"
          type="button"
          onClick={onMoveDown}
          disabled={!canMoveDown}
          aria-label={`Move ${task.title} down`}
        >
          <ChevronDown size={16} />
        </button>
        <button
          className="task-drag"
          type="button"
          {...sortable.attributes}
          {...sortable.listeners}
          aria-label={`Reorder ${task.title}`}
        >
          <GripVertical size={17} />
        </button>
        <button className="task-more" type="button" onClick={onDelete} aria-label={`Delete ${task.title}`}>
          <Trash2 size={16} />
        </button>
      </div>
    </motion.article>
  );
}

function CompletedTaskRow({
  task,
  onRestore,
  onOpen,
  onDelete,
}: {
  task: StickyTask;
  onRestore: () => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="completed-row">
      <button type="button" className="completed-check" onClick={onRestore} aria-label={`Restore ${task.title}`}>
        <Undo2 size={15} />
      </button>
      <button type="button" className="completed-title" onClick={onOpen}>
        {task.title}
      </button>
      <button type="button" className="icon-chip subtle" onClick={onDelete} aria-label={`Delete ${task.title}`}>
        <Trash2 size={14} />
      </button>
    </div>
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
        <div className="pulse-panel">
          <div className="pulse-head">
            <div className="pulse-mark">
              <Sparkles size={20} />
            </div>
            <div>
              <p className="eyebrow">Details</p>
              <h3>Select a task</h3>
            </div>
          </div>

          <div className="pulse-scoreboard">
            <div>
              <span>Active</span>
              <strong>{pulse.activeCount}</strong>
            </div>
            <div>
              <span>Due today</span>
              <strong>{pulse.dueTodayCount}</strong>
            </div>
            <div className={pulse.overdueCount ? "needs-attention" : ""}>
              <span>Overdue</span>
              <strong>{pulse.overdueCount}</strong>
            </div>
            <div>
              <span>Done</span>
              <strong>{pulse.completionRate}%</strong>
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
        </div>
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
    <div ref={sortable.setNodeRef} style={style} className={`subtask-row ${sortable.isDragging ? "dragging" : ""}`}>
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
        <Check size={13} />
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
    </div>
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
      <form
        className="sticky-dialog"
        onSubmit={submit}
        onKeyDown={trapDialogFocus}
        role="dialog"
        aria-modal="true"
        aria-label={list === "new" ? "New list" : "Rename list"}
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
        <div className="dialog-actions">
          <button className="secondary-action compact" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-action compact" type="submit" disabled={!name.trim()}>
            Save list
          </button>
        </div>
      </form>
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
      <div
        className="sticky-dialog confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={request.title}
        onKeyDown={trapDialogFocus}
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
      </div>
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
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
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
        </label>

        <div id={listboxId} className="command-list" role="listbox" aria-label="Command results">
          {items.length ? (
            items.map((item, index) => (
              <button
                key={item.id}
                id={`sticky-command-option-${index}`}
                className={`command-item ${index === selectedIndex ? "active" : ""}`}
                type="button"
                role="option"
                aria-selected={index === selectedIndex}
                onMouseEnter={() => onSelectIndex(index)}
                onClick={() => onRun(item)}
              >
                <span className={`command-item-icon ${item.color ? `color-${item.color}` : ""}`}>
                  {iconFor(item)}
                </span>
                <span className="command-item-copy">
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </span>
                <ChevronRight size={16} />
              </button>
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
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
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
