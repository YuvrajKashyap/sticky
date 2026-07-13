import type {
  DbList,
  DbRecurrenceRule,
  DbSubtask,
  DbTask,
  DbUser,
  DbUserPreferences,
  DbUserState,
  StickyList,
  StickyPreferences,
  StickyRecurrenceRule,
  StickySubtask,
  StickyTask,
  StickyUser,
  StickyUserState,
} from "@/types/sticky";

export function mapUser(row: DbUser): StickyUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
  };
}

export function mapList(row: DbList): StickyList {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    color: row.color,
    sortOrder: row.sort_order,
    isVisibleOnBoard: row.is_visible_on_board ?? true,
    archivedAt: row.archived_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapTask(row: DbTask): StickyTask {
  return {
    id: row.id,
    userId: row.user_id,
    listId: row.list_id,
    title: row.title,
    details: row.details,
    color: row.color,
    dueDate: row.due_date,
    dueTime: row.due_time,
    timezone: row.timezone,
    isCompleted: row.is_completed,
    completedAt: row.completed_at,
    sortOrder: row.sort_order,
    completedSortOrder: row.completed_sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapSubtask(row: DbSubtask): StickySubtask {
  return {
    id: row.id,
    userId: row.user_id,
    taskId: row.task_id,
    title: row.title,
    isCompleted: row.is_completed,
    completedAt: row.completed_at,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapRecurrenceRule(row: DbRecurrenceRule): StickyRecurrenceRule {
  return {
    id: row.id,
    userId: row.user_id,
    taskId: row.task_id,
    frequency: row.frequency,
    intervalCount: row.interval_count,
    daysOfWeek: row.days_of_week ?? [],
    monthDay: row.month_day,
    startsOn: row.starts_on,
    endType: row.end_type,
    endDate: row.end_date,
    occurrenceCount: row.occurrence_count,
    timezone: row.timezone,
    paused: row.paused,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapPreferences(row: DbUserPreferences | null): StickyPreferences {
  return {
    completedOpenByList: row?.completed_open_by_list ?? {},
    density: row?.density ?? "comfortable",
    colorMode: row?.color_mode === "dark" ? "dark" : "light",
    boardStyle: row?.board_style ?? "pad",
    taskViewFilter: row?.task_view_filter ?? "all",
    taskSortMode: row?.task_sort_mode ?? "custom",
  };
}

export function mapUserState(row: DbUserState | null): StickyUserState {
  return {
    selectedListId: row?.selected_list_id ?? null,
    searchQuery: row?.search_query ?? "",
  };
}

export function listToDb(list: Partial<StickyList>) {
  return {
    name: list.name,
    color: list.color,
    sort_order: list.sortOrder,
    is_visible_on_board: list.isVisibleOnBoard,
    archived_at: list.archivedAt,
  };
}

export function taskToDb(task: Partial<StickyTask>) {
  return {
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
  };
}

export function subtaskToDb(subtask: Partial<StickySubtask>) {
  return {
    task_id: subtask.taskId,
    title: subtask.title,
    is_completed: subtask.isCompleted,
    completed_at: subtask.completedAt,
    sort_order: subtask.sortOrder,
  };
}

export function recurrenceToDb(rule: Partial<StickyRecurrenceRule>) {
  return {
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
  };
}
