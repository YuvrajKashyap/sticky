import type { StickyTask } from "@/types/sticky";

type OrderableTask = Pick<
  StickyTask,
  "id" | "dueDate" | "dueTime" | "sortOrder" | "createdAt"
>;

function normalizedDueTime(task: Pick<OrderableTask, "dueDate" | "dueTime">) {
  if (!task.dueDate || !task.dueTime) {
    return null;
  }

  return task.dueTime.slice(0, 5);
}

export function taskDueGroupKey(task: Pick<OrderableTask, "dueDate" | "dueTime">) {
  return `${task.dueDate ?? "undated"}::${normalizedDueTime(task) ?? "no-time"}`;
}

export function tasksShareDueGroup(
  first: Pick<OrderableTask, "dueDate" | "dueTime">,
  second: Pick<OrderableTask, "dueDate" | "dueTime">,
) {
  return taskDueGroupKey(first) === taskDueGroupKey(second);
}

export function compareTasksByDueSchedule<T extends OrderableTask>(first: T, second: T) {
  const firstDate = first.dueDate ?? "9999-12-31";
  const secondDate = second.dueDate ?? "9999-12-31";
  const dateDifference = firstDate.localeCompare(secondDate);

  if (dateDifference) {
    return dateDifference;
  }

  const firstTime = normalizedDueTime(first) ?? "23:59:59";
  const secondTime = normalizedDueTime(second) ?? "23:59:59";

  return (
    firstTime.localeCompare(secondTime) ||
    first.sortOrder - second.sortOrder ||
    first.createdAt.localeCompare(second.createdAt)
  );
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

  const groupIndexes: number[] = [];
  const groupTasks: T[] = [];

  customOrderedTasks.forEach((item, index) => {
    if (tasksShareDueGroup(item, task)) {
      groupIndexes.push(index);
      groupTasks.push(item);
    }
  });

  const oldIndex = groupTasks.findIndex((item) => item.id === taskId);
  const newIndex = groupTasks.findIndex((item) => item.id === relativeToTaskId);

  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) {
    return customOrderedTasks;
  }

  const reorderedGroup = groupTasks.slice();
  const [movedTask] = reorderedGroup.splice(oldIndex, 1);
  reorderedGroup.splice(newIndex, 0, movedTask);

  const reorderedTasks = customOrderedTasks.slice();
  groupIndexes.forEach((taskIndex, groupIndex) => {
    reorderedTasks[taskIndex] = reorderedGroup[groupIndex];
  });

  return reorderedTasks;
}
