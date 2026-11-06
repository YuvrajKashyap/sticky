import { describe, expect, it } from "vitest";
import type { StickyRecurrenceRule, StickySubtask, StickyTask } from "@/types/sticky";
import { restoreDeletedTasks } from "./restore-deleted-tasks";

const task: StickyTask = {
  id: "parent", userId: "owner", listId: "list", title: "Parent", details: "", color: "sun",
  dueDate: "2026-11-08", dueTime: null, timezone: "America/Chicago", isCompleted: false,
  completedAt: null, sortOrder: 1000, completedSortOrder: null, createdAt: "", updatedAt: "",
};
const child: StickySubtask = {
  id: "child", userId: "owner", taskId: "parent", title: "Child", dueDate: "2026-11-07",
  isCompleted: true, completedAt: "2026-11-06T12:00:00Z", sortOrder: 1000, createdAt: "", updatedAt: "",
};
const rule: StickyRecurrenceRule = {
  id: "rule", userId: "owner", taskId: "parent", frequency: "monthly", intervalCount: 1,
  daysOfWeek: [], monthDay: null, monthDays: [1, -1], startsOn: "2026-11-01", endType: "never",
  endDate: null, occurrenceCount: null, timezone: "America/Chicago", paused: false, createdAt: "", updatedAt: "",
};

describe("restoring deleted tasks", () => {
  it("does not begin child writes until the parent insert succeeds and preserves child dates", async () => {
    let finish!: (result: { error: null }) => void;
    const parent = new Promise<{ error: null }>(resolve => { finish = resolve; });
    const calls: Array<{ table: string; rows: unknown }> = [];
    const result = restoreDeletedTasks((table, rows) => {
      calls.push({ table, rows });
      return table === "tasks" ? parent : Promise.resolve({ error: null });
    }, [task], [child], []);
    await Promise.resolve();
    expect(calls.map(call => call.table)).toEqual(["tasks"]);
    finish({ error: null });
    await result;
    expect(calls[1]).toMatchObject({ table: "subtasks", rows: [{
      id: "child", task_id: "parent", due_date: "2026-11-07", is_completed: true,
      completed_at: "2026-11-06T12:00:00Z",
    }] });
  });

  it("stops dependent inserts when the parent returns a database error", async () => {
    const calls: string[] = [];
    await expect(restoreDeletedTasks(async table => {
      calls.push(table);
      return { error: { message: "Parent insert failed" } };
    }, [task], [child], [])).rejects.toThrow("Parent insert failed");
    expect(calls).toEqual(["tasks"]);
  });

  it("propagates a rejected parent request without starting child inserts", async () => {
    const calls: string[] = [];
    await expect(restoreDeletedTasks(async table => {
      calls.push(table);
      throw new Error("offline");
    }, [task], [child], [])).rejects.toThrow("offline");
    expect(calls).toEqual(["tasks"]);
  });

  it("restores recurrence settings only after its parent is persisted", async () => {
    const calls: Array<{ table: string; rows: unknown }> = [];
    await restoreDeletedTasks(async (table, rows) => {
      calls.push({ table, rows });
      return { error: null };
    }, [task], [], [rule]);
    expect(calls.map(call => call.table)).toEqual(["tasks", "task_recurrence_rules"]);
    expect(calls[1]).toMatchObject({ rows: [{ task_id: "parent", month_days: [1, -1], timezone: "America/Chicago" }] });
  });

  it("stops restoration and exposes a child insert failure", async () => {
    const calls: string[] = [];
    await expect(restoreDeletedTasks(async table => {
      calls.push(table);
      return { error: table === "subtasks" ? { message: "Child insert failed" } : null };
    }, [task], [child], [rule])).rejects.toThrow("Child insert failed");
    expect(calls).toEqual(["tasks", "subtasks"]);
  });
});
