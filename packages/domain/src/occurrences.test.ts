import { describe, expect, it } from "vitest";
import { occurrenceStatus, routineStatistics, isActiveOccurrence } from "./occurrences";

describe("dated routine occurrences", () => {
  const monday = { routineId: "routine", scheduledDate: "2026-10-19", occurrenceStatus: "pending" as const, timezone: "America/Chicago", isCompleted: false };
  const tuesday = { ...monday, scheduledDate: "2026-10-20" };
  const now = new Date("2026-10-20T15:00:00Z");
  it("retires yesterday but leaves today and one-offs actionable", () => {
    expect(occurrenceStatus(monday, now)).toBe("not_completed");
    expect(isActiveOccurrence(monday, now)).toBe(false);
    expect(isActiveOccurrence(tuesday, now)).toBe(true);
    expect(isActiveOccurrence({ isCompleted: false }, now)).toBe(true);
  });
  it("uses the occurrence timezone at midnight, including DST", () => {
    const day = { ...monday, scheduledDate: "2026-11-01" };
    expect(occurrenceStatus(day, new Date("2026-11-02T05:59:59Z"))).toBe("pending");
    expect(occurrenceStatus(day, new Date("2026-11-02T06:00:00Z"))).toBe("not_completed");
  });
  it("excludes pending, skipped, unknown and future days from the completion denominator", () => {
    const rows = [
      { ...monday, isCompleted: true }, monday,
      { ...monday, occurrenceStatus: "skipped" as const },
      { ...monday, occurrenceStatus: "unknown" as const }, tuesday,
    ];
    expect(routineStatistics(rows, "2026-10-01", "2026-10-31", now)).toEqual({ completed: 1, notCompleted: 1, skipped: 1, unknown: 1, pending: 1, denominator: 2, rate: 50 });
  });
});
