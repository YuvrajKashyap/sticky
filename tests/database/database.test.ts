import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { StickyRepository } from "../../packages/data/src/repository";
import type { ActorContext } from "@sticky/contracts";
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

  it("rejects one of two concurrent moves using the same task version", async () => {
    const { admin } = testEnvironment();
    const repository = new StickyRepository(admin);
    const taskId = randomUUID();
    const targets = [randomUUID(), randomUUID()];
    expect((await admin.from("lists").insert(targets.map((id, index) => ({ id, user_id: owner.userId, name: `Move target ${index}` })))).error).toBeNull();
    const inserted = await admin.from("tasks").insert({ id: taskId, user_id: owner.userId, list_id: owner.listId, title: "Concurrent move" }).select("version").single();
    expect(inserted.error).toBeNull();
    const actor = { userId: owner.userId, actorType: "human", actorId: owner.userId, credentialId: null,
      scopes: new Set(["tasks:read", "tasks:write"]), requestId: randomUUID(), idempotencyKey: null,
      providerUserId: null, accessToken: owner.session.access_token } as ActorContext;
    // Hold both initial reads until they see the same version. Real writes and
    // locks still run in Postgres, so this deterministically tests the race.
    const original = repository.getTask.bind(repository);
    let reads = 0;
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(repository, "getTask").mockImplementation(async (...args) => {
      const task = await original(...args);
      if (++reads <= 2) { if (reads === 2) release(); await barrier; }
      return task;
    });
    const results = await Promise.allSettled(targets.map(id => repository.moveTask(actor, taskId, id, inserted.data!.version)));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find(result => result.status === "rejected"), JSON.stringify(results)).toMatchObject({ reason: { code: "conflict", status: 409 } });
    const saved = await admin.from("tasks").select("list_id,version").eq("id", taskId).single();
    const winner = results.findIndex(result => result.status === "fulfilled");
    expect(saved.data).toEqual({ list_id: targets[winner], version: inserted.data!.version + 1 });
    const args = { p_task_id: taskId, p_target_list_id: owner.listId, p_expected_version: saved.data!.version, p_request_user_id: owner.userId };
    expect((await owner.client.rpc("move_task_versioned", args)).error).not.toBeNull();
    expect((await testEnvironment().anonymous.rpc("move_task_versioned", args)).error).not.toBeNull();
    expect((await admin.rpc("move_task_versioned", { ...args, p_request_user_id: other.userId })).error?.code).toBe("42501");
    expect((await admin.rpc("move_task_versioned", { ...args, p_expected_version: null })).error?.code).toBe("PT409");
    expect((await admin.from("tasks").select("list_id,version").eq("id", taskId).single()).data).toEqual(saved.data);
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

  it("persists monthly selections and retains them after recurring completion", async () => {
    const taskId = randomUUID();
    await command({ kind: "table", table: "tasks", action: "insert", payload: { id: taskId, user_id: owner.userId, list_id: owner.listId, title: "Monthly", due_date: "2026-09-01" } });
    await command({ kind: "table", table: "task_recurrence_rules", action: "insert", payload: { user_id: owner.userId, task_id: taskId, frequency: "monthly", starts_on: "2026-09-01", month_days: [1, 15, -1] } });
    const nextId = randomUUID();
    await command({ kind: "rpc", name: "complete_task_with_recurrence", args: { p_task_id: taskId, p_next_task_id: nextId, p_next_due_date: "2026-09-15", p_next_due_time: null, p_next_occurrence_count: null } });
    const saved = await owner.client.from("task_recurrence_rules").select("month_days").eq("task_id", taskId).single();
    expect(saved.error).toBeNull();
    expect(saved.data?.month_days).toEqual([1, 15, -1]);
    const { admin } = testEnvironment();
    const invalid = await admin.from("task_recurrence_rules").update({ month_days: [0, 32] }).eq("task_id", taskId);
    expect(invalid.error?.code).toBe("23514");
  });

  it("completes only the specified occurrence and retains transactional activity", async () => {
    const { admin } = testEnvironment();
    const taskId = randomUUID();
    await command({ kind: "table", table: "tasks", action: "insert", payload: { id: taskId, user_id: owner.userId, list_id: owner.listId, title: "Recurring", due_date: "2026-09-04" } });
    await command({ kind: "table", table: "task_recurrence_rules", action: "insert", payload: { user_id: owner.userId, task_id: taskId, frequency: "daily", starts_on: "2026-09-04" } });
    const before = await admin.from("outbox_events").select("id", { head: true, count: "exact" }).eq("user_id", owner.userId);
    const denied = await admin.rpc("complete_task_with_recurrence", { p_task_id: taskId, p_request_user_id: other.userId });
    expect(denied.error).not.toBeNull();
    const original = await owner.client.from("tasks").select("is_completed").eq("id", taskId).single();
    expect(original.data?.is_completed).toBe(false);
    const after = await admin.from("outbox_events").select("id", { head: true, count: "exact" }).eq("user_id", owner.userId);
    expect(after.count).toBe(before.count);
    const guessedNextId = randomUUID();
    await command({ kind: "rpc", name: "complete_task_with_recurrence", args: { p_task_id: taskId, p_next_task_id: guessedNextId, p_next_due_date: "2026-09-05", p_next_due_time: null, p_next_occurrence_count: null } });
    const next = await owner.client.from("tasks").select("id").eq("id", guessedNextId).maybeSingle();
    expect(next.data).toBeNull();
    const completed = await owner.client.from("tasks").select("is_completed,occurrence_status").eq("id", taskId).single();
    expect(completed.data).toEqual({ is_completed: true, occurrence_status: "completed" });
    const events = await admin.from("outbox_events").select("id", { head: true, count: "exact" }).eq("user_id", owner.userId);
    expect(events.count!).toBeGreaterThan(before.count!);
  });
});
