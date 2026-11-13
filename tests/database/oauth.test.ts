import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestOwner, testEnvironment } from "./fixtures";
import { authenticateRequest, hashCredential } from "../../apps/api/src/runtime";
import { requireScope } from "../../packages/domain/src/authorization";

describe("OAuth transactional security", () => {
  let owner: Awaited<ReturnType<typeof createTestOwner>>;
  beforeAll(async () => { owner = await createTestOwner(); });
  afterAll(async () => { await owner?.cleanup(); });
  async function exchange(clientId = "client") {
    const { admin } = testEnvironment();
    const id = randomUUID(), code = randomUUID();
    const insert = await admin.from("oauth_codes").insert({ code_hash: code, user_id: owner.userId,
      client_id: clientId, redirect_uri: "callback", resource: "resource", scopes: ["tasks:read"],
      challenge: "challenge", expires_at: new Date(Date.now() + 300000).toISOString() });
    expect(insert.error).toBeNull();
    const args = { p_code_hash: code, p_client_id: clientId, p_redirect_uri: "callback", p_resource: "resource",
      p_challenge: "challenge", p_id: id, p_access_hash: hashCredential("access"), p_refresh_hash: randomUUID() };
    expect((await admin.rpc("exchange_oauth_code", { ...args, p_challenge: "wrong" })).data).toBeNull();
    expect((await admin.rpc("exchange_oauth_code", { ...args, p_redirect_uri: "unlisted" })).data).toBeNull();
    expect((await admin.rpc("exchange_oauth_code", { ...args, p_client_id: "wrong-client" })).data).toBeNull();
    const results = await Promise.all([admin.rpc("exchange_oauth_code", args), admin.rpc("exchange_oauth_code", args)]);
    expect(results.every(result => !result.error)).toBe(true);
    expect(results.filter(result => result.data !== null)).toHaveLength(1);
    return args;
  }
  it("isolates two OAuth clients when refreshing and revoking", async () => {
    const { admin } = testEnvironment();
    const chatgpt = await exchange("https://chatgpt.com/oauth/client.json");
    const grok = await exchange("synthetic-grok-fixture");
    const refresh = { p_refresh_hash: grok.p_refresh_hash, p_client_id: chatgpt.p_client_id, p_resource: "resource",
      p_access_hash: "replacement", p_next_refresh_hash: randomUUID() };
    expect((await admin.rpc("rotate_oauth_token", refresh)).data).toBeNull();
    expect((await admin.rpc("revoke_oauth_token", { p_client_id: grok.p_client_id,
      p_token_hash: grok.p_refresh_hash, p_token_prefix: "" })).error).toBeNull();
    expect((await admin.from("api_credentials").select("revoked_at").eq("id", grok.p_id).single()).data?.revoked_at).not.toBeNull();
    expect((await admin.from("api_credentials").select("revoked_at").eq("id", chatgpt.p_id).single()).data?.revoked_at).toBeNull();
  });
  it("consumes a code once, rotates refresh tokens, and revokes the family on replay", async () => {
    const { admin } = testEnvironment(); const args = await exchange();
    const refresh = { p_refresh_hash: args.p_refresh_hash, p_client_id: "client", p_resource: "resource",
      p_access_hash: "new-access", p_next_refresh_hash: randomUUID() };
    expect((await admin.rpc("rotate_oauth_token", { ...refresh, p_resource: "wrong" })).data).toBeNull();
    const rotated = await admin.rpc("rotate_oauth_token", refresh);
    expect(rotated.error).toBeNull(); expect(rotated.data.id).toBe(args.p_id);
    expect((await admin.rpc("rotate_oauth_token", refresh)).data).toBeNull();
    expect((await admin.from("api_credentials").select("revoked_at").eq("id", args.p_id).single()).data?.revoked_at).not.toBeNull();
  });
  it("blocks refresh after owner revocation and denies direct browser access", async () => {
    const { admin, anonymous } = testEnvironment(); const args = await exchange();
    const request = new Request("https://sticky.yuvrajkashyap.com/api/mcp", { headers: { Authorization: `Bearer stk_${args.p_id}_access` } });
    const actor = await authenticateRequest(request, randomUUID());
    expect(actor.userId).toBe(owner.userId);
    expect(actor.actorType).toBe("agent");
    expect(() => requireScope(actor, "tasks:read")).not.toThrow();
    expect(() => requireScope(actor, "tasks:write")).toThrow();
    expect(() => requireScope(actor, "credentials:manage")).toThrow();
    await admin.from("api_credentials").update({ revoked_at: new Date().toISOString() }).eq("id", args.p_id);
    await expect(authenticateRequest(request, randomUUID())).rejects.toThrow("revoked");
    const refreshed = await admin.rpc("rotate_oauth_token", { p_refresh_hash: args.p_refresh_hash, p_client_id: "client",
      p_resource: "resource", p_access_hash: "unused", p_next_refresh_hash: randomUUID() });
    expect(refreshed.error).toBeNull(); expect(refreshed.data).toBeNull();
    for (const client of [owner.client, anonymous]) {
      expect((await client.from("oauth_codes").select("*")).error).not.toBeNull();
      expect((await client.rpc("exchange_oauth_code", args)).error).not.toBeNull();
    }
  });
});
