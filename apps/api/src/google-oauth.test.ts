import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiApp } from "./app";
import { createCredentialToken, setRuntimeForTests } from "./runtime";

const provider = vi.hoisted(() => ({ exchange: vi.fn(), profile: vi.fn() }));
vi.mock("googleapis", () => ({
  google: {
    auth: { OAuth2: class {
      generateAuthUrl(options: { state: string }) { return `https://accounts.google.test/authorize?state=${encodeURIComponent(options.state)}`; }
      getToken(code: string) { return provider.exchange(code); }
      setCredentials() {}
    } },
    oauth2: () => ({ userinfo: { get: provider.profile } }),
  },
  tasks_v1: {}, calendar_v3: {},
}));

describe("Google connection browser binding", () => {
  const app = createApiApp();
  const origin = "https://sticky.test";
  let linked: Array<Record<string, unknown>>;
  beforeEach(() => {
    vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", Buffer.alloc(32, 1).toString("base64"));
    vi.stubEnv("GOOGLE_CLIENT_ID", "test-client");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-secret");
    vi.stubEnv("GOOGLE_REDIRECT_URI", `${origin}/api/webhooks/google/oauth`);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", origin);
    provider.exchange.mockReset().mockResolvedValue({ tokens: { access_token: "fixture-token", scope: "tasks" } });
    provider.profile.mockReset().mockResolvedValue({ data: { id: "google-user", email: "fixture@example.test" } });
    linked = [];
    const query = {
      select: () => query, eq: () => query,
      maybeSingle: async () => ({ data: { id: "sticky-user", is_active: true }, error: null }),
      upsert: (row: Record<string, unknown>) => { linked.push(row); return query; },
      single: async () => ({ data: { id: "connection" }, error: null }),
    };
    setRuntimeForTests({ db: {
      auth: { getUser: async () => ({ data: { user: { id: "sticky-user" } }, error: null }) },
      from: () => query,
    } as never, repository: {} as never });
  });
  afterEach(() => { setRuntimeForTests(undefined); vi.unstubAllEnvs(); });

  async function initiate() {
    const response = await app.request(`${origin}/api/v1/integrations/google/connect`, {
      method: "POST", headers: { Authorization: "Bearer human-session", Origin: origin },
    });
    const body = await response.json();
    return { response, state: new URL(body.data.authorizationUrl).searchParams.get("state")! };
  }
  const callback = (state: string, cookie?: string) => app.request(`${origin}/api/webhooks/google/oauth?code=fixture-code&state=${encodeURIComponent(state)}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });

  it("sets a secure browser-only connection cookie without exposing its nonce in the authorization URL", async () => {
    const { response, state } = await initiate();
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    const nonce = cookie!.split(";", 1)[0].split("=")[1];
    expect(Buffer.from(state.split(".")[0], "base64url").toString()).not.toContain(nonce);
  });

  it.each(["missing", "wrong browser"])("rejects %s binding before exchanging a code or linking an account", async (binding) => {
    const { response, state } = await initiate();
    const cookieName = response.headers.get("set-cookie")?.split("=")[0] ?? "sticky_google_oauth";
    const result = await callback(state, binding === "missing" ? undefined : `${cookieName}=${"x".repeat(43)}`);
    expect(result.status).toBe(403);
    expect(provider.exchange).not.toHaveBeenCalled();
    expect(linked).toEqual([]);
  });

  it("rejects a signed authorization started in another browser even when both have valid cookies", async () => {
    const attacker = await initiate();
    const victim = await initiate();
    const result = await callback(attacker.state, victim.response.headers.get("set-cookie")!.split(";", 1)[0]);
    expect(result.status).toBe(403);
    expect(provider.exchange).not.toHaveBeenCalled();
    expect(linked).toEqual([]);
  });

  it("links the initiating user's account with a matching browser cookie and clears that cookie", async () => {
    const { response, state } = await initiate();
    const result = await callback(state, response.headers.get("set-cookie")?.split(";", 1)[0]);
    expect(result.status).toBe(302);
    expect(linked).toHaveLength(1);
    expect(linked[0]).toMatchObject({ user_id: "sticky-user", provider_account_id: "google-user" });
    expect(result.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("does not initiate an account connection with an agent credential", async () => {
    const credential = createCredentialToken("4d1cc3fa-546d-4618-8c6f-2191f29e0fc9");
    const query = {
      select: () => query, eq: () => query, is: () => query, update: () => query,
      maybeSingle: async () => ({ data: { id: "credential", user_id: "sticky-user", provider: "custom", token_hash: credential.tokenHash,
        expires_at: null, provider_user_id: null, scopes: ["integrations:write"] }, error: null }),
    };
    setRuntimeForTests({ db: { from: () => query } as never, repository: {} as never });
    const response = await app.request(`${origin}/api/v1/integrations/google/connect`, {
      method: "POST", headers: { Authorization: `Bearer ${credential.token}` },
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
