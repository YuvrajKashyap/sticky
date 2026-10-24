import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// Destructive ONLY to the named disposable local verification stack. Never reads
// .env.local, accepts a remote URL, or invokes --linked / db push.
assert(process.argv.includes("--disposable-local"), "Pass --disposable-local to reset the test stack.");
const windows = process.platform === "win32";
function cli(args, quiet = false) {
  const run = spawnSync(windows ? "npx.cmd" : "npx", ["--no-install", "supabase", ...args], { encoding: "utf8", shell: windows });
  if (run.status !== 0) throw new Error(run.stderr || "Local Supabase command failed.");
  if (!quiet) console.log(`Local Supabase ${args.slice(0, 2).join(" ")} passed.`);
  return run.stdout;
}
const local = JSON.parse(cli(["status", "-o", "json"], true));
const endpoint = new URL(local.API_URL);
assert(["127.0.0.1", "localhost"].includes(endpoint.hostname) && endpoint.port === "55321", "Refusing to reset anything except localhost:55321.");
cli(["db", "reset", "--local", "--version", "20261002134600"]);
const admin = createClient("http://127.0.0.1:55321", local.SERVICE_ROLE_KEY, { db: { schema: "sticky" }, auth: { persistSession: false } });
async function ok(query) { const result = await query; assert.equal(result.error, null, result.error?.message); return result.data; }
async function waitForSchema(column = "id") {
  for (let attempt = 0; attempt < 60; attempt++) {
    const ready = await admin.from("tasks").select(column).limit(1);
    if (!ready.error) return;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error("Disposable PostgREST schema did not become ready.");
}
await waitForSchema();
const email = `migration-${randomUUID()}@example.invalid`;
await ok(admin.from("allowed_emails").insert({ email, role: "owner", is_active: true }));
const account = await admin.auth.admin.createUser({ email, password: randomUUID(), email_confirm: true });
assert.equal(account.error, null);
const userId = account.data.user.id;
await ok(admin.from("users").insert({ id: userId, email, role: "owner", is_active: true }));
const listId = randomUUID(), taskId = randomUUID(), currentId = randomUUID(), routineId = randomUUID();
await ok(admin.from("lists").insert({ id: listId, user_id: userId, name: "Migration fixture" }));
await ok(admin.from("tasks").insert({ id: taskId, user_id: userId, list_id: listId, title: "Legacy routine", due_date: "2026-10-19" }));
await ok(admin.from("task_recurrence_rules").insert({ id: routineId, user_id: userId, task_id: taskId, frequency: "daily", starts_on: "2026-10-19" }));
await ok(admin.rpc("complete_task_with_recurrence", { p_task_id: taskId, p_next_task_id: currentId, p_next_due_date: "2026-10-20", p_request_user_id: userId }));
const columns = "id,title,details,due_date,due_time,is_completed,completed_at";
const before = await ok(admin.from("tasks").select(columns).eq("user_id", userId).order("id"));
cli(["migration", "up", "--local"]);
// PostgREST refreshes its schema cache after the local migration notification.
await waitForSchema("routine_id");
const after = await ok(admin.from("tasks").select(columns).eq("user_id", userId).order("id"));
assert.deepEqual(after, before, "Migration must preserve every original task and completion timestamp.");
const migrated = await ok(admin.from("tasks").select("id,scheduled_date,occurrence_status").eq("routine_id", routineId));
assert.deepEqual(migrated, [{ id: currentId, scheduled_date: "2026-10-20", occurrence_status: "unknown" }]);
await ok(admin.rpc("reconcile_routine_occurrences", { p_request_user_id: userId }));
const once = await ok(admin.from("tasks").select("id,scheduled_date").eq("routine_id", routineId).order("id"));
await ok(admin.rpc("reconcile_routine_occurrences", { p_request_user_id: userId }));
assert.deepEqual(await ok(admin.from("tasks").select("id,scheduled_date").eq("routine_id", routineId).order("id")), once);
assert(once.every(row => row.scheduled_date === "2026-10-20" || row.scheduled_date >= new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())), "No historical misses may be invented.");
await ok(admin.from("lists").delete().eq("id", listId));
assert.equal((await admin.auth.admin.deleteUser(userId)).error, null);
await ok(admin.from("allowed_emails").delete().eq("email", email));
console.log("PASS legacy records, timestamps, unknown boundary, local migration and idempotent reconciliation.");
