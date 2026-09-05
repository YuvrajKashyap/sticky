import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApp } from "../../apps/api/src/app";
import { createTestOwner, testEnvironment } from "./fixtures";

describe("authenticated Sticky persistence", () => {
  let owner: Awaited<ReturnType<typeof createTestOwner>>;
  let other: Awaited<ReturnType<typeof createTestOwner>>;
  const app = createApiApp();
  beforeAll(async () => { owner = await createTestOwner(); other = await createTestOwner(); });
  afterAll(async () => { await owner?.cleanup(); await other?.cleanup(); });

  async function command(body: object, user = owner) {
    const response = await app.request("http://localhost/api/v1/web-command", {
      method: "POST",
      headers: { Authorization: `Bearer ${user.session.access_token}`, "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    expect(response.status, JSON.stringify(payload)).toBe(200);
    return payload.data.result;
  }

  it("creates, edits, completes and restores a task through the real web command path", async () => {
    const id = randomUUID();
    await command({ kind: "table", table: "tasks", action: "insert", payload: { id, list_id: owner.listId, title: "Before", user_id: owner.userId } });
    await command({ kind: "table", table: "tasks", action: "update", payload: { title: "Saved edit" }, filters: [{ field: "id", value: id }] });
    await command({ kind: "rpc", name: "set_task_completed", args: { p_task_id: id, p_completed: true } });
    let row = await owner.client.from("tasks").select("title,is_completed").eq("id", id).single();
    expect(row.error).toBeNull();
    expect(row.data).toEqual({ title: "Saved edit", is_completed: true });
    await command({ kind: "rpc", name: "set_task_completed", args: { p_task_id: id, p_completed: false } });
    row = await owner.client.from("tasks").select("title,is_completed").eq("id", id).single();
    expect(row.data?.is_completed).toBe(false);
  });

  it("denies anonymous reads, cross-owner reads, and direct browser writes", async () => {
    const { anonymous } = testEnvironment();
    const anon = await anonymous.from("tasks").select("id");
    expect(anon.error !== null || anon.data?.length === 0).toBe(true);
    const crossOwner = await other.client.from("tasks").select("id").eq("user_id", owner.userId);
    expect(crossOwner.error).toBeNull();
    expect(crossOwner.data).toEqual([]);
    const direct = await owner.client.from("tasks").insert({ user_id: owner.userId, list_id: owner.listId, title: "Bypass" });
    expect(direct.error).not.toBeNull();
    const response = await app.request("http://localhost/api/v1/web-command", {
      method: "POST",
      headers: { Authorization: `Bearer ${other.session.access_token}`, "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ kind: "rpc", name: "clear_completed_tasks", args: { p_list_id: owner.listId } }),
    });
    expect(response.status).toBe(403);
  });

  it("paginates past the configured cap and loads a completed pile only when requested", async () => {
    const { admin } = testEnvironment();
    const listId = randomUUID();
    const list = await admin.from("lists").insert({ id: listId, user_id: owner.userId, name: "History test" });
    expect(list.error).toBeNull();
    const rows = Array.from({ length: 1205 }, (_, index) => ({ id: randomUUID(), user_id: owner.userId, list_id: listId, title: `History ${index}`, is_completed: true, completed_at: new Date().toISOString() }));
    const inserted = await admin.from("tasks").insert(rows);
    expect(inserted.error).toBeNull();
    const headers = { Authorization: `Bearer ${owner.session.access_token}` };
    const closed = await app.request("http://localhost/api/v1/workspace/board", { headers });
    expect(closed.status).toBe(200);
    const initial = (await closed.json()).data;
    expect(initial.history.completedCounts[listId]).toBe(1205);
    expect(initial.tasks.some((task: { list_id: string }) => task.list_id === listId)).toBe(false);
    const open = await app.request(`http://localhost/api/v1/workspace/board?completedListIds=${listId}`, { headers });
    expect(open.status).toBe(200);
    const loaded = (await open.json()).data;
    expect(loaded.tasks.filter((task: { list_id: string }) => task.list_id === listId)).toHaveLength(1205);
    expect(loaded.history.loadedCounts[listId]).toBe(1205);
  });

  it("commits recurrence and outbox events atomically, and rolls both back on invalid completion", async () => {
    const { admin } = testEnvironment();
    const taskId = randomUUID();
    await command({ kind: "table", table: "tasks", action: "insert", payload: { id: taskId, user_id: owner.userId, list_id: owner.listId, title: "Recurring", due_date: "2026-09-04" } });
    await command({ kind: "table", table: "task_recurrence_rules", action: "insert", payload: { user_id: owner.userId, task_id: taskId, frequency: "daily", starts_on: "2026-09-04" } });
    const before = await admin.from("outbox_events").select("id", { head: true, count: "exact" }).eq("user_id", owner.userId);
    const invalid = await admin.rpc("complete_task_with_recurrence", { p_task_id: taskId, p_next_task_id: taskId, p_next_due_date: "2026-09-05", p_next_due_time: null, p_next_occurrence_count: null, p_request_user_id: owner.userId });
    expect(invalid.error).not.toBeNull();
    const original = await owner.client.from("tasks").select("is_completed").eq("id", taskId).single();
    expect(original.data?.is_completed).toBe(false);
    const after = await admin.from("outbox_events").select("id", { head: true, count: "exact" }).eq("user_id", owner.userId);
    expect(after.count).toBe(before.count);
    const nextId = randomUUID();
    await command({ kind: "rpc", name: "complete_task_with_recurrence", args: { p_task_id: taskId, p_next_task_id: nextId, p_next_due_date: "2026-09-05", p_next_due_time: null, p_next_occurrence_count: null } });
    const next = await owner.client.from("tasks").select("due_date,is_completed").eq("id", nextId).single();
    expect(next.data).toEqual({ due_date: "2026-09-05", is_completed: false });
    const events = await admin.from("outbox_events").select("id", { head: true, count: "exact" }).eq("user_id", owner.userId);
    expect(events.count!).toBeGreaterThan(before.count!);
  });
});
