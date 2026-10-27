import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestOwner, testEnvironment } from "./fixtures";
import { createApiApp } from "../../apps/api/src/app";

describe("independent routine occurrences", () => {
  let owner: Awaited<ReturnType<typeof createTestOwner>>;
  let other: Awaited<ReturnType<typeof createTestOwner>>;
  const monday = "2026-10-19";
  const tuesday = "2026-10-20";
  beforeAll(async () => { owner = await createTestOwner(); other = await createTestOwner(); });
  afterAll(async () => { await owner?.cleanup(); await other?.cleanup(); });
  async function routine(schedule: Record<string, unknown> = {}) {
    const { admin } = testEnvironment();
    const taskId = randomUUID(), id = randomUUID();
    const task = await admin.from("tasks").insert({ id: taskId, user_id: owner.userId, list_id: owner.listId, title: "Daily practice", due_date: monday, timezone: "America/Chicago" });
    expect(task.error).toBeNull();
    const rule = await admin.from("task_recurrence_rules").insert({ id, user_id: owner.userId, task_id: taskId, frequency: "daily", starts_on: monday, ...schedule });
    expect(rule.error).toBeNull();
    // Establish a known historical tracking start in the disposable fixture.
    expect((await admin.from("routine_templates").update({ tracking_since: monday, scan_from: monday }).eq("id", id)).error).toBeNull();
    if (!schedule.paused) expect((await admin.from("tasks").update({ occurrence_status: "pending" }).eq("id", taskId)).error).toBeNull();
    return { id, taskId };
  }
  async function reconcile(id: string, now: string) {
    const result = await testEnvironment().admin.rpc("reconcile_routine_occurrences", { p_request_user_id: owner.userId, p_routine_id: id, p_now: now });
    expect(result.error).toBeNull();
    return result.data;
  }
  async function rows(id: string) {
    const result = await owner.client.from("tasks").select("*").eq("routine_id", id).order("scheduled_date");
    expect(result.error).toBeNull(); return result.data!;
  }
  it("retains Monday unchecked, shows Tuesday, and corrects only Monday with an actual timestamp", async () => {
    const { id, taskId } = await routine();
    await reconcile(id, "2026-10-20T15:00:00Z");
    let tasks = await rows(id);
    expect(tasks.map(t => [t.scheduled_date, t.occurrence_status])).toEqual([[monday, "not_completed"], [tuesday, "pending"]]);
    const today = tasks[1];
    const before = Date.now();
    const completed = await testEnvironment().admin.rpc("complete_task_with_recurrence", { p_task_id: taskId, p_request_user_id: owner.userId, p_next_task_id: today.id, p_next_due_date: "2026-10-21" });
    expect(completed.error).toBeNull();
    tasks = await rows(id);
    expect(tasks[0].occurrence_status).toBe("completed");
    expect(Date.parse(tasks[0].completed_at)).toBeGreaterThanOrEqual(before - 1000);
    expect(tasks[1]).toEqual(today);
    expect(tasks).toHaveLength(2);
  });
  it("catches up offline once under concurrent retries without creating completions", async () => {
    const { id } = await routine();
    await Promise.all(Array.from({ length: 4 }, () => reconcile(id, "2026-10-23T15:00:00Z")));
    const tasks = await rows(id);
    expect(tasks).toHaveLength(5);
    expect(new Set(tasks.map(t => t.scheduled_date)).size).toBe(5);
    expect(tasks.filter(t => t.occurrence_status === "not_completed")).toHaveLength(4);
    expect(tasks.every(t => !t.is_completed && t.completed_at === null)).toBe(true);
  });
  it("leaves a one-off overdue", async () => {
    const { admin } = testEnvironment(); const taskId = randomUUID();
    await admin.from("tasks").insert({ id: taskId, user_id: owner.userId, list_id: owner.listId, title: "One off", due_date: monday });
    await admin.rpc("reconcile_routine_occurrences", { p_request_user_id: owner.userId, p_now: "2026-10-20T15:00:00Z" });
    const result = await owner.client.from("tasks").select("due_date,is_completed,routine_id").eq("id", taskId).single();
    expect(result.data).toEqual({ due_date: monday, is_completed: false, routine_id: null });
  });
  it("does not manufacture paused or unscheduled days, and honors end/count bounds", async () => {
    const weekly = await routine({ frequency: "weekly", days_of_week: [1, 3], end_type: "on_date", end_date: "2026-10-21" });
    await reconcile(weekly.id, "2026-10-26T15:00:00Z");
    expect((await rows(weekly.id)).map(t => t.scheduled_date)).toEqual([monday, "2026-10-21"]);
    const counted = await routine({ end_type: "after_count", occurrence_count: 3 });
    await reconcile(counted.id, "2026-10-26T15:00:00Z");
    expect((await rows(counted.id))).toHaveLength(3);
    const paused = await routine({ paused: true });
    await reconcile(paused.id, "2026-10-26T15:00:00Z");
    expect((await rows(paused.id))).toHaveLength(1);
    expect((await rows(paused.id))[0].occurrence_status).toBe("not_scheduled");
  });
  it("does not end a DST occurrence before its local day ends", async () => {
    const { id } = await routine({ starts_on: "2026-11-01" });
    await reconcile(id, "2026-11-02T05:59:59Z");
    expect((await rows(id)).find(t => t.scheduled_date === "2026-11-01")?.occurrence_status).toBe("pending");
    await reconcile(id, "2026-11-02T06:00:00Z");
    expect((await rows(id)).find(t => t.scheduled_date === "2026-11-01")?.occurrence_status).toBe("not_completed");
  });
  it("keeps history private and prevents a browser choosing another owner or clock", async () => {
    const { id } = await routine();
    expect((await other.client.from("routine_templates").select("id").eq("id", id)).data).toEqual([]);
    expect((await other.client.rpc("reconcile_my_routines", { p_request_user_id: owner.userId })).error).not.toBeNull();
    expect((await owner.client.rpc("reconcile_routine_occurrences", { p_request_user_id: owner.userId, p_now: "2099-01-01T00:00:00Z" })).error).not.toBeNull();
    expect((await testEnvironment().anonymous.from("routine_templates").select("id")).data ?? []).toEqual([]);
  });
  it("validates the exact occurrence date and supports explicit skip/correction through the API", async () => {
    const { id, taskId } = await routine();
    const app = createApiApp();
    const status = async (scheduledDate: string, value: string) => {
      const task = (await rows(id)).find(t => t.id === taskId)!;
      return app.request(`http://localhost/api/v1/occurrences/${taskId}/status`, {
        method: "POST", headers: { Authorization: `Bearer ${owner.session.access_token}`, "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
        body: JSON.stringify({ scheduledDate, status: value, version: task.version }),
      });
    };
    expect((await status(tuesday, "completed")).status).toBe(422);
    expect((await status(monday, "skipped")).status).toBe(200);
    expect((await rows(id))[0].occurrence_status).toBe("skipped");
    expect((await status(monday, "completed")).status).toBe(200);
    expect((await rows(id))[0].occurrence_status).toBe("completed");
    expect((await status(monday, "not_completed")).status).toBe(200);
    expect((await rows(id))[0].occurrence_status).toBe("not_completed");
  });
  it("changes future schedules without rewriting past records and records each schedule version", async () => {
    const { id } = await routine();
    await reconcile(id, "2026-10-23T15:00:00Z");
    const before = (await rows(id)).filter(task => task.scheduled_date < "2026-10-23");
    const changed = await testEnvironment().admin.from("task_recurrence_rules").update({ frequency: "weekly", days_of_week: [1], timezone: "America/New_York" }).eq("id", id);
    expect(changed.error).toBeNull();
    expect((await rows(id)).filter(task => task.scheduled_date < "2026-10-23")).toEqual(before);
    const versions = await owner.client.from("routine_schedule_versions").select("id").eq("routine_id", id);
    expect(versions.data).toHaveLength(2);
    const paused = await testEnvironment().admin.from("task_recurrence_rules").update({ paused: true }).eq("id", id);
    expect(paused.error).toBeNull();
    await reconcile(id, "2026-11-02T15:00:00Z");
    expect((await rows(id)).filter(task => task.scheduled_date >= "2026-10-25")).toHaveLength(0);
  });
  it("clamps and deduplicates month days and respects custom weekdays and leap years", async () => {
    const { admin } = testEnvironment();
    const matches = async (schedule: object, date: string) => {
      const result = await admin.rpc("routine_scheduled_on", { s: { starts_on: "2026-01-01", interval_count: 1, frequency: "monthly", end_type: "never", days_of_week: [], month_days: [], ...schedule }, d: date });
      expect(result.error).toBeNull(); return result.data;
    };
    expect(await matches({ month_days: [28, 29, 30, 31, -1] }, "2026-02-28")).toBe(true);
    expect(await matches({ month_days: [31] }, "2026-02-27")).toBe(false);
    expect(await matches({ starts_on: "2024-02-29", frequency: "yearly", month_day: 29 }, "2028-02-29")).toBe(true);
    expect(await matches({ starts_on: "2024-02-29", frequency: "yearly", month_day: 29 }, "2027-02-28")).toBe(true);
    expect(await matches({ starts_on: monday, frequency: "custom", days_of_week: [1, 3] }, tuesday)).toBe(false);
    expect(await matches({ starts_on: monday, frequency: "custom", days_of_week: [1, 3] }, "2026-10-21")).toBe(true);
  });
  it("resumes today without turning the intervening paused days into misses", async () => {
    const { id } = await routine({ paused: true });
    const { admin } = testEnvironment();
    await reconcile(id, new Date().toISOString());
    expect((await admin.from("task_recurrence_rules").update({ paused: false }).eq("id", id)).error).toBeNull();
    const tasks = await rows(id);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].occurrence_status).toBe("not_scheduled");
    expect(tasks[1].occurrence_status).toBe("pending");
    expect(tasks.some(task => task.occurrence_status === "not_completed")).toBe(false);
  });
  it("calendar reads retain missed dates with owner and range boundaries", async () => {
    const { id, taskId } = await routine();
    await reconcile(id, "2026-10-20T18:00:00Z");
    const app = createApiApp();
    const url = `http://localhost/api/v1/routine-occurrences?from=${monday}&through=${tuesday}`;
    const response = await app.request(url, { headers: { Authorization: `Bearer ${owner.session.access_token}` } });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.tasks.find((task: { id: string }) => task.id === taskId)?.occurrenceStatus).toBe("not_completed");
    const otherResponse = await app.request(url, { headers: { Authorization: `Bearer ${other.session.access_token}` } });
    expect((await otherResponse.json()).data.tasks).toEqual([]);
    const invalid = await app.request("http://localhost/api/v1/routine-occurrences?from=2020-01-01&through=2026-01-01", { headers: { Authorization: `Bearer ${owner.session.access_token}` } });
    expect(invalid.status).toBe(422);
  });
  it("an agent task read alone reconciles an offline routine and omits its expired rows", async () => {
    const { id } = await routine();
    const response = await createApiApp().request("http://localhost/api/v1/tasks", { headers: { Authorization: `Bearer ${owner.session.access_token}` } });
    expect(response.status).toBe(200);
    const payload = await response.json();
    const active = payload.data.tasks.filter((task: { routineId?: string }) => task.routineId === id);
    expect(active).toHaveLength(1);
    expect(active[0].occurrenceStatus).toBe("pending");
    expect((await rows(id)).filter(task => task.occurrence_status === "not_completed").length).toBeGreaterThan(0);
  });
});
