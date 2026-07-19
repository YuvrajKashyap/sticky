import { describe, expect, it } from "vitest";
import { nextDailyAgendaOccurrence, resolveFieldConflict, resolveReminderTime, toGoogleTask } from "./index";

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
