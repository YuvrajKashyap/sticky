import { describe, expect, it } from "vitest";
import { matchingTaskItems, calendarTaskItems } from "./task-filter";
import type { StickyTask, StickySubtask } from "@/types/sticky";

const parent: StickyTask = { id: "parent", userId: "user", listId: "list", title: "Project", details: "", color: "mint", dueDate: "2026-09-20", dueTime: null, timezone: "America/Chicago", isCompleted: false, completedAt: null, sortOrder: 1000, completedSortOrder: null, createdAt: "", updatedAt: "" };
const child = (id: string, dueDate: string | null, isCompleted = false): StickySubtask => ({ id, taskId: parent.id, userId: "user", title: id, dueDate, isCompleted, completedAt: null, sortOrder: 1000, createdAt: "", updatedAt: "" });
const children = [child("late", "2026-09-14"), child("today", "2026-09-16"), child("future", "2026-09-19"), child("undated", null), child("done", "2026-09-13", true)];

describe("independent task eligibility", () => {
  it.each([
    ["overdue", ["late"]], ["today", ["today"]], ["all_today", ["today"]],
    ["due", ["parent", "late", "today", "future"]], ["undated", ["undated"]],
    ["all", ["parent", "late", "today", "future", "undated"]],
    ["subtasks", ["late", "today", "future", "undated"]], ["daily", []], ["recurring", []],
  ] as const)("%s includes only independently eligible items", (filter, ids) => {
    expect(matchingTaskItems(parent, children, null, filter, "2026-09-16").map(item => item.id)).toEqual(ids);
  });
  it("does not let the parent's date or completion hide an unfinished child", () => {
    expect(matchingTaskItems({ ...parent, isCompleted: true, dueDate: null }, children, null, "overdue", "2026-09-16").map(item => item.id)).toEqual(["late"]);
  });
  it("includes a matching parent and child exactly once each", () => {
    expect(matchingTaskItems({ ...parent, dueDate: "2026-09-15" }, children, null, "overdue", "2026-09-16").map(item => item.id)).toEqual(["parent", "late"]);
  });
  it("excludes unrelated children when searching", () => {
    expect(matchingTaskItems(parent, children, null, "all", "2026-09-16", "late").map(item => item.id)).toEqual(["late"]);
  });
  it("projects calendar children with their own dates and completion and parent context", () => {
    const items = calendarTaskItems([parent], children);
    expect(items.map(item => item.id)).toEqual(["parent", "late", "today", "future", "done"]);
    expect(items.find(item => item.id === "late")).toMatchObject({ dueDate: "2026-09-14", dueTime: null, parentTaskId: "parent", parentTitle: "Project", title: "late", isCompleted: false });
  });
});
