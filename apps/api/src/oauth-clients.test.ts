import { afterEach, expect, it, vi } from "vitest";
import { createOAuthApp } from "./oauth-routes";
import { validateAuthorization, OAUTH_SCOPES, oauthResource } from "./oauth";

// Synthetic fixture, not Grok's real callback.
const fixture = { id: "test-grok", name: "Grok Bot", redirectUris: ["https://client.example/callback"], registration: true };
afterEach(() => vi.unstubAllEnvs());
const register = (redirect_uris: string[]) => createOAuthApp().request("https://sticky.test/register", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ redirect_uris }),
});
it("registers only an exact approved callback and grants dot's six scopes", async () => {
  vi.stubEnv("STICKY_OAUTH_CLIENTS", JSON.stringify([fixture]));
  const result = await register(fixture.redirectUris);
  expect(result.status).toBe(201);
  const body = await result.json();
  expect(body.client_id).toBe(fixture.id);
  expect(body.scope.split(" ")).toEqual(OAUTH_SCOPES);
  for (const uri of ["https://evil.example/callback", "https://client.example/callback/", "https://client.example/callback?evil=1"]) {
    expect((await register([uri])).status).toBe(400);
  }
  expect((await register([...fixture.redirectUris, "https://evil.example/callback"])).status).toBe(400);
});
it("authorizes a configured client without fetching arbitrary metadata", async () => {
  vi.stubEnv("STICKY_OAUTH_CLIENTS", JSON.stringify([fixture]));
  const params = new URLSearchParams({ client_id: fixture.id, redirect_uri: fixture.redirectUris[0], resource: oauthResource(),
    response_type: "code", code_challenge: "a".repeat(43), code_challenge_method: "S256", state: "test", scope: OAUTH_SCOPES.join(" ") });
  expect((await validateAuthorization(params)).clientName).toBe("Grok Bot");
  params.set("redirect_uri", "https://client.example/not-approved");
  await expect(validateAuthorization(params)).rejects.toThrow();
});
it("fails closed before any additional clients are configured", async () => {
  vi.stubEnv("STICKY_OAUTH_CLIENTS", "[]");
  expect((await register(fixture.redirectUris)).status).toBe(400);
});
