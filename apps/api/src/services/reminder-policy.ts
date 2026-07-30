import type { ActorContext, CreateReminderInput, ReminderDto, TaskDto } from "@sticky/contracts";
import {
  DEFAULT_AGENT_REMINDER_MINUTES,
  localDateTimeToUtc,
  resolveReminderTime,
  taskUsesAutomaticReminder,
} from "@sticky/domain";
import { start } from "workflow/api";
import { getRuntime } from "../runtime";
import { reminderWorkflow } from "../workflows/reminder";

const DEFAULT_REMINDER_INPUT: CreateReminderInput = {
  kind: "relative",
  relativeMinutes: DEFAULT_AGENT_REMINDER_MINUTES,
  channels: ["poke"],
};

function sameInstant(left: string, right: Date) {
  return new Date(left).getTime() === right.getTime();
}

export async function scheduleReminderWorkflow(reminder: Pick<ReminderDto, "id" | "remindAt">) {
  if (process.env.WORKFLOW_ENABLED === "false") return null;
  const run = await start(reminderWorkflow, [reminder.id, reminder.remindAt]);
  await getRuntime().db.from("task_reminders")
    .update({ workflow_run_id: run.runId })
    .eq("id", reminder.id);
  return run.runId;
}

async function rescheduleRelativeReminder(
  actor: ActorContext,
  task: TaskDto,
  reminder: ReminderDto,
) {
  const input: CreateReminderInput = {
    kind: "relative",
    relativeMinutes: reminder.relativeMinutes!,
    channels: ["poke"],
  };
  const remindAt = resolveReminderTime(input, task);
  if (sameInstant(reminder.remindAt, remindAt) && reminder.channels.length === 1 && reminder.channels[0] === "poke") {
    return { reminder, workflowRunId: null, action: "unchanged" as const };
  }
  const updated = await getRuntime().repository.rescheduleReminder(
    actor,
    reminder.id,
    input,
    remindAt,
    { isDefault: reminder.isDefault },
  );
  return {
    reminder: updated,
    workflowRunId: await scheduleReminderWorkflow(updated),
    action: "rescheduled" as const,
  };
}

export async function reconcileTaskReminder(actor: ActorContext, taskId: string) {
  const repository = getRuntime().repository;
  const [task, scheduled] = await Promise.all([
    repository.getTask(actor, taskId),
    repository.listScheduledReminders(actor, taskId),
  ]);

  if (task.isCompleted) {
    const cancelledReminderIds = await repository.cancelScheduledReminders(actor, taskId);
    return { action: "cancelled" as const, cancelledReminderIds };
  }

  const explicit = scheduled.find((reminder) => !reminder.isDefault);
  if (explicit) {
    await repository.cancelScheduledReminders(actor, taskId, { onlyDefault: true });
    if (explicit.kind === "relative") {
      if (!task.dueDate || !task.dueTime) {
        const cancelledReminderIds = await repository.cancelScheduledReminders(actor, taskId);
        return { action: "cancelled" as const, cancelledReminderIds };
      }
      return rescheduleRelativeReminder(actor, task, explicit);
    }
    if (explicit.channels.length !== 1 || explicit.channels[0] !== "poke") {
      const input: CreateReminderInput = {
        kind: "absolute",
        remindAt: explicit.remindAt,
        channels: ["poke"],
      };
      const updated = await repository.rescheduleReminder(
        actor,
        explicit.id,
        input,
        new Date(explicit.remindAt),
      );
      return {
        action: "rescheduled" as const,
        reminder: updated,
        workflowRunId: await scheduleReminderWorkflow(updated),
      };
    }
    return { action: "unchanged" as const, reminder: explicit, workflowRunId: null };
  }

  const dueAt = task.dueDate && task.dueTime
    ? localDateTimeToUtc(task.dueDate, task.dueTime, task.timezone)
    : null;
  if (!taskUsesAutomaticReminder(task) || !dueAt || dueAt <= new Date()) {
    const cancelledReminderIds = await repository.cancelScheduledReminders(actor, taskId, { onlyDefault: true });
    return { action: "ineligible" as const, cancelledReminderIds };
  }

  const remindAt = resolveReminderTime(DEFAULT_REMINDER_INPUT, task);
  const automatic = scheduled.find((reminder) => reminder.isDefault);
  if (automatic) return rescheduleRelativeReminder(actor, task, automatic);

  const reminder = await repository.createReminder(
    actor,
    task.id,
    DEFAULT_REMINDER_INPUT,
    remindAt,
    { isDefault: true },
  );
  return {
    action: "created" as const,
    reminder,
    workflowRunId: await scheduleReminderWorkflow(reminder),
  };
}

export async function replaceTaskReminder(
  actor: ActorContext,
  taskId: string,
  input: CreateReminderInput,
) {
  const repository = getRuntime().repository;
  const task = await repository.getTask(actor, taskId);
  const normalizedInput: CreateReminderInput = { ...input, channels: ["poke"] };
  const remindAt = resolveReminderTime(normalizedInput, task);
  await repository.cancelScheduledReminders(actor, taskId);
  const reminder = await repository.createReminder(actor, taskId, normalizedInput, remindAt);
  return {
    reminder,
    workflowRunId: await scheduleReminderWorkflow(reminder),
  };
}
