import type { ListDto, ReminderDto, TaskDto } from "@sticky/contracts";

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
