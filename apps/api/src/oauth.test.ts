import { afterEach, describe, expect, it, vi } from "vitest";
import { validateAuthorization, oauthMetadata, oauthResource, pkceChallenge } from "./oauth";

const parameters = () => new URLSearchParams({
  client_id: "https://chatgpt.com/oauth/client.json",
  redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect",
  response_type: "code", resource: oauthResource(), state: "opaque-state",
  code_challenge: "a".repeat(43), code_challenge_method: "S256",
  scope: "tasks:read tasks:write tasks:destructive calendar:read calendar:write calendar:destructive",
});
describe("ChatGPT OAuth boundary", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("advertises PKCE, refresh, CIMD, and a canonical resource", () => {
    expect(oauthMetadata().code_challenge_methods_supported).toEqual(["S256"]);
    expect(oauthMetadata().grant_types_supported).toContain("refresh_token");
    expect(oauthMetadata().client_id_metadata_document_supported).toBe(true);
    expect(oauthResource()).toBe("https://sticky.yuvrajkashyap.com/api/mcp");
  });
  it("validates the published ChatGPT client and exact callback", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      client_id: "https://chatgpt.com/oauth/client.json",
      redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
      token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
    })));
    expect((await validateAuthorization(parameters())).scopes).toContain("tasks:destructive");
  });
  it.each([
    ["client_id", "https://evil.example/client.json"],
    ["redirect_uri", "https://chatgpt.com.evil.example/callback"],
    ["resource", "https://other.example/mcp"],
    ["code_challenge_method", "plain"],
    ["code_challenge", "short"],
    ["scope", "credentials:manage"],
    ["response_type", "token"],
  ])("rejects unsafe %s before fetching a client", async (key, value) => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const params = parameters(); params.set(key, value);
    await expect(validateAuthorization(params)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects duplicated security parameters", async () => {
    const params = parameters(); params.append("redirect_uri", "https://evil.example");
    await expect(validateAuthorization(params)).rejects.toThrow();
  });
  it("uses the RFC 7636 S256 example", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});
