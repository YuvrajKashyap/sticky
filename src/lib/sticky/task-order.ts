import type { StickyTask } from "@/types/sticky";

type OrderableTask = Pick<
  StickyTask,
  "id" | "dueDate" | "dueTime" | "sortOrder" | "createdAt"
>;

export type DueSchedule = {
  dueDate: string | null;
  dueTime?: string | null;
};

function normalizedDueTime(task: DueSchedule) {
  if (!task.dueDate || !task.dueTime) {
    return null;
  }

  return task.dueTime.slice(0, 5);
}

export function dueScheduleGroupKey(task: DueSchedule) {
  return `${task.dueDate ?? "undated"}::${normalizedDueTime(task) ?? "no-time"}`;
}

export function taskDueGroupKey(task: Pick<OrderableTask, "dueDate" | "dueTime">) {
  return dueScheduleGroupKey(task);
}

export function tasksShareDueGroup(
  first: Pick<OrderableTask, "dueDate" | "dueTime">,
  second: Pick<OrderableTask, "dueDate" | "dueTime">,
) {
  return taskDueGroupKey(first) === taskDueGroupKey(second);
}

export function compareTasksByDueSchedule<T extends OrderableTask>(first: T, second: T) {
  return (
    compareDueSchedules(first, second) ||
    first.sortOrder - second.sortOrder ||
    first.createdAt.localeCompare(second.createdAt)
  );
}

export function compareDueSchedules(first: DueSchedule, second: DueSchedule) {
  const firstDate = first.dueDate ?? "9999-12-31";
  const secondDate = second.dueDate ?? "9999-12-31";
  const dateDifference = firstDate.localeCompare(secondDate);

  if (dateDifference) {
    return dateDifference;
  }

  const firstTime = normalizedDueTime(first) ?? "23:59:59";
  const secondTime = normalizedDueTime(second) ?? "23:59:59";

  return firstTime.localeCompare(secondTime);
}

/**
 * Moves two visible items relative to each other while leaving hidden items in
 * their existing slots. The returned list is still complete, which keeps the
 * transactional reorder RPC safe in filtered views.
 */
export function reorderItemsWithinVisibleSubset<T extends { id: string }>(
  completeOrder: T[],
  visibleItemIds: Iterable<string>,
  itemId: string,
  relativeToItemId: string,
) {
  const visibleIds = new Set(visibleItemIds);

  if (!visibleIds.has(itemId) || !visibleIds.has(relativeToItemId)) {
    return null;
  }

  const visibleIndexes: number[] = [];
  const visibleItems: T[] = [];

  completeOrder.forEach((item, index) => {
    if (visibleIds.has(item.id)) {
      visibleIndexes.push(index);
      visibleItems.push(item);
    }
  });

  const oldIndex = visibleItems.findIndex((item) => item.id === itemId);
  const newIndex = visibleItems.findIndex((item) => item.id === relativeToItemId);

  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) {
    return completeOrder;
  }

  const reorderedVisibleItems = visibleItems.slice();
  const [movedItem] = reorderedVisibleItems.splice(oldIndex, 1);
  reorderedVisibleItems.splice(newIndex, 0, movedItem);

  const reorderedItems = completeOrder.slice();
  visibleIndexes.forEach((itemIndex, visibleIndex) => {
    reorderedItems[itemIndex] = reorderedVisibleItems[visibleIndex];
  });

  return reorderedItems;
}

/**
 * Reorders one exact due-date/time group while retaining every other task's
 * custom-order slot. Passing the complete custom-ordered list keeps the
 * persisted order valid for both the UI and the reorder_tasks RPC.
 */
export function reorderTasksWithinDueGroup<T extends OrderableTask>(
  customOrderedTasks: T[],
  taskId: string,
  relativeToTaskId: string,
) {
  const task = customOrderedTasks.find((item) => item.id === taskId);
  const relativeToTask = customOrderedTasks.find((item) => item.id === relativeToTaskId);

  if (!task || !relativeToTask || !tasksShareDueGroup(task, relativeToTask)) {
    return null;
  }

  return reorderItemsWithinVisibleSubset(
    customOrderedTasks,
    customOrderedTasks.filter((item) => tasksShareDueGroup(item, task)).map((item) => item.id),
    taskId,
    relativeToTaskId,
  );
}
