import type { CalendarDto, CalendarEventDto, ListDto, RecurrenceRuleDto, ReminderDto, SubtaskDto, TaskDto } from "@sticky/contracts";

export type DataRow = Record<string, unknown>;

export function mapListRow(row: DataRow): ListDto {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    name: String(row.name),
    color: row.color as ListDto["color"],
    sortOrder: Number(row.sort_order),
    isVisibleOnBoard: row.is_visible_on_board !== false,
    archivedAt: row.archived_at ? String(row.archived_at) : null,
    version: Number(row.version ?? 1),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapTaskRow(row: DataRow): TaskDto {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    listId: String(row.list_id),
    title: String(row.title),
    details: String(row.details ?? ""),
    color: row.color as TaskDto["color"],
    dueDate: row.due_date ? String(row.due_date) : null,
    dueTime: row.due_time ? String(row.due_time) : null,
    timezone: String(row.timezone),
    isCompleted: Boolean(row.is_completed),
    completedAt: row.completed_at ? String(row.completed_at) : null,
    sortOrder: Number(row.sort_order),
    completedSortOrder: row.completed_sort_order == null ? null : Number(row.completed_sort_order),
    version: Number(row.version ?? 1),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapSubtaskRow(row: DataRow): SubtaskDto {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    taskId: String(row.task_id),
    title: String(row.title),
    dueDate: row.due_date ? String(row.due_date) : null,
    isCompleted: Boolean(row.is_completed),
    completedAt: row.completed_at ? String(row.completed_at) : null,
    sortOrder: Number(row.sort_order),
    version: Number(row.version ?? 1),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapRecurrenceRuleRow(row: DataRow): RecurrenceRuleDto {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    taskId: String(row.task_id),
    frequency: row.frequency as RecurrenceRuleDto["frequency"],
    intervalCount: Number(row.interval_count),
    daysOfWeek: Array.isArray(row.days_of_week) ? row.days_of_week.map(Number) : [],
    monthDay: row.month_day == null ? null : Number(row.month_day),
    startsOn: String(row.starts_on),
    endType: row.end_type as RecurrenceRuleDto["endType"],
    endDate: row.end_date ? String(row.end_date) : null,
    occurrenceCount: row.occurrence_count == null ? null : Number(row.occurrence_count),
    timezone: String(row.timezone),
    paused: Boolean(row.paused),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapReminderRow(row: DataRow): ReminderDto {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    kind: row.kind as ReminderDto["kind"],
    remindAt: String(row.remind_at),
    relativeMinutes: row.relative_minutes == null ? null : Number(row.relative_minutes),
    channels: row.channels as ReminderDto["channels"],
    status: row.status as ReminderDto["status"],
    version: Number(row.version ?? 1),
  };
}

export function mapCalendarRow(row: DataRow): CalendarDto {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    name: String(row.name),
    color: row.color as CalendarDto["color"],
    timezone: String(row.timezone),
    isDefault: Boolean(row.is_default),
    isVisible: row.is_visible !== false,
    archivedAt: row.archived_at ? String(row.archived_at) : null,
    version: Number(row.version ?? 1),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapCalendarEventRow(row: DataRow): CalendarEventDto {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    calendarId: String(row.calendar_id),
    taskId: row.task_id ? String(row.task_id) : null,
    title: String(row.title),
    details: String(row.details ?? ""),
    location: String(row.location ?? ""),
    allDay: Boolean(row.all_day),
    startAt: row.start_at ? String(row.start_at) : null,
    endAt: row.end_at ? String(row.end_at) : null,
    startDate: row.start_date ? String(row.start_date) : null,
    endDate: row.end_date ? String(row.end_date) : null,
    timezone: String(row.timezone),
    recurrence: Array.isArray(row.recurrence) ? row.recurrence.map(String) : [],
    status: row.status as CalendarEventDto["status"],
    transparency: row.transparency as CalendarEventDto["transparency"],
    color: row.color ? row.color as CalendarEventDto["color"] : null,
    version: Number(row.version ?? 1),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
