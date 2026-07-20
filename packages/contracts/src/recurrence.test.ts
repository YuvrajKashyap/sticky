import { describe, expect, it } from "vitest";
import { recurrenceScheduleSchema } from "./recurrence";

describe("recurrence schedules", () => {
  it("accepts a weekly Sunday schedule in Central Time", () => {
    expect(recurrenceScheduleSchema.parse({
      frequency: "weekly",
      daysOfWeek: [0],
      startsOn: "2026-07-19",
      timezone: "America/Chicago",
    })).toMatchObject({
      frequency: "weekly",
      intervalCount: 1,
      daysOfWeek: [0],
      endType: "never",
    });
  });

  it("rejects weekly recurrence without a weekday", () => {
    expect(recurrenceScheduleSchema.safeParse({
      frequency: "weekly",
      startsOn: "2026-07-19",
    }).success).toBe(false);
  });

  it("rejects an end date before the first occurrence", () => {
    expect(recurrenceScheduleSchema.safeParse({
      frequency: "daily",
      startsOn: "2026-07-19",
      endType: "on_date",
      endDate: "2026-07-18",
    }).success).toBe(false);
  });
});
