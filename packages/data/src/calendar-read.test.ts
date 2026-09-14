import { createClient } from "@supabase/supabase-js";
import type { ActorContext } from "@sticky/contracts";
import { describe, expect, it } from "vitest";
import { StickyRepository } from "./repository";

const actor = { userId: "owner" } as ActorContext;
const base = {
  id: "class", user_id: "owner", calendar_id: "calendar", task_id: null,
  title: "CS 4390", details: "", location: "", all_day: false,
  start_at: "2026-08-24T13:30:00.000Z", end_at: "2026-08-24T14:45:00.000Z",
  start_date: null, end_date: null, timezone: "America/Chicago",
  recurrence: ["FREQ=WEEKLY", "BYDAY=MO,WE", "UNTIL=20261209"],
  status: "confirmed", transparency: "opaque", color: null, version: 2,
  created_at: "2026-09-14T00:00:00.000Z", updated_at: "2026-09-14T00:00:00.000Z",
};

// Keep the real Supabase query builder; replace only the HTTP database boundary.
function repository(rows: Record<string, unknown>[] = [base]) {
  const db = createClient("http://localhost:54321", "test-key", {
    db: { schema: "sticky" },
    global: { fetch: async (input) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("user_id")).toBe("eq.owner");
      const matches = rows.filter((row) => [...url.searchParams].every(([key, filter]) => {
        if (["select", "order", "offset", "limit"].includes(key)) return true;
        const [operator, ...rest] = filter.split(".");
        const value = rest.join(".");
        const actual = Array.isArray(row[key]) ? `{${(row[key] as string[]).join(",")}}` : String(row[key]);
        if (operator === "eq") return actual === value;
        if (operator === "neq") return actual !== value;
        if (operator === "lt") return row[key] != null && actual < value;
        if (operator === "gt") return row[key] != null && actual > value;
        throw new Error(`Unhandled filter: ${key}=${filter}`);
      }));
      const from = Number(url.searchParams.get("offset") ?? 0);
      return Response.json(matches.slice(from, from + 2)); // Exercise pagination too.
    } },
  });
  return new StickyRepository(db);
}
const range = (from: string, to: string) => ({ from: `${from}T00:00:00Z`, to: `${to}T00:00:00Z` });

describe("recurring calendar reads", () => {
  it("returns September class meetings from an August series without creating records", async () => {
    const events = await repository().listCalendarEvents(actor, range("2026-09-14", "2026-09-21"));
    expect(events.map((event) => event.startAt)).toEqual(["2026-09-14T13:30:00.000Z", "2026-09-16T13:30:00.000Z"]);
    expect(events.map((event) => event.id)).toEqual(["class", "class"]);
    expect(new Set(events.map((event) => event.occurrenceId)).size).toBe(2);
    expect(events[0].series).toMatchObject({ startAt: base.start_at, endAt: base.end_at });
  });
  it("keeps 8:30 AM Chicago time across daylight saving and includes the final UNTIL day", async () => {
    const events = await repository().listCalendarEvents(actor, range("2026-10-28", "2026-11-05"));
    expect(events.map((event) => event.startAt)).toEqual(["2026-10-28T13:30:00.000Z", "2026-11-02T14:30:00.000Z", "2026-11-04T14:30:00.000Z"]);
    const end = await repository().listCalendarEvents(actor, range("2026-12-09", "2026-12-17"));
    expect(end.map((event) => event.startAt)).toEqual(["2026-12-09T14:30:00.000Z"]);
  });
  it("honors COUNT and UTC exceptions and does not duplicate the original occurrence", async () => {
    const repo = repository([{ ...base, recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4", "EXDATE:20260826T133000Z"] }]);
    const events = await repo.listCalendarEvents(actor, range("2026-08-24", "2026-09-10"));
    expect(events.map((event) => event.startAt)).toEqual(["2026-08-24T13:30:00.000Z", "2026-08-31T13:30:00.000Z", "2026-09-02T13:30:00.000Z"]);
  });
  it("handles monthly all-day repeats and exclusive end dates", async () => {
    const repo = repository([{ ...base, all_day: true, start_at: null, end_at: null, start_date: "2026-08-01", end_date: "2026-08-03", recurrence: ["RRULE:FREQ=MONTHLY;COUNT=3"] }]);
    expect((await repo.listCalendarEvents(actor, range("2026-09-02", "2026-09-03"))).map((e) => [e.startDate, e.endDate])).toEqual([["2026-09-01", "2026-09-03"]]);
    expect(await repo.listCalendarEvents(actor, range("2026-09-03", "2026-09-04"))).toEqual([]);
  });
  it("keeps one-off events, paginates, and excludes cancelled and other owners", async () => {
    const rows = [0, 1, 2, 3].map((i) => ({ ...base, id: `one-${i}`, recurrence: [] }));
    const events = await repository([...rows, { ...base, user_id: "other" }, { ...base, status: "cancelled" }]).listCalendarEvents(actor, range("2026-08-24", "2026-08-25"));
    expect(events.map((e) => e.id)).toEqual(["one-0", "one-1", "one-2", "one-3"]);
  });
  it("includes overnight overlap but excludes meetings ending at the range start", async () => {
    const repo = repository([{ ...base, start_at: "2026-08-25T04:30:00.000Z", end_at: "2026-08-25T06:00:00.000Z", recurrence: ["FREQ=WEEKLY;BYDAY=MO"] }]);
    expect((await repo.listCalendarEvents(actor, { from: "2026-09-15T05:00:00Z", to: "2026-09-15T07:00:00Z" }))[0]?.startAt).toBe("2026-09-15T04:30:00.000Z");
    expect(await repo.listCalendarEvents(actor, { from: "2026-09-15T06:00:00Z", to: "2026-09-15T07:00:00Z" })).toEqual([]);
  });
  it("supports monthly ordinal weekdays and leap-day yearly rules", async () => {
    const monthly = repository([{ ...base, recurrence: ["RRULE:FREQ=MONTHLY;BYDAY=1MO"] }]);
    expect((await monthly.listCalendarEvents(actor, range("2026-09-01", "2026-10-01"))).map((e) => e.startAt)).toEqual(["2026-09-07T13:30:00.000Z"]);
    const yearly = repository([{ ...base, start_at: "2024-02-29T14:30:00.000Z", end_at: "2024-02-29T15:45:00.000Z", recurrence: ["RRULE:FREQ=YEARLY;COUNT=2"] }]);
    expect((await yearly.listCalendarEvents(actor, range("2025-01-01", "2029-01-01"))).map((e) => e.startAt)).toEqual(["2028-02-29T14:30:00.000Z"]);
  });
});
