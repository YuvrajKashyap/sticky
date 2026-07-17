import { describe, expect, it } from "vitest";
import { createApiApp } from "./app";

describe("Sticky API contract", () => {
  const app = createApiApp();

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
});
