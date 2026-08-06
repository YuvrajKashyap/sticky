import { describe, expect, it } from "vitest";
import {
  compareDueSchedules,
  dueScheduleGroupKey,
  reorderItemsWithinVisibleSubset,
  compareTasksByDueSchedule,
  reorderTasksWithinDueGroup,
  tasksShareDueGroup,
} from "./task-order";

type TestTask = {
  id: string;
  dueDate: string | null;
  dueTime: string | null;
  sortOrder: number;
  createdAt: string;
};

function task(
  id: string,
  dueDate: string | null,
  dueTime: string | null,
  sortOrder: number,
): TestTask {
  return {
    id,
    dueDate,
    dueTime,
    sortOrder,
    createdAt: `2026-07-31T00:00:0${sortOrder}.000Z`,
  };
}

describe("Sticky due-date task ordering", () => {
  it("keeps later dates last and uses custom order only for exact schedule ties", () => {
    const tasks = [
      task("undated", null, null, 1),
      task("later", "2026-08-02", null, 2),
      task("no-time", "2026-08-01", null, 3),
      task("same-time-second", "2026-08-01", "09:00:00", 5),
      task("same-time-first", "2026-08-01", "09:00", 4),
    ];

    expect(tasks.slice().sort(compareTasksByDueSchedule).map((item) => item.id)).toEqual([
      "same-time-first",
      "same-time-second",
      "no-time",
      "later",
      "undated",
    ]);
    expect(tasksShareDueGroup(tasks[3], tasks[4])).toBe(true);
    expect(tasksShareDueGroup(tasks[2], tasks[3])).toBe(false);
  });

  it("reorders only the tied group while preserving every other custom-order slot", () => {
    const customOrder = [
      task("timed-a", "2026-08-01", "09:00", 1),
      task("later", "2026-08-02", null, 2),
      task("timed-b", "2026-08-01", "09:00:00", 3),
      task("undated", null, null, 4),
    ];

    expect(
      reorderTasksWithinDueGroup(customOrder, "timed-b", "timed-a")?.map((item) => item.id),
    ).toEqual(["timed-b", "later", "timed-a", "undated"]);
    expect(reorderTasksWithinDueGroup(customOrder, "later", "timed-a")).toBeNull();
  });

  it("keeps hidden filtered items in place while reordering the visible subset", () => {
    const completeOrder = [
      task("visible-a", "2026-08-01", null, 1),
      task("hidden-a", "2026-08-02", null, 2),
      task("visible-b", "2026-08-01", null, 3),
      task("hidden-b", null, null, 4),
    ];

    expect(
      reorderItemsWithinVisibleSubset(
        completeOrder,
        ["visible-a", "visible-b"],
        "visible-b",
        "visible-a",
      )?.map((item) => item.id),
    ).toEqual(["visible-b", "hidden-a", "visible-a", "hidden-b"]);
    expect(
      reorderItemsWithinVisibleSubset(completeOrder, ["visible-a"], "hidden-a", "visible-a"),
    ).toBeNull();
  });

  it("treats same-minute schedules and matching no-time dates as exact groups", () => {
    expect(
      dueScheduleGroupKey({ dueDate: "2026-08-06", dueTime: "09:00:45" }),
    ).toBe(dueScheduleGroupKey({ dueDate: "2026-08-06", dueTime: "09:00" }));
    expect(
      dueScheduleGroupKey({ dueDate: "2026-08-06", dueTime: null }),
    ).not.toBe(dueScheduleGroupKey({ dueDate: "2026-08-06", dueTime: "23:59" }));
    expect(
      compareDueSchedules(
        { dueDate: "2026-08-06", dueTime: "09:00" },
        { dueDate: "2026-08-06", dueTime: null },
      ),
    ).toBeLessThan(0);
  });
});
