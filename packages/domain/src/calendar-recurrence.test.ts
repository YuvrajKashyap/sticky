import { expect, it } from "vitest";
import { validateCalendarRecurrence } from "./calendar-recurrence";

const schedule = { allDay: false, startAt: "2026-08-24T13:30:00Z", endAt: "2026-08-24T14:45:00Z", startDate: null, endDate: null, timezone: "America/Chicago" };
it("rejects invalid intervals before they can stall calendar reads", () => {
  for (const recurrence of [["FREQ=DAILY;INTERVAL=-1"], ["FREQ=DAILY;INTERVAL=0"], ["FREQ=SECONDLY"]]) {
    expect(() => validateCalendarRecurrence({ ...schedule, recurrence })).toThrow();
  }
});
it("accepts standard RRULE components in any order", () => {
  expect(() => validateCalendarRecurrence({ ...schedule, recurrence: ["RRULE:BYDAY=MO,WE;FREQ=WEEKLY;COUNT=10"] })).not.toThrow();
});
