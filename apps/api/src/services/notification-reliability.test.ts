import { afterEach, describe, expect, it, vi } from "vitest";
import { getRuntime } from "../runtime";
import { deliverReminder } from "./notifications";
import { deliverDailyAgenda } from "./daily-agenda";

vi.mock("../runtime", () => ({ getRuntime: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("notification failure recovery", () => {
  it("retries a failed reminder lookup instead of treating it as an obsolete reminder", async () => {
    const error = { code: "08006", message: "Connection lost" };
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => ({ data: null, error }),
    };
    vi.mocked(getRuntime).mockReturnValue({ db: { from: () => query } } as never);

    await expect(deliverReminder("reminder-1", "2026-11-06T12:00:00Z")).rejects.toEqual(error);
  });

  it("keeps a delivered agenda receipt when updating schedule metadata fails, preventing a duplicate retry", async () => {
    let delivery: Record<string, unknown> | null = null;
    let sends = 0;
    const metadataError = { code: "08006", message: "Connection lost updating preferences" };
    const db = {
      from(table: string) {
        let action = "select";
        let payload: Record<string, unknown> = {};
        const execute = async () => {
          if (table === "notification_deliveries") {
            if (action === "insert") {
              if (delivery) return { data: null, error: { code: "23505" } };
              delivery = { id: "delivery-1", updated_at: new Date().toISOString(), ...payload };
            }
            if (action === "update") Object.assign(delivery!, payload);
            return { data: delivery, error: null };
          }
          if (table === "user_preferences") {
            return action === "update"
              ? { data: null, error: metadataError }
              : { data: { daily_agenda_enabled: true, daily_agenda_schedule_version: 2 }, error: null };
          }
          if (table === "api_credentials") return { data: { provider_user_id: "poke-test" }, error: null };
          if (["lists", "tasks", "subtasks"].includes(table)) return { data: [], error: null };
          throw new Error(`Unexpected table: ${table}`);
        };
        const query = {
          select: () => query,
          eq: () => query,
          is: () => query,
          not: () => query,
          order: () => query,
          limit: () => query,
          range: () => query,
          insert: (value: Record<string, unknown>) => { action = "insert"; payload = value; return query; },
          update: (value: Record<string, unknown>) => { action = "update"; payload = value; return query; },
          maybeSingle: execute,
          then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => execute().then(resolve, reject),
        };
        return query;
      },
    };
    vi.mocked(getRuntime).mockReturnValue({ db } as never);
    vi.stubEnv("POKE_API_KEY", "local-test-key");
    vi.stubGlobal("fetch", async () => {
      sends += 1;
      return Response.json({ success: true });
    });
    const input = { date: "2026-11-06", timezone: "America/Chicago", scheduleVersion: 2 };

    await expect(deliverDailyAgenda("user-1", input)).rejects.toEqual(metadataError);
    expect(delivery).toMatchObject({ status: "delivered" });
    await expect(deliverDailyAgenda("user-1", input)).resolves.toMatchObject({ skipped: "already_delivered" });
    expect(sends).toBe(1);
  });
});
