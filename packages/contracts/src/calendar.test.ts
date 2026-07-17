import { describe, expect, it } from "vitest";
import { calendarRangeSchema, createCalendarEventSchema } from "./calendar";

describe("Sticky Calendar contracts", () => {
  it("accepts a real timed event with an offset", () => {
    const event = createCalendarEventSchema.parse({
      title: "Deep work",
      allDay: false,
      startAt: "2026-07-20T09:00:00-05:00",
      endAt: "2026-07-20T10:30:00-05:00",
    });
    expect(event).toMatchObject({ title: "Deep work", allDay: false, details: "", location: "" });
  });

  it("rejects reversed timed and all-day ranges", () => {
    expect(() => createCalendarEventSchema.parse({
      title: "Backwards",
      allDay: false,
      startAt: "2026-07-20T10:00:00-05:00",
      endAt: "2026-07-20T09:00:00-05:00",
    })).toThrow();
    expect(() => createCalendarEventSchema.parse({
      title: "Backwards day",
      allDay: true,
      startDate: "2026-07-20",
      endDate: "2026-07-20",
    })).toThrow();
  });

  it("requires a forward calendar query range", () => {
    expect(calendarRangeSchema.safeParse({
      from: "2026-07-20T10:00:00-05:00",
      to: "2026-07-20T09:00:00-05:00",
    }).success).toBe(false);
  });
});
