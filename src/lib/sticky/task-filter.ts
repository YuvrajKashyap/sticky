import type { RecurrenceFrequency, StickySubtask, StickyTask, StickyTaskViewFilter } from "@/types/sticky";

type FilterItem = Pick<StickyTask, "id" | "title" | "dueDate" | "isCompleted"> & { details?: string; dueTime?: string | null };

export function itemMatchesView(item: FilterItem, frequency: RecurrenceFrequency | null, filter: StickyTaskViewFilter, today: string, isChild = false) {
  if (item.isCompleted) return false;
  switch (filter) {
    case "due": return Boolean(item.dueDate);
    case "undated": return !item.dueDate;
    case "overdue": return Boolean(item.dueDate && item.dueDate < today);
    case "today": return frequency !== "daily" && item.dueDate === today;
    case "all_today": return item.dueDate === today;
    case "daily": return frequency === "daily" && item.dueDate === today;
    case "recurring": return frequency !== null;
    case "subtasks": return isChild;
    default: return true;
  }
}

export function matchingTaskItems(task: StickyTask, children: StickySubtask[], frequency: RecurrenceFrequency | null, filter: StickyTaskViewFilter, today: string, search = ""): FilterItem[] {
  const query = search.trim().toLowerCase();
  const matchesSearch = (item: FilterItem) => !query || `${item.title} ${item.details ?? ""}`.toLowerCase().includes(query);
  return [
    ...(itemMatchesView(task, frequency, filter, today) && matchesSearch(task) ? [task] : []),
    ...children.filter(child => itemMatchesView(child, null, filter, today, true) && matchesSearch(child)),
  ];
}

export type CalendarTaskItem = StickyTask & { parentTaskId?: string; parentTitle?: string };

export function calendarTaskItems(tasks: StickyTask[], children: StickySubtask[]): CalendarTaskItem[] {
  const parents = new Map(tasks.map(task => [task.id, task]));
  return [
    ...tasks.filter(task => task.dueDate),
    ...children.flatMap(child => {
      const parent = parents.get(child.taskId);
      return parent && child.dueDate ? [{ ...parent, ...child, dueTime: null, details: "", completedSortOrder: null, parentTaskId: parent.id, parentTitle: parent.title }] : [];
    }),
  ];
}
