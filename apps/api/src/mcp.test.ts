import { afterEach, describe, expect, it } from "vitest";
import { createMcpApp, resolveMcpIdempotencyKey } from "./mcp";
import { hashCredential, setRuntimeForTests } from "./runtime";
import { pushOutboxEvent } from "./services/google";

function setAgentCredentialRuntime(provider: "littlebird" | "poke" = "littlebird") {
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

  it("advertises separate Sticky and live Google tool sets", async () => {
    const { credentialId, secret } = setAgentCredentialRuntime();

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
    const body = await response.json() as { result: { tools: Array<{ name: string; description: string }> } };
    const tools = new Map(body.result.tools.map((tool) => [tool.name, tool]));
    expect(tools.has("list_tasks")).toBe(true);
    expect(tools.has("create_task")).toBe(true);
    expect(tools.has("list_calendar_events")).toBe(true);
    expect(tools.has("preview_google_tasks_to_sticky")).toBe(true);
    expect(tools.has("copy_google_tasks_to_sticky")).toBe(true);
    expect(tools.has("move_google_tasks_to_sticky")).toBe(true);
    expect(tools.has("list_google_tasks")).toBe(false);
    expect(tools.has("create_google_task")).toBe(false);
    expect(tools.has("complete_google_task")).toBe(false);
    expect(tools.has("list_google_calendar_events")).toBe(false);
    expect(tools.has("create_google_calendar_event")).toBe(false);
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
