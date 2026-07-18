import { afterEach, describe, expect, it } from "vitest";
import { createApiApp } from "./app";
import { hashCredential, setRuntimeForTests } from "./runtime";

describe("Sticky API contract", () => {
  const app = createApiApp();

  afterEach(() => setRuntimeForTests(undefined));

  it("returns the standard health envelope", async () => {
    const response = await app.request("http://sticky.test/api/health");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toMatchObject({ status: "ok", service: "sticky-api" });
    expect(body.meta.requestId).toEqual(expect.any(String));
    expect(response.headers.get("x-request-id")).toBe(body.meta.requestId);
  });

  it("rejects unauthenticated private API requests with a request id", async () => {
    const response = await app.request("http://sticky.test/api/v1/lists");
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toMatchObject({ code: "unauthorized", requestId: expect.any(String) });
  });

  it("rejects MCP discovery without a revocable agent credential", async () => {
    const response = await app.request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Host: "localhost" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } } }),
    });
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.message).toContain("credential");
  });

  it("forbids agent credentials from bulk-syncing Google into Sticky", async () => {
    const credentialId = "a3fb610b-852f-4877-b8ea-15d64a9a0cc4";
    const secret = "test-secret";
    const credential = {
      id: credentialId,
      user_id: "95c572f5-5bda-43f3-b038-dfa0e82316c4",
      provider: "littlebird",
      provider_user_id: null,
      token_hash: hashCredential(secret),
      scopes: ["integrations:write"],
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

    const response = await app.request("http://sticky.test/api/v1/integrations/google/sync-all", {
      method: "POST",
      headers: { Authorization: `Bearer stk_${credentialId}_${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        acknowledgedSeparationPreference: true,
        confirmedBulkCopy: true,
        confirmationPhrase: "SYNC GOOGLE INTO STICKY",
      }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "forbidden", message: "Only the signed-in Sticky owner can start a Google-to-Sticky sync." },
    });
  });

  it("rejects a signed-in bulk sync without the exact final confirmation", async () => {
    const userId = "c09e87f6-e83e-4314-90e6-e844db1879d9";
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => ({ data: { id: userId, is_active: true }, error: null }),
    };
    setRuntimeForTests({
      db: {
        auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
        from: () => query,
      } as never,
      repository: {} as never,
    });

    const response = await app.request("http://sticky.test/api/v1/integrations/google/sync-all", {
      method: "POST",
      headers: { Authorization: "Bearer signed-in-user", "Content-Type": "application/json" },
      body: JSON.stringify({
        acknowledgedSeparationPreference: true,
        confirmedBulkCopy: true,
        confirmationPhrase: "SYNC IT",
      }),
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "validation_error" } });
  });
});
