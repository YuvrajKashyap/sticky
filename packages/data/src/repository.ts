import type {
  ActorContext,
  CreateListInput,
  CreateReminderInput,
  CreateTaskInput,
  ListDto,
  ReminderDto,
  TaskDto,
  UpdateListInput,
  UpdateTaskInput,
} from "@sticky/contracts";
import { assertVersion, conflict, StickyDomainError } from "@sticky/domain";
import type { StickySupabaseClient } from "./client";
import { mapListRow, mapReminderRow, mapTaskRow, type DataRow } from "./mappers";

type QueryError = { code?: string; message: string; details?: string | null };

function throwQuery(error: QueryError | null, fallback = "Sticky could not save that change."): void {
  if (!error) return;
  if (error.code === "23505") throw conflict("That item already exists.", { database: error.details });
  throw new StickyDomainError("internal_error", fallback, 500, { databaseCode: error.code });
}

function activity(actor: ActorContext, action: string, taskId?: string, listId?: string, metadata: Record<string, unknown> = {}) {
  return {
    user_id: actor.userId,
    task_id: taskId ?? null,
    list_id: listId ?? null,
    action,
    metadata,
    actor_type: actor.actorType,
    actor_id: actor.actorId,
    credential_id: actor.credentialId,
    source: actor.actorType === "human" ? "web" : actor.actorType,
    request_id: actor.requestId,
    idempotency_key: actor.idempotencyKey,
  };
}

export class StickyRepository {
  constructor(private readonly db: StickySupabaseClient) {}

  async listLists(actor: ActorContext, includeArchived = false): Promise<ListDto[]> {
    let query = this.db.from("lists").select("*").eq("user_id", actor.userId).order("sort_order");
    if (!includeArchived) query = query.is("archived_at", null);
    const { data, error } = await query;
    throwQuery(error);
    return ((data ?? []) as DataRow[]).map(mapListRow);
  }

  async createList(actor: ActorContext, input: CreateListInput): Promise<ListDto> {
    const sortOrder = input.sortOrder ?? (await this.nextOrder("lists", actor.userId));
    const { data, error } = await this.db.from("lists").insert({
      id: input.id,
      user_id: actor.userId,
      name: input.name,
      color: input.color,
      sort_order: sortOrder,
    }).select("*").single();
    throwQuery(error);
    const list = mapListRow(data as DataRow);
    await this.writeActivity(activity(actor, "list.created", undefined, list.id));
    return list;
  }

  async updateList(actor: ActorContext, id: string, input: UpdateListInput): Promise<ListDto> {
    const current = await this.getList(actor, id);
    assertVersion(input.version, current.version, "List");
    const values: Record<string, unknown> = {};
    if (input.name !== undefined) values.name = input.name;
    if (input.color !== undefined) values.color = input.color;
    if (input.isVisibleOnBoard !== undefined) values.is_visible_on_board = input.isVisibleOnBoard;
    if (input.archived !== undefined) values.archived_at = input.archived ? new Date().toISOString() : null;
    const { data, error } = await this.db.from("lists").update(values)
      .eq("id", id).eq("user_id", actor.userId).eq("version", input.version).select("*").maybeSingle();
    throwQuery(error);
    if (!data) throw conflict("List changed somewhere else. Refresh and try again.");
    const list = mapListRow(data as DataRow);
    await this.writeActivity(activity(actor, input.archived ? "list.archived" : "list.updated", undefined, id));
    return list;
  }

  async deleteList(actor: ActorContext, id: string): Promise<void> {
    await this.getList(actor, id);
    const { error } = await this.db.from("lists").delete().eq("id", id).eq("user_id", actor.userId);
    throwQuery(error);
    await this.writeActivity(activity(actor, "list.deleted", undefined, undefined, { deletedListId: id }));
  }

  async getList(actor: ActorContext, id: string): Promise<ListDto> {
    const { data, error } = await this.db.from("lists").select("*").eq("id", id).eq("user_id", actor.userId).maybeSingle();
    throwQuery(error);
    if (!data) throw new StickyDomainError("not_found", "List not found.", 404);
    return mapListRow(data as DataRow);
  }

  async listTasks(actor: ActorContext, options: { listId?: string; query?: string; includeCompleted?: boolean } = {}): Promise<TaskDto[]> {
    let query = this.db.from("tasks").select("*").eq("user_id", actor.userId)
      .order("is_completed").order("sort_order").order("created_at");
    if (options.listId) query = query.eq("list_id", options.listId);
    if (!options.includeCompleted) query = query.eq("is_completed", false);
    if (options.query) query = query.or(`title.ilike.%${options.query.replace(/[,%()]/g, "")}%,details.ilike.%${options.query.replace(/[,%()]/g, "")}%`);
    const { data, error } = await query;
    throwQuery(error);
    return ((data ?? []) as DataRow[]).map(mapTaskRow);
  }

  async getTask(actor: ActorContext, id: string): Promise<TaskDto> {
    const { data, error } = await this.db.from("tasks").select("*").eq("id", id).eq("user_id", actor.userId).maybeSingle();
    throwQuery(error);
    if (!data) throw new StickyDomainError("not_found", "Task not found.", 404);
    return mapTaskRow(data as DataRow);
  }

  async createTask(actor: ActorContext, input: CreateTaskInput): Promise<TaskDto> {
    await this.getList(actor, input.listId);
    const sortOrder = input.sortOrder ?? (await this.nextOrder("tasks", actor.userId, input.listId));
    const { data, error } = await this.db.from("tasks").insert({
      id: input.id,
      user_id: actor.userId,
      list_id: input.listId,
      title: input.title,
      details: input.details,
      color: input.color,
      due_date: input.dueDate,
      due_time: input.dueTime,
      timezone: input.timezone,
      sort_order: sortOrder,
    }).select("*").single();
    throwQuery(error);
    const task = mapTaskRow(data as DataRow);
    await this.writeActivity(activity(actor, "task.created", task.id, task.listId));
    return task;
  }

  async updateTask(actor: ActorContext, id: string, input: UpdateTaskInput): Promise<TaskDto> {
    const current = await this.getTask(actor, id);
    assertVersion(input.version, current.version, "Task");
    const values: Record<string, unknown> = {};
    if (input.title !== undefined) values.title = input.title;
    if (input.details !== undefined) values.details = input.details;
    if (input.color !== undefined) values.color = input.color;
    if (input.dueDate !== undefined) values.due_date = input.dueDate;
    if (input.dueTime !== undefined) values.due_time = input.dueTime;
    if (input.timezone !== undefined) values.timezone = input.timezone;
    const { data, error } = await this.db.from("tasks").update(values)
      .eq("id", id).eq("user_id", actor.userId).eq("version", input.version).select("*").maybeSingle();
    throwQuery(error);
    if (!data) throw conflict("Task changed somewhere else. Refresh and try again.");
    const task = mapTaskRow(data as DataRow);
    await this.writeActivity(activity(actor, "task.updated", id, task.listId));
    return task;
  }

  async moveTask(actor: ActorContext, id: string, targetListId: string, version: number): Promise<TaskDto> {
    const current = await this.getTask(actor, id);
    assertVersion(version, current.version, "Task");
    await this.getList(actor, targetListId);
    const sortOrder = await this.nextOrder("tasks", actor.userId, targetListId);
    const { data, error } = await this.db.from("tasks").update({ list_id: targetListId, sort_order: sortOrder })
      .eq("id", id).eq("user_id", actor.userId).eq("version", version).select("*").maybeSingle();
    throwQuery(error);
    if (!data) throw conflict("Task changed somewhere else. Refresh and try again.");
    const task = mapTaskRow(data as DataRow);
    await this.writeActivity(activity(actor, "task.moved", id, targetListId, { fromListId: current.listId }));
    return task;
  }

  async setTaskCompleted(actor: ActorContext, id: string, completed: boolean, version: number): Promise<TaskDto> {
    const current = await this.getTask(actor, id);
    assertVersion(version, current.version, "Task");
    const values = completed
      ? { is_completed: true, completed_at: new Date().toISOString(), completed_sort_order: Date.now() }
      : { is_completed: false, completed_at: null, completed_sort_order: null, sort_order: await this.nextOrder("tasks", actor.userId, current.listId) };
    const { data, error } = await this.db.from("tasks").update(values)
      .eq("id", id).eq("user_id", actor.userId).eq("version", version).select("*").maybeSingle();
    throwQuery(error);
    if (!data) throw conflict("Task changed somewhere else. Refresh and try again.");
    const task = mapTaskRow(data as DataRow);
    await this.writeActivity(activity(actor, completed ? "task.completed" : "task.restored", id, task.listId));
    return task;
  }

  async deleteTask(actor: ActorContext, id: string): Promise<void> {
    const task = await this.getTask(actor, id);
    const { error } = await this.db.from("tasks").delete().eq("id", id).eq("user_id", actor.userId);
    throwQuery(error);
    await this.writeActivity(activity(actor, "task.deleted", undefined, undefined, {
      deletedTaskId: id,
      listId: task.listId,
    }));
  }

  async createSubtask(actor: ActorContext, taskId: string, input: { id?: string; title: string; sortOrder?: number }): Promise<DataRow> {
    await this.getTask(actor, taskId);
    const { data, error } = await this.db.from("subtasks").insert({
      id: input.id,
      user_id: actor.userId,
      task_id: taskId,
      title: input.title,
      sort_order: input.sortOrder ?? (await this.nextOrder("subtasks", actor.userId, taskId)),
    }).select("*").single();
    throwQuery(error);
    await this.writeActivity(activity(actor, "subtask.created", taskId, undefined, { subtaskId: (data as DataRow).id }));
    return data as DataRow;
  }

  async createReminder(actor: ActorContext, taskId: string, input: CreateReminderInput, remindAt: Date): Promise<ReminderDto> {
    await this.getTask(actor, taskId);
    const { data, error } = await this.db.from("task_reminders").insert({
      user_id: actor.userId,
      task_id: taskId,
      kind: input.kind,
      remind_at: remindAt.toISOString(),
      relative_minutes: input.kind === "relative" ? input.relativeMinutes : null,
      channels: input.channels,
    }).select("*").single();
    throwQuery(error);
    const reminder = mapReminderRow(data as DataRow);
    await this.writeActivity(activity(actor, "reminder.created", taskId, undefined, { reminderId: reminder.id }));
    return reminder;
  }

  async listReminders(actor: ActorContext, taskId?: string): Promise<ReminderDto[]> {
    let query = this.db.from("task_reminders").select("*").eq("user_id", actor.userId).order("remind_at");
    if (taskId) query = query.eq("task_id", taskId);
    const { data, error } = await query;
    throwQuery(error);
    return ((data ?? []) as DataRow[]).map(mapReminderRow);
  }

  async snoozeReminder(actor: ActorContext, id: string, version: number, remindAt: string): Promise<ReminderDto> {
    const { data, error } = await this.db.from("task_reminders").update({ remind_at: remindAt, status: "scheduled", workflow_run_id: null })
      .eq("id", id).eq("user_id", actor.userId).eq("version", version).select("*").maybeSingle();
    throwQuery(error);
    if (!data) throw conflict("Reminder changed somewhere else. Refresh and try again.");
    const reminder = mapReminderRow(data as DataRow);
    await this.writeActivity(activity(actor, "reminder.snoozed", reminder.taskId, undefined, { reminderId: id }));
    return reminder;
  }

  private async nextOrder(table: "lists" | "tasks" | "subtasks", userId: string, parentId?: string): Promise<number> {
    let query = this.db.from(table).select("sort_order").eq("user_id", userId).order("sort_order", { ascending: false }).limit(1);
    if (table === "tasks" && parentId) query = query.eq("list_id", parentId).eq("is_completed", false);
    if (table === "subtasks" && parentId) query = query.eq("task_id", parentId);
    const { data, error } = await query;
    throwQuery(error);
    return Number((data?.[0] as DataRow | undefined)?.sort_order ?? 0) + 1000;
  }

  private async writeActivity(values: Record<string, unknown>): Promise<void> {
    const { error } = await this.db.from("task_activity").insert(values);
    throwQuery(error, "Sticky saved the change but could not write its audit event.");
  }

}
