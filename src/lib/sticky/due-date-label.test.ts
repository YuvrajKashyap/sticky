import { describe, expect, it } from "vitest";
import { relativeDueDateLabel } from "./due-date-label";

describe("relative due-date labels", () => {
  it.each([
    [new Date(2026, 9, 15, 0, 1), "2026-10-14"],
    [new Date(2026, 10, 1, 23, 59), "2026-10-31"],
    [new Date(2027, 0, 1, 12), "2026-12-31"],
    [new Date(2028, 2, 1, 12), "2028-02-29"],
    [new Date(2026, 2, 9, 0, 1), "2026-03-08"],
  ])("labels the previous local calendar day Yesterday (%s)", (now, yesterday) => {
    expect(relativeDueDateLabel(yesterday, now)).toBe("Yesterday");
  });

  it("preserves Today and leaves older/future dates to the existing formatter", () => {
    const now = new Date(2026, 9, 15, 12);
    expect(relativeDueDateLabel("2026-10-15", now)).toBe("Today");
    expect(relativeDueDateLabel("2026-10-13", now)).toBeNull();
    expect(relativeDueDateLabel("2026-10-16", now)).toBeNull();
  });
});
