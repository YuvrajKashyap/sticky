import { afterEach, describe, expect, it } from "vitest";
import { createMcpApp } from "./mcp";
import { hashCredential, setRuntimeForTests } from "./runtime";
import { pushOutboxEvent } from "./services/google";

describe("Sticky MCP source isolation", () => {
  afterEach(() => setRuntimeForTests(undefined));

  it("advertises separate Sticky and live Google tool sets", async () => {
    const credentialId = "4d1cc3fa-546d-4618-8c6f-2191f29e0fc9";
    const secret = "test-secret";
    const credential = {
      id: credentialId,
      user_id: "d55e5980-ceb7-4bdf-ac92-1a9a873875a7",
      provider: "littlebird",
      provider_user_id: null,
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
    setRuntimeForTests({
      db: { from: () => query } as never,
      repository: {} as never,
    });

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
    const body = await response.json() as { result: { tools: Array<{ name: string; description: string }> } };
    const tools = new Map(body.result.tools.map((tool) => [tool.name, tool.description]));
    expect(tools.has("list_tasks")).toBe(true);
    expect(tools.has("create_calendar_event")).toBe(true);
    expect(tools.get("list_google_tasks")).toContain("without copying them into Sticky");
    expect(tools.get("create_google_task")).toContain("never creates a Sticky task");
    expect(tools.get("create_google_task_list")).toContain("never creates a Sticky list");
    expect(tools.get("delete_google_task_list")).toContain("never touches Sticky");
    expect(tools.get("list_google_calendar_events")).toContain("does not create Sticky Calendar events");
    expect(tools.get("create_google_calendar_event")).toContain("never creates a Sticky Calendar event");
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
