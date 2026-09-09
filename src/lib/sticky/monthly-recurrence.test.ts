import { describe, expect, it } from "vitest";
import { nextRecurrenceDate } from "@sticky/domain";
import { nextRecurrenceDate as browserNext } from "./recurrence";
import type { RecurrenceRuleDto, TaskDto } from "@sticky/contracts";

const rule = { frequency: "monthly", intervalCount: 1, daysOfWeek: [], monthDay: 1, startsOn: "2026-01-01", endType: "never", endDate: null, occurrenceCount: null, paused: false };
for (const [name, next] of [["server", nextRecurrenceDate], ["browser", browserNext]] as const) {
  describe(`${name} monthly selection`, () => {
    it.each([
      { days: [1, 15], due: "2026-01-01", want: "2026-01-15" },
      { days: [1, 15], due: "2026-01-15", want: "2026-02-01" },
      { days: [-1], due: "2028-01-31", want: "2028-02-29" },
      { days: [30, 31, -1], due: "2026-02-28", want: "2026-03-30" },
      { days: [31], due: "2026-01-31", want: "2026-02-28" },
    ])("advances $days from $due to $want", ({days, due, want}) => {
      expect(next({ ...rule, monthDays: days } as unknown as RecurrenceRuleDto, { dueDate: due } as TaskDto)).toBe(want);
    });
    it("keeps multiple days in the same eligible month before skipping an interval", () => {
      const schedule = { ...rule, intervalCount: 2, monthDays: [1, 15] } as unknown as RecurrenceRuleDto;
      expect(next(schedule, { dueDate: "2026-01-01" } as TaskDto)).toBe("2026-01-15");
      expect(next(schedule, { dueDate: "2026-01-15" } as TaskDto)).toBe("2026-03-01");
    });
    it("honors the end date inside a multi-day month", () => {
      expect(next({ ...rule, monthDays: [1, 15], endType: "on_date", endDate: "2026-01-10" } as unknown as RecurrenceRuleDto, { dueDate: "2026-01-01" } as TaskDto)).toBeNull();
    });
  });
}
