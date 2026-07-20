import { describe, expect, it } from "vitest";
import type { RecurrenceRuleDto, TaskDto } from "@sticky/contracts";
import { nextDailyAgendaOccurrence, nextOccurrenceCount, nextRecurrenceDate, recurrenceCatchUpTarget, resolveFieldConflict, resolveReminderTime, toGoogleTask } from "./index";

const recurringTask: TaskDto = {
  id: "5f1b0634-c870-4b14-a1c7-d9304bd6f564",
  userId: "8ea2d355-7098-4432-9fff-48d28d5e5e92",
  listId: "663b0197-6e3c-4a29-b036-ad985c92aef9",
  title: "Weekly staff meeting",
  details: "",
  color: "sun",
  dueDate: "2026-07-20",
  dueTime: "16:30",
  timezone: "America/Chicago",
  isCompleted: false,
  completedAt: null,
  sortOrder: 1000,
  completedSortOrder: null,
  version: 1,
  createdAt: "2026-07-19T15:00:00.000Z",
  updatedAt: "2026-07-19T15:00:00.000Z",
};

const weeklyRule: RecurrenceRuleDto = {
  id: "f7be3e41-d114-4cb1-98cc-bf437cb0a7cf",
  userId: recurringTask.userId,
  taskId: recurringTask.id,
  frequency: "weekly",
  intervalCount: 1,
  daysOfWeek: [1],
  monthDay: null,
  startsOn: "2026-07-20",
  endType: "never",
  endDate: null,
  occurrenceCount: null,
  timezone: "America/Chicago",
  paused: false,
  createdAt: "2026-07-19T15:00:00.000Z",
  updatedAt: "2026-07-19T15:00:00.000Z",
};

describe("reminder scheduling", () => {
  it("subtracts a relative offset across a DST boundary", () => {
    const result = resolveReminderTime(
      { kind: "relative", relativeMinutes: 60, channels: ["push"] },
      { dueDate: "2026-11-01", dueTime: "09:00", timezone: "America/Chicago" },
    );
    expect(result.toISOString()).toBe("2026-11-01T14:00:00.000Z");
  });
});

describe("daily agenda scheduling", () => {
  it("schedules 6 AM Central using the daylight-saving offset", () => {
    const result = nextDailyAgendaOccurrence(
      new Date("2026-07-19T10:30:00.000Z"),
      "06:00",
      "America/Chicago",
    );
    expect(result.localDate).toBe("2026-07-19");
    expect(result.instant.toISOString()).toBe("2026-07-19T11:00:00.000Z");
  });

  it("uses the next local day after today's agenda time has passed", () => {
    const result = nextDailyAgendaOccurrence(
      new Date("2026-07-19T11:30:00.000Z"),
      "06:00",
      "America/Chicago",
    );
    expect(result.localDate).toBe("2026-07-20");
    expect(result.instant.toISOString()).toBe("2026-07-20T11:00:00.000Z");
  });

  it("changes the UTC instant when Central Time returns to standard time", () => {
    const result = nextDailyAgendaOccurrence(
      new Date("2026-12-10T11:30:00.000Z"),
      "06:00",
      "America/Chicago",
    );
    expect(result.localDate).toBe("2026-12-10");
    expect(result.instant.toISOString()).toBe("2026-12-10T12:00:00.000Z");
  });
});

describe("task recurrence", () => {
  it("advances a Monday task to the following Monday while preserving time on the task", () => {
    expect(nextRecurrenceDate(weeklyRule, recurringTask)).toBe("2026-07-27");
    expect(recurringTask.dueTime).toBe("16:30");
  });

  it("stops after the final occurrence", () => {
    const finalRule = { ...weeklyRule, endType: "after_count" as const, occurrenceCount: 1 };
    expect(nextRecurrenceDate(finalRule, recurringTask)).toBeNull();
    expect(nextOccurrenceCount({ ...finalRule, occurrenceCount: 2 })).toBe(1);
  });

  it("catches an overdue weekly task up to the first occurrence on or after the target date", () => {
    expect(recurrenceCatchUpTarget(weeklyRule, recurringTask, "2026-08-05")).toEqual({
      dueDate: "2026-08-10",
      occurrenceCount: null,
      skippedCount: 3,
    });
  });

  it("does not advance current, paused, or exhausted recurring tasks", () => {
    expect(recurrenceCatchUpTarget(weeklyRule, recurringTask, "2026-07-20")).toBeNull();
    expect(recurrenceCatchUpTarget({ ...weeklyRule, paused: true }, recurringTask, "2026-08-05")).toBeNull();
    expect(recurrenceCatchUpTarget({ ...weeklyRule, endType: "after_count", occurrenceCount: 1 }, recurringTask, "2026-08-05")).toBeNull();
  });
});

describe("Google mapping", () => {
  it("never sends Sticky due times to Google", () => {
    expect(toGoogleTask({ title: "Ship", details: "", dueDate: "2026-07-15", isCompleted: false })).toEqual({
      title: "Ship",
      notes: null,
      due: "2026-07-15T00:00:00.000Z",
      status: "needsAction",
    });
  });
});

describe("conflict resolution", () => {
  it("keeps the latest provider value and reports shared-field conflicts", () => {
    const result = resolveFieldConflict(
      { title: "Old", done: false },
      { title: "Sticky", done: false },
      { title: "Google", done: true },
      "2026-07-15T10:00:00.000Z",
      "2026-07-15T11:00:00.000Z",
    );
    expect(result.value).toEqual({ title: "Google", done: true });
    expect(result.conflicts).toEqual(["title"]);
  });
});
