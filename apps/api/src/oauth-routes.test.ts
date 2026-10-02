import { afterEach, describe, expect, it, vi } from "vitest";
import { createOAuthApp } from "./oauth-routes";
import { CHATGPT_CLIENT, oauthResource } from "./oauth";
import { hashCredential, setRuntimeForTests } from "./runtime";

describe("OAuth HTTP token exchange", () => {
  afterEach(() => setRuntimeForTests(undefined));
  const app = createOAuthApp();
  const post = (body: Record<string, string>) => app.request("http://localhost/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body),
  });
  const request = { client_id: CHATGPT_CLIENT, resource: oauthResource(), grant_type: "authorization_code",
    code: "code", code_verifier: "a".repeat(43), redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect" };
  it("passes hashed secrets to the atomic exchange and returns uncached scoped tokens", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: "id", scopes: ["tasks:read"] }, error: null });
    setRuntimeForTests({ db: { rpc } as never, repository: {} as never });
    const response = await post(request); const body = await response.json();
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.scope).toBe("tasks:read"); expect(body.expires_in).toBe(3600);
    expect(rpc.mock.calls[0][1].p_code_hash).toBe(hashCredential("code"));
    expect(rpc.mock.calls[0][1].p_refresh_hash).toBe(hashCredential(body.refresh_token));
  });
  it("denies expired, reused, revoked, or otherwise invalid grants", async () => {
    setRuntimeForTests({ db: { rpc: async () => ({ data: null, error: null }) } as never, repository: {} as never });
    expect((await post(request)).status).toBe(400);
    expect((await post({ client_id: CHATGPT_CLIENT, resource: oauthResource(), grant_type: "refresh_token", refresh_token: "revoked" })).status).toBe(400);
  });
  it("does not query the database for a wrong client, resource, missing verifier, or added scope", async () => {
    const rpc = vi.fn(); setRuntimeForTests({ db: { rpc } as never, repository: {} as never });
    for (const body of [{ ...request, client_id: "other" }, { ...request, resource: "other" },
      { ...request, code_verifier: "" }, { ...request, scope: "credentials:manage" }]) expect((await post(body)).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("blocks cross-origin consent before checking authentication", async () => {
    const response = await app.request("http://localhost/consent", { method: "POST", headers: { Origin: "https://evil.example" } });
    expect(response.status).toBe(403);
  });
});
