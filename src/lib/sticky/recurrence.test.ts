import { describe, expect, it } from "vitest";
import { localDateKey, zonedDateKey } from "./recurrence";

describe("timezone date keys", () => {
  it("keeps dates correct across repeated calls, timezone changes, and daylight saving offsets", () => {
    const winter = new Date("2026-01-01T05:30:00Z");
    const summer = new Date("2026-07-01T05:30:00Z");
    expect(zonedDateKey("America/Chicago", winter)).toBe("2025-12-31");
    expect(zonedDateKey("America/Chicago", summer)).toBe("2026-07-01");
    expect(zonedDateKey("America/Los_Angeles", summer)).toBe("2026-06-30");
    expect(zonedDateKey("America/New_York", winter)).toBe("2026-01-01");
    expect(zonedDateKey("America/Chicago", winter)).toBe("2025-12-31");
  });

  it("retains the local fallback and recovers after an invalid timezone", () => {
    const date = new Date("2026-01-01T05:30:00Z");
    expect(zonedDateKey("UTC", date)).toBe("2026-01-01");
    for (const zone of [null, undefined, "", "Invalid/Timezone"]) {
      expect(zonedDateKey(zone, date)).toBe(localDateKey(date));
    }
    expect(zonedDateKey("UTC", date)).toBe("2026-01-01");
    expect(zonedDateKey("America/Chicago", date)).toBe("2025-12-31");
  });
});
