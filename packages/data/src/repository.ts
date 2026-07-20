import type {
  ActorContext,
  CalendarDto,
  CalendarEventDto,
  CalendarRangeInput,
  CreateCalendarEventInput,
  CreateListInput,
  CreateReminderInput,
  CreateSubtaskInput,
  CreateTaskInput,
  ListDto,
  RecurrenceRuleDto,
  RecurrenceScheduleInput,
  ReminderDto,
  SubtaskDto,
  TaskDto,
  TimeBlockTaskInput,
  UpdateCalendarEventInput,
  UpdateListInput,
  UpdateSubtaskInput,
  UpdateTaskInput,
} from "@sticky/contracts";
import { assertVersion, conflict, nextOccurrenceCount, nextRecurrenceDate, StickyDomainError } from "@sticky/domain";
import type { StickySupabaseClient } from "./client";
import { mapCalendarEventRow, mapCalendarRow, mapListRow, mapRecurrenceRuleRow, mapReminderRow, mapSubtaskRow, mapTaskRow, type DataRow } from "./mappers";

type QueryError = { code?: string; message: string; details?: string | null };

function throwQuery(error: QueryError | null, fallback = "Sticky could not save that change."): void {
  if (!error) return;
  if (error.code === "23505") throw conflict("That item already exists.", { database: error.details });
  if (error.code === "22023") throw new StickyDomainError("validation_error", error.message, 422);
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

  async reorderLists(actor: ActorContext, listIds: string[]): Promise<ListDto[]> {
    const currentLists = await this.listLists(actor);
    const currentIds = new Set(currentLists.map((list) => list.id));
    const requestedIds = new Set(listIds);
    if (listIds.length !== currentIds.size || requestedIds.size !== currentIds.size || listIds.some((id) => !currentIds.has(id))) {
      throw new StickyDomainError(
        "validation_error",
        "List order must include every active Sticky list exactly once.",
        422,
      );
    }

    const { error } = await this.db.rpc("reorder_lists", {
      p_list_ids: listIds,
      p_request_user_id: actor.userId,
    });
    throwQuery(error, "Sticky could not reorder those lists.");
    await this.writeActivity(activity(actor, "lists.reordered", undefined, undefined, { listIds }));
    return this.listLists(actor);
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

  async createTaskWithSubtasks(
    actor: ActorContext,
    input: CreateTaskInput & { subtasks: Array<{ title: string; dueDate: string | null }> },
  ): Promise<{ task: TaskDto; subtasks: SubtaskDto[] }> {
    await this.getList(actor, input.listId);
    const { data, error } = await this.db.rpc("create_task_with_subtasks", {
      p_list_id: input.listId,
      p_title: input.title,
      p_details: input.details,
      p_color: input.color,
      p_due_date: input.dueDate,
      p_due_time: input.dueTime,
      p_timezone: input.timezone,
      p_subtasks: input.subtasks,
      p_request_user_id: actor.userId,
    });
    throwQuery(error);
    const taskId = String(data);
    const task = await this.getTask(actor, taskId);
    const subtasks = await this.listSubtasks(actor, taskId, true);
    await this.writeActivity(activity(actor, "task.created", task.id, task.listId, { subtaskCount: subtasks.length }));
    return { task, subtasks };
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
      ? { is_completed: true, completed_at: new Date().toISOString(), completed_sort_order: await this.nextCompletedOrder(actor.userId, current.listId) }
      : { is_completed: false, completed_at: null, completed_sort_order: null, sort_order: await this.nextOrder("tasks", actor.userId, current.listId) };
    const { data, error } = await this.db.from("tasks").update(values)
      .eq("id", id).eq("user_id", actor.userId).eq("version", version).select("*").maybeSingle();
    throwQuery(error);
    if (!data) throw conflict("Task changed somewhere else. Refresh and try again.");
    const task = mapTaskRow(data as DataRow);
    await this.writeActivity(activity(actor, completed ? "task.completed" : "task.restored", id, task.listId));
    return task;
  }

  async completeTaskWithRecurrence(
    actor: ActorContext,
    id: string,
    version: number,
  ): Promise<{ task: TaskDto; nextTask: TaskDto | null; recurrence: RecurrenceRuleDto | null }> {
    const task = await this.getTask(actor, id);
    assertVersion(version, task.version, "Task");
    const recurrence = await this.getTaskRecurrence(actor, id);
    if (!recurrence) {
      return { task: await this.setTaskCompleted(actor, id, true, version), nextTask: null, recurrence: null };
    }

    const nextDueDate = nextRecurrenceDate(recurrence, task);
    const nextTaskId = nextDueDate ? crypto.randomUUID() : null;
    const nextCount = nextDueDate ? nextOccurrenceCount(recurrence) : null;
    const { error } = await this.db.rpc("complete_task_with_recurrence", {
      p_task_id: id,
      p_next_task_id: nextTaskId,
      p_next_due_date: nextDueDate,
      p_next_due_time: nextDueDate ? task.dueTime : null,
      p_next_occurrence_count: nextCount,
      p_request_user_id: actor.userId,
    });
    throwQuery(error, "Sticky could not complete that recurring task.");
    const completedTask = await this.getTask(actor, id);
    const nextTask = nextTaskId ? await this.getTask(actor, nextTaskId) : null;
    const nextRule = nextTaskId ? await this.getTaskRecurrence(actor, nextTaskId) : recurrence;
    await this.writeActivity(activity(actor, "task.completed", id, task.listId, {
      recurring: true,
      nextTaskId,
      nextDueDate,
    }));
    return { task: completedTask, nextTask, recurrence: nextRule };
  }

  async listTaskRecurrenceRules(actor: ActorContext, taskId?: string): Promise<RecurrenceRuleDto[]> {
    let query = this.db.from("task_recurrence_rules").select("*").eq("user_id", actor.userId).order("created_at");
    if (taskId) query = query.eq("task_id", taskId);
    const { data, error } = await query;
    throwQuery(error);
    return ((data ?? []) as DataRow[]).map(mapRecurrenceRuleRow);
  }

  async getTaskRecurrence(actor: ActorContext, taskId: string): Promise<RecurrenceRuleDto | null> {
    const { data, error } = await this.db.from("task_recurrence_rules").select("*")
      .eq("task_id", taskId).eq("user_id", actor.userId).maybeSingle();
    throwQuery(error);
    return data ? mapRecurrenceRuleRow(data as DataRow) : null;
  }

  async setTaskRecurrence(
    actor: ActorContext,
    taskId: string,
    input: RecurrenceScheduleInput,
    dueTime?: string | null,
  ): Promise<RecurrenceRuleDto> {
    const task = await this.getTask(actor, taskId);
    if (task.isCompleted) {
      throw new StickyDomainError("validation_error", "Restore the task before adding recurrence.", 422);
    }
    const subtasks = await this.listSubtasks(actor, taskId, true);
    if (subtasks.length > 0) {
      throw new StickyDomainError(
        "validation_error",
        "Repeating Sticky tasks cannot have subtasks. Remove the subtasks before adding recurrence.",
        422,
      );
    }

    const nextDueTime = dueTime === undefined ? task.dueTime : dueTime;
    if (task.dueDate !== input.startsOn || task.dueTime !== nextDueTime || task.timezone !== input.timezone) {
      const { data: scheduledTask, error: scheduleError } = await this.db.from("tasks").update({
        due_date: input.startsOn,
        due_time: nextDueTime,
        timezone: input.timezone,
      }).eq("id", taskId).eq("user_id", actor.userId).eq("version", task.version).select("id").maybeSingle();
      throwQuery(scheduleError, "Sticky could not schedule the first occurrence.");
      if (!scheduledTask) throw conflict("Task changed somewhere else. Refresh and try again.");
    }

    const existing = await this.getTaskRecurrence(actor, taskId);
    const values = {
      user_id: actor.userId,
      task_id: taskId,
      frequency: input.frequency,
      interval_count: input.intervalCount,
      days_of_week: input.daysOfWeek,
      month_day: input.monthDay,
      starts_on: input.startsOn,
      end_type: input.endType,
      end_date: input.endDate,
      occurrence_count: input.occurrenceCount,
      timezone: input.timezone,
      paused: input.paused,
    };
    const result = existing
      ? await this.db.from("task_recurrence_rules").update(values)
        .eq("id", existing.id).eq("user_id", actor.userId).select("*").single()
      : await this.db.from("task_recurrence_rules").insert(values).select("*").single();
    throwQuery(result.error, "Sticky could not save that recurrence.");
    const rule = mapRecurrenceRuleRow(result.data as DataRow);
    await this.writeActivity(activity(actor, existing ? "recurrence.updated" : "recurrence.created", taskId, task.listId, {
      frequency: rule.frequency,
      intervalCount: rule.intervalCount,
    }));
    return rule;
  }

  async setTaskRecurrencePaused(actor: ActorContext, taskId: string, paused: boolean): Promise<RecurrenceRuleDto> {
    const task = await this.getTask(actor, taskId);
    const existing = await this.getTaskRecurrence(actor, taskId);
    if (!existing) throw new StickyDomainError("not_found", "That task does not have a recurrence rule.", 404);
    const { data, error } = await this.db.from("task_recurrence_rules").update({ paused })
      .eq("id", existing.id).eq("user_id", actor.userId).select("*").single();
    throwQuery(error, "Sticky could not change that recurrence.");
    const rule = mapRecurrenceRuleRow(data as DataRow);
    await this.writeActivity(activity(actor, paused ? "recurrence.paused" : "recurrence.resumed", taskId, task.listId));
    return rule;
  }

  async removeTaskRecurrence(actor: ActorContext, taskId: string): Promise<void> {
    const task = await this.getTask(actor, taskId);
    const existing = await this.getTaskRecurrence(actor, taskId);
    if (!existing) throw new StickyDomainError("not_found", "That task does not have a recurrence rule.", 404);
    const { error } = await this.db.from("task_recurrence_rules").delete()
      .eq("id", existing.id).eq("user_id", actor.userId);
    throwQuery(error, "Sticky could not remove that recurrence.");
    await this.writeActivity(activity(actor, "recurrence.deleted", taskId, task.listId));
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

  async listSubtasks(actor: ActorContext, taskId?: string, includeCompleted = true): Promise<SubtaskDto[]> {
    let query = this.db.from("subtasks").select("*").eq("user_id", actor.userId)
      .order("sort_order").order("created_at");
    if (taskId) query = query.eq("task_id", taskId);
    if (!includeCompleted) query = query.eq("is_completed", false);
    const { data, error } = await query;
    throwQuery(error);
    return ((data ?? []) as DataRow[]).map(mapSubtaskRow);
  }

  async getSubtask(actor: ActorContext, id: string): Promise<SubtaskDto> {
    const { data, error } = await this.db.from("subtasks").select("*")
      .eq("id", id).eq("user_id", actor.userId).maybeSingle();
    throwQuery(error);
    if (!data) throw new StickyDomainError("not_found", "Subtask not found.", 404);
    return mapSubtaskRow(data as DataRow);
  }

  async createSubtask(actor: ActorContext, taskId: string, input: CreateSubtaskInput): Promise<SubtaskDto> {
    await this.getTask(actor, taskId);
    const { data, error } = await this.db.from("subtasks").insert({
      id: input.id,
      user_id: actor.userId,
      task_id: taskId,
      title: input.title,
      due_date: input.dueDate,
      sort_order: input.sortOrder ?? (await this.nextOrder("subtasks", actor.userId, taskId)),
    }).select("*").single();
    throwQuery(error);
    await this.writeActivity(activity(actor, "subtask.created", taskId, undefined, { subtaskId: (data as DataRow).id }));
    return mapSubtaskRow(data as DataRow);
  }

  async updateSubtask(actor: ActorContext, id: string, input: UpdateSubtaskInput): Promise<SubtaskDto> {
    const current = await this.getSubtask(actor, id);
    assertVersion(input.version, current.version, "Subtask");
    const values: Record<string, unknown> = {};
    if (input.title !== undefined) values.title = input.title;
    if (input.dueDate !== undefined) values.due_date = input.dueDate;
    if (!Object.keys(values).length) return current;
    const { data, error } = await this.db.from("subtasks").update(values)
      .eq("id", id).eq("user_id", actor.userId).eq("version", input.version).select("*").maybeSingle();
    throwQuery(error);
    if (!data) throw conflict("Subtask changed somewhere else. Refresh and try again.");
    const subtask = mapSubtaskRow(data as DataRow);
    await this.writeActivity(activity(actor, "subtask.updated", subtask.taskId, undefined, { subtaskId: id }));
    return subtask;
  }

  async setSubtaskCompleted(actor: ActorContext, id: string, completed: boolean, version: number): Promise<SubtaskDto> {
    const current = await this.getSubtask(actor, id);
    assertVersion(version, current.version, "Subtask");
    const { data, error } = await this.db.from("subtasks").update({
      is_completed: completed,
      completed_at: completed ? new Date().toISOString() : null,
    }).eq("id", id).eq("user_id", actor.userId).eq("version", version).select("*").maybeSingle();
    throwQuery(error);
    if (!data) throw conflict("Subtask changed somewhere else. Refresh and try again.");
    const subtask = mapSubtaskRow(data as DataRow);
    await this.writeActivity(activity(actor, completed ? "subtask.completed" : "subtask.restored", subtask.taskId, undefined, { subtaskId: id }));
    return subtask;
  }

  async reorderSubtasks(actor: ActorContext, taskId: string, subtaskIds: string[]): Promise<SubtaskDto[]> {
    await this.getTask(actor, taskId);
    const current = await this.listSubtasks(actor, taskId, true);
    const currentIds = current.map((subtask) => subtask.id);
    const requested = new Set(subtaskIds);
    if (requested.size !== subtaskIds.length || subtaskIds.length !== currentIds.length || currentIds.some((id) => !requested.has(id))) {
      throw new StickyDomainError("validation_error", "Pass every subtask in this task exactly once.", 422);
    }
    const { error } = await this.db.rpc("reorder_subtasks", {
      p_task_id: taskId,
      p_subtask_ids: subtaskIds,
      p_request_user_id: actor.userId,
    });
    throwQuery(error);
    await this.writeActivity(activity(actor, "subtasks.reordered", taskId, undefined, { subtaskIds }));
    return this.listSubtasks(actor, taskId, true);
  }

  async deleteSubtask(actor: ActorContext, id: string): Promise<void> {
    const subtask = await this.getSubtask(actor, id);
    const { error } = await this.db.from("subtasks").delete().eq("id", id).eq("user_id", actor.userId);
    throwQuery(error);
    await this.writeActivity(activity(actor, "subtask.deleted", subtask.taskId, undefined, { deletedSubtaskId: id }));
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

  async listCalendars(actor: ActorContext, includeArchived = false): Promise<CalendarDto[]> {
    let query = this.db.from("calendars").select("*").eq("user_id", actor.userId)
      .order("is_default", { ascending: false }).order("created_at");
    if (!includeArchived) query = query.is("archived_at", null);
    const { data, error } = await query;
    throwQuery(error);
    const calendars = ((data ?? []) as DataRow[]).map(mapCalendarRow);
    return calendars.length || includeArchived ? calendars : [await this.ensureDefaultCalendar(actor)];
  }

  async ensureDefaultCalendar(actor: ActorContext): Promise<CalendarDto> {
    const existing = await this.db.from("calendars").select("*")
      .eq("user_id", actor.userId).eq("is_default", true).is("archived_at", null).maybeSingle();
    throwQuery(existing.error);
    if (existing.data) return mapCalendarRow(existing.data as DataRow);

    const inserted = await this.db.from("calendars").insert({
      user_id: actor.userId,
      name: "Sticky",
      color: "sky",
      timezone: "America/Chicago",
      is_default: true,
    }).select("*").single();
    if (inserted.error?.code === "23505") {
      const retry = await this.db.from("calendars").select("*")
        .eq("user_id", actor.userId).eq("is_default", true).is("archived_at", null).single();
      throwQuery(retry.error);
      return mapCalendarRow(retry.data as DataRow);
    }
    throwQuery(inserted.error);
    return mapCalendarRow(inserted.data as DataRow);
  }

  async createCalendar(actor: ActorContext, input: { name: string; color?: CalendarDto["color"]; timezone?: string }): Promise<CalendarDto> {
    const { data, error } = await this.db.from("calendars").insert({
      user_id: actor.userId,
      name: input.name,
      color: input.color ?? "sky",
      timezone: input.timezone ?? "America/Chicago",
      is_default: false,
    }).select("*").single();
    throwQuery(error);
    const calendar = mapCalendarRow(data as DataRow);
    await this.writeActivity(activity(actor, "calendar.created", undefined, undefined, { calendarId: calendar.id }));
    return calendar;
  }

  async getCalendar(actor: ActorContext, id: string): Promise<CalendarDto> {
    const { data, error } = await this.db.from("calendars").select("*")
      .eq("id", id).eq("user_id", actor.userId).maybeSingle();
    throwQuery(error);
    if (!data) throw new StickyDomainError("not_found", "Calendar not found.", 404);
    return mapCalendarRow(data as DataRow);
  }

  async listCalendarEvents(actor: ActorContext, range: CalendarRangeInput): Promise<CalendarEventDto[]> {
    const fromDate = range.from.slice(0, 10);
    const toDate = range.to.slice(0, 10);
    const base = () => this.db.from("calendar_events").select("*")
      .eq("user_id", actor.userId).neq("status", "cancelled");
    const [timed, allDay] = await Promise.all([
      base().eq("all_day", false).lt("start_at", range.to).gt("end_at", range.from).order("start_at"),
      base().eq("all_day", true).lt("start_date", toDate).gt("end_date", fromDate).order("start_date"),
    ]);
    throwQuery(timed.error);
    throwQuery(allDay.error);
    return ([...(timed.data ?? []), ...(allDay.data ?? [])] as DataRow[])
      .map(mapCalendarEventRow)
      .sort((a, b) => (a.startAt ?? a.startDate ?? "").localeCompare(b.startAt ?? b.startDate ?? ""));
  }

  async getCalendarEvent(actor: ActorContext, id: string): Promise<CalendarEventDto> {
    const { data, error } = await this.db.from("calendar_events").select("*")
      .eq("id", id).eq("user_id", actor.userId).maybeSingle();
    throwQuery(error);
    if (!data) throw new StickyDomainError("not_found", "Calendar event not found.", 404);
    return mapCalendarEventRow(data as DataRow);
  }

  async createCalendarEvent(actor: ActorContext, input: CreateCalendarEventInput): Promise<CalendarEventDto> {
    const calendar = input.calendarId
      ? await this.getCalendar(actor, input.calendarId)
      : await this.ensureDefaultCalendar(actor);
    if (input.taskId) await this.getTask(actor, input.taskId);
    this.assertEventSchedule(input);
    const schedule = input.allDay
      ? { start_date: input.startDate, end_date: input.endDate, start_at: null, end_at: null }
      : { start_at: input.startAt, end_at: input.endAt, start_date: null, end_date: null };
    const { data, error } = await this.db.from("calendar_events").insert({
      id: input.id,
      user_id: actor.userId,
      calendar_id: calendar.id,
      task_id: input.taskId,
      title: input.title,
      details: input.details,
      location: input.location,
      all_day: input.allDay,
      timezone: input.timezone,
      recurrence: input.recurrence,
      status: input.status,
      transparency: input.transparency,
      color: input.color,
      ...schedule,
    }).select("*").single();
    throwQuery(error);
    const event = mapCalendarEventRow(data as DataRow);
    await this.writeActivity(activity(actor, "calendar_event.created", event.taskId ?? undefined, undefined, { calendarEventId: event.id, calendarId: event.calendarId }));
    return event;
  }

  async updateCalendarEvent(actor: ActorContext, id: string, input: UpdateCalendarEventInput): Promise<CalendarEventDto> {
    const current = await this.getCalendarEvent(actor, id);
    assertVersion(input.version, current.version, "Calendar event");
    if (input.calendarId) await this.getCalendar(actor, input.calendarId);
    if (input.taskId) await this.getTask(actor, input.taskId);
    const next = { ...current, ...input };
    this.assertEventSchedule(next);
    const values: Record<string, unknown> = {};
    if (input.calendarId !== undefined) values.calendar_id = input.calendarId;
    if (input.taskId !== undefined) values.task_id = input.taskId;
    if (input.title !== undefined) values.title = input.title;
    if (input.details !== undefined) values.details = input.details;
    if (input.location !== undefined) values.location = input.location;
    if (input.timezone !== undefined) values.timezone = input.timezone;
    if (input.recurrence !== undefined) values.recurrence = input.recurrence;
    if (input.status !== undefined) values.status = input.status;
    if (input.transparency !== undefined) values.transparency = input.transparency;
    if (input.color !== undefined) values.color = input.color;
    if (next.allDay) {
      values.all_day = true;
      values.start_date = next.startDate;
      values.end_date = next.endDate;
      values.start_at = null;
      values.end_at = null;
    } else {
      values.all_day = false;
      values.start_at = next.startAt;
      values.end_at = next.endAt;
      values.start_date = null;
      values.end_date = null;
    }
    const { data, error } = await this.db.from("calendar_events").update(values)
      .eq("id", id).eq("user_id", actor.userId).eq("version", input.version).select("*").maybeSingle();
    throwQuery(error);
    if (!data) throw conflict("Calendar event changed somewhere else. Refresh and try again.");
    const event = mapCalendarEventRow(data as DataRow);
    await this.writeActivity(activity(actor, "calendar_event.updated", event.taskId ?? undefined, undefined, { calendarEventId: id, calendarId: event.calendarId }));
    return event;
  }

  async deleteCalendarEvent(actor: ActorContext, id: string): Promise<void> {
    const event = await this.getCalendarEvent(actor, id);
    const { error } = await this.db.from("calendar_events").delete().eq("id", id).eq("user_id", actor.userId);
    throwQuery(error);
    await this.writeActivity(activity(actor, "calendar_event.deleted", event.taskId ?? undefined, undefined, { deletedCalendarEventId: id, calendarId: event.calendarId }));
  }

  async timeBlockTask(actor: ActorContext, taskId: string, input: TimeBlockTaskInput): Promise<CalendarEventDto> {
    const task = await this.getTask(actor, taskId);
    const endAt = new Date(new Date(input.startAt).getTime() + input.durationMinutes * 60_000).toISOString();
    return this.createCalendarEvent(actor, {
      calendarId: input.calendarId,
      taskId,
      title: task.title,
      details: task.details,
      location: input.location,
      allDay: false,
      startAt: input.startAt,
      endAt,
      timezone: task.timezone,
      recurrence: [],
      status: "confirmed",
      transparency: "opaque",
      color: task.color,
    });
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

  private async nextCompletedOrder(userId: string, listId: string): Promise<number> {
    const { data, error } = await this.db.from("tasks").select("completed_sort_order")
      .eq("user_id", userId).eq("list_id", listId).eq("is_completed", true)
      .order("completed_sort_order", { ascending: false }).limit(1);
    throwQuery(error);
    return Number((data?.[0] as DataRow | undefined)?.completed_sort_order ?? 0) + 1000;
  }

  private assertEventSchedule(event: {
    allDay: boolean;
    startAt?: string | null;
    endAt?: string | null;
    startDate?: string | null;
    endDate?: string | null;
  }): void {
    const valid = event.allDay
      ? Boolean(event.startDate && event.endDate && event.endDate > event.startDate)
      : Boolean(event.startAt && event.endAt && new Date(event.endAt).getTime() > new Date(event.startAt).getTime());
    if (!valid) throw new StickyDomainError("validation_error", "Calendar event must end after it starts.", 422);
  }

  private async writeActivity(values: Record<string, unknown>): Promise<void> {
    const { error } = await this.db.from("task_activity").insert(values);
    throwQuery(error, "Sticky saved the change but could not write its audit event.");
  }

}
