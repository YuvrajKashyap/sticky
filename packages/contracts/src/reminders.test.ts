import { describe, expect, it } from "vitest";
import { createReminderSchema } from "./reminders";

describe("reminder contracts", () => {
  it("accepts zero minutes as an explicit reminder at the due time", () => {
    expect(createReminderSchema.parse({ kind: "relative", relativeMinutes: 0 })).toEqual({
      kind: "relative",
      relativeMinutes: 0,
      channels: ["poke"],
    });
  });
});
