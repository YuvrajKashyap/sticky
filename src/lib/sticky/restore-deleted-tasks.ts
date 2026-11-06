import type { StickyRecurrenceRule, StickySubtask, StickyTask } from "@/types/sticky";
import { recurrenceToDb, subtaskToDb, taskToDb } from "./mappers";

export function taskInsertPayload(task: StickyTask) {
  return { id: task.id, user_id: task.userId, ...taskToDb(task) };
}

export function subtaskInsertPayload(subtask: StickySubtask) {
  return { id: subtask.id, user_id: subtask.userId, ...subtaskToDb(subtask) };
}

export function recurrenceInsertPayload(rule: StickyRecurrenceRule) {
  return { id: rule.id, user_id: rule.userId, ...recurrenceToDb(rule) };
}

type Result = { error: { message: string } | null };
type Insert = (table: "tasks" | "subtasks" | "task_recurrence_rules", rows: Record<string, unknown>[]) => PromiseLike<Result>;

export async function restoreDeletedTasks(insert: Insert, tasks: StickyTask[], subtasks: StickySubtask[], rules: StickyRecurrenceRule[]) {
  // Children reference restored parents. Start each stage only after the
  // preceding write succeeds, including clients that resolve database errors.
  for (const [table, rows] of [
    ["tasks", tasks.map(taskInsertPayload)],
    ["subtasks", subtasks.map(subtaskInsertPayload)],
    ["task_recurrence_rules", rules.map(recurrenceInsertPayload)],
  ] as const) {
    if (!rows.length) continue;
    const result = await insert(table, rows);
    if (result.error) throw new Error(result.error.message);
  }
}
