import { afterEach, describe, expect, it } from "vitest";
import { createMcpApp, moveListId, moveSubtaskId, moveTaskId, resolveMcpIdempotencyKey } from "./mcp";
import { POKE_MANUAL_CAPABILITIES } from "./poke-capabilities";
import { hashCredential, setRuntimeForTests } from "./runtime";
import { pushOutboxEvent } from "./services/google";

function setAgentCredentialRuntime(provider: "codex" | "littlebird" | "poke" = "littlebird") {
  const credentialId = "4d1cc3fa-546d-4618-8c6f-2191f29e0fc9";
  const secret = "test-secret";
  const pokeUserId = "de01e3f2-ce70-4377-ab25-7c6a6e91e83a";
  const credential = {
    id: credentialId,
    user_id: "d55e5980-ceb7-4bdf-ac92-1a9a873875a7",
    provider,
    provider_user_id: provider === "poke" ? pokeUserId : null,
    token_hash: hashCredential(secret),
    scopes: ["tasks:read", "tasks:write", "tasks:destructive", "calendar:read", "calendar:write", "calendar:destructive"],
    expires_at: null,
  };
  const query = {
    select: () => query,
    update: () => query,
    eq: () => query,
    is: () => query,
    maybeSingle: async () => ({ data: credential, error: null }),
  };
  setRuntimeForTests({ db: { from: () => query } as never, repository: {} as never });
  return { credentialId, secret, pokeUserId };
}

describe("Sticky MCP source isolation", () => {
  afterEach(() => setRuntimeForTests(undefined));

  it("gives Codex separate Sticky and live Google tool sets", async () => {
    const { credentialId, secret } = setAgentCredentialRuntime("codex");

    const response = await createMcpApp().request("http://localhost/", {
      method: "POST",
      headers: {
        Authorization: `Bearer stk_${credentialId}_${secret}`,
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        Host: "localhost",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { result: { tools: Array<{ name: string; description: string; inputSchema: { required?: string[] } }> } };
    const tools = new Map(body.result.tools.map((tool) => [tool.name, tool]));
    expect(tools.has("list_tasks")).toBe(true);
    expect(tools.has("list_subtasks")).toBe(true);
    expect(tools.has("add_subtask")).toBe(true);
    expect(tools.has("update_subtask")).toBe(true);
    expect(tools.has("complete_subtask")).toBe(true);
    expect(tools.has("restore_subtask")).toBe(true);
    expect(tools.has("move_subtask")).toBe(true);
    expect(tools.has("reorder_subtasks")).toBe(true);
    expect(tools.has("delete_subtask")).toBe(true);
    expect(tools.has("list_task_recurrences")).toBe(true);
    expect(tools.has("set_task_recurrence")).toBe(true);
    expect(tools.has("set_task_recurrence_paused")).toBe(true);
    expect(tools.has("remove_task_recurrence")).toBe(true);
    expect(tools.get("create_task")?.description).toContain("recurrence");
    expect(tools.get("complete_task")?.description).toContain("next scheduled occurrence");
    expect(tools.get("add_subtask")?.description).toContain("never claim the integration cannot create subtasks");
    expect(tools.get("create_task")?.description).toContain("all of its Sticky subtasks");
    expect(tools.has("move_list")).toBe(true);
    expect(tools.has("reorder_lists")).toBe(true);
    expect(tools.get("delete_list")?.description).toContain("every Sticky task");
    expect(tools.get("delete_list")?.description).toContain("never deletes a Google Tasks list");
    expect(tools.has("create_calendar_event")).toBe(true);
    expect(tools.get("list_google_tasks")?.description).toContain("without copying them into Sticky");
    expect(tools.get("create_google_task")?.description).toContain("never creates a Sticky task");
    expect(tools.get("create_google_task_list")?.description).toContain("never creates a Sticky list");
    expect(tools.get("delete_google_task_list")?.description).toContain("never touches Sticky");
    expect(tools.get("list_google_calendar_events")?.description).toContain("does not create Sticky Calendar events");
    expect(tools.get("create_google_calendar_event")?.description).toContain("never creates a Sticky Calendar event");
    expect(tools.get("complete_google_task")?.description).toContain("never changes or creates a Sticky task");
    expect(tools.has("restore_google_task")).toBe(true);
    expect(tools.has("preview_google_tasks_to_sticky")).toBe(true);
    expect(tools.has("copy_google_tasks_to_sticky")).toBe(true);
    expect(tools.has("move_google_tasks_to_sticky")).toBe(true);
    expect(tools.get("complete_task")?.inputSchema.required).toContain("taskId");
    expect(tools.get("complete_task")?.inputSchema.required).not.toContain("version");
  });

  it("gives Poke Sticky tools and the guarded bridge without overlapping routine Google tools", async () => {
    const { credentialId, secret, pokeUserId } = setAgentCredentialRuntime("poke");

    const response = await createMcpApp().request("http://localhost/", {
      method: "POST",
      headers: {
        Authorization: `Bearer stk_${credentialId}_${secret}`,
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        Host: "localhost",
        "X-Poke-User-Id": pokeUserId,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { result: { tools: Array<{ name: string; description: string; inputSchema: { required?: string[] } }> } };
    const tools = new Map(body.result.tools.map((tool) => [tool.name, tool]));
    const requiredParityTools = new Set(POKE_MANUAL_CAPABILITIES.flatMap((capability) => capability.tools));
    expect([...requiredParityTools].filter((tool) => !tools.has(tool))).toEqual([]);
    expect(tools.has("list_tasks")).toBe(true);
    expect(tools.has("create_task")).toBe(true);
    expect(tools.has("list_subtasks")).toBe(true);
    expect(tools.has("add_subtask")).toBe(true);
    expect(tools.has("update_subtask")).toBe(true);
    expect(tools.has("complete_subtask")).toBe(true);
    expect(tools.has("restore_subtask")).toBe(true);
    expect(tools.has("move_subtask")).toBe(true);
    expect(tools.has("reorder_subtasks")).toBe(true);
    expect(tools.has("delete_subtask")).toBe(true);
    expect(tools.has("list_task_recurrences")).toBe(true);
    expect(tools.has("set_task_recurrence")).toBe(true);
    expect(tools.has("set_task_recurrence_paused")).toBe(true);
    expect(tools.has("remove_task_recurrence")).toBe(true);
    expect(tools.get("create_task")?.description).toContain("Never substitute a reminder for recurrence");
    expect(tools.get("complete_task")?.description).toContain("next scheduled occurrence");
    expect(tools.has("move_list")).toBe(true);
    expect(tools.has("reorder_lists")).toBe(true);
    expect(tools.has("delete_list")).toBe(true);
    expect(tools.has("list_calendar_events")).toBe(true);
    expect(tools.has("preview_google_tasks_to_sticky")).toBe(true);
    expect(tools.has("copy_google_tasks_to_sticky")).toBe(true);
    expect(tools.has("move_google_tasks_to_sticky")).toBe(true);
    expect(tools.has("list_google_tasks")).toBe(false);
    expect(tools.has("create_google_task")).toBe(false);
    expect(tools.has("complete_google_task")).toBe(false);
    expect(tools.has("list_google_calendar_events")).toBe(false);
    expect(tools.has("create_google_calendar_event")).toBe(false);
    expect(tools.get("update_task")?.inputSchema.required).not.toContain("version");
    expect(tools.get("move_task")?.inputSchema.required).not.toContain("version");
    expect(tools.get("update_calendar_event")?.inputSchema.required).not.toContain("version");
    expect(tools.get("archive_list")?.inputSchema.required).not.toContain("version");
  });

  it("returns 405 for the optional GET stream instead of timing out on Vercel", async () => {
    const { credentialId, secret, pokeUserId } = setAgentCredentialRuntime("poke");
    const response = await createMcpApp().request("http://localhost/", {
      method: "GET",
      headers: {
        Authorization: `Bearer stk_${credentialId}_${secret}`,
        Accept: "text/event-stream",
        Host: "localhost",
        "X-Poke-User-Id": pokeUserId,
      },
    });

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it("does not reuse a JSON-RPC id as an idempotency key across HTTP requests", () => {
    const credentialId = "4d1cc3fa-546d-4618-8c6f-2191f29e0fc9";
    const first = resolveMcpIdempotencyKey(null, credentialId, "http-request-1");
    const second = resolveMcpIdempotencyKey(null, credentialId, "http-request-2");

    expect(first).toBe(`mcp:${credentialId}:http-request-1`);
    expect(second).toBe(`mcp:${credentialId}:http-request-2`);
    expect(second).not.toBe(first);
  });

  it("preserves a client-provided idempotency key for explicit mutation retries", () => {
    expect(resolveMcpIdempotencyKey(
      "poke-retry-42",
      "4d1cc3fa-546d-4618-8c6f-2191f29e0fc9",
      "http-request-2",
    )).toBe("poke-retry-42");
  });

  it("moves a Sticky list immediately before or after another list", () => {
    const original = ["jobs", "internships", "next-three", "software"];
    expect(moveListId(original, "jobs", "internships", "before")).toEqual(original);
    expect(moveListId(original, "jobs", "internships", "after")).toEqual(["internships", "jobs", "next-three", "software"]);
    expect(moveListId(original, "software", "internships", "before")).toEqual(["jobs", "software", "internships", "next-three"]);
  });

  it("moves a Sticky subtask immediately before or after another subtask", () => {
    const original = ["research", "prototype", "ship", "review"];
    expect(moveSubtaskId(original, "ship", "research", "before")).toEqual([
      "ship", "research", "prototype", "review",
    ]);
    expect(moveSubtaskId(original, "research", "ship", "after")).toEqual([
      "prototype", "ship", "research", "review",
    ]);
  });

  it("moves a Sticky task immediately before or after another active task", () => {
    const original = ["first", "second", "third", "fourth"];
    expect(moveTaskId(original, "third", "first", "before")).toEqual(["third", "first", "second", "fourth"]);
    expect(moveTaskId(original, "first", "third", "after")).toEqual(["second", "third", "first", "fourth"]);
  });

  it("rejects invalid Sticky task moves", () => {
    expect(() => moveTaskId(["one", "two"], "one", "one", "before")).toThrow("different Sticky tasks");
    expect(() => moveTaskId(["one", "two"], "missing", "two", "after")).toThrow("not found in the list");
  });

  it("rejects invalid Sticky subtask moves", () => {
    expect(() => moveSubtaskId(["one", "two"], "one", "one", "before")).toThrow("different Sticky subtasks");
    expect(() => moveSubtaskId(["one", "two"], "missing", "two", "after")).toThrow("not found under the parent task");
  });

  it("rejects ambiguous or unknown Sticky list moves", () => {
    expect(() => moveListId(["jobs", "internships"], "jobs", "jobs", "before")).toThrow("different Sticky lists");
    expect(() => moveListId(["jobs", "internships"], "missing", "jobs", "before")).toThrow("not found");
  });

  it("keeps the legacy Google mirror pipeline inert by default", async () => {
    const previous = process.env.GOOGLE_SYNC_ENABLED;
    delete process.env.GOOGLE_SYNC_ENABLED;
    try {
      await expect(pushOutboxEvent({ aggregate_type: "task", event_type: "task.created" })).resolves.toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.GOOGLE_SYNC_ENABLED;
      else process.env.GOOGLE_SYNC_ENABLED = previous;
    }
  });
});
