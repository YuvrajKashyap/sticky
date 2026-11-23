import { describe, expect, it } from "vitest";
import { createOAuthApp } from "./oauth-routes";
import { oauthResource, validateAuthorization } from "./oauth";

describe("public MCP client registration", () => {
  it("accepts a hosted and desktop callback, then binds consent to an exact registered URI", async () => {
    const redirect_uris = ["https://www.cursor.com/agents/mcp/oauth/callback", "http://localhost:8787/callback"];
    const response = await createOAuthApp().request("https://sticky.test/register", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Cursor", redirect_uris, token_endpoint_auth_method: "none" }),
    });
    expect(response.status).toBe(201);
    const { client_id } = await response.json();
    for (const redirect_uri of redirect_uris) {
      const query = new URLSearchParams({ client_id, redirect_uri, response_type: "code", resource: oauthResource(),
        code_challenge: "a".repeat(43), code_challenge_method: "S256", scope: "tasks:read", state: "test" });
      expect((await validateAuthorization(query)).clientName).toContain(new URL(redirect_uri).host);
      query.set("redirect_uri", redirect_uri + "/other");
      await expect(validateAuthorization(query)).rejects.toThrow();
    }
  });
});
