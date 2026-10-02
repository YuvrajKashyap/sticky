import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestOwner, testEnvironment } from "./fixtures";
import { authenticateRequest, hashCredential } from "../../apps/api/src/runtime";
import { requireScope } from "../../packages/domain/src/authorization";

describe("OAuth transactional security", () => {
  let owner: Awaited<ReturnType<typeof createTestOwner>>;
  beforeAll(async () => { owner = await createTestOwner(); });
  afterAll(async () => { await owner?.cleanup(); });
  async function exchange() {
    const { admin } = testEnvironment();
    const id = randomUUID(), code = randomUUID();
    const insert = await admin.from("oauth_codes").insert({ code_hash: code, user_id: owner.userId,
      client_id: "client", redirect_uri: "callback", resource: "resource", scopes: ["tasks:read"],
      challenge: "challenge", expires_at: new Date(Date.now() + 300000).toISOString() });
    expect(insert.error).toBeNull();
    const args = { p_code_hash: code, p_client_id: "client", p_redirect_uri: "callback", p_resource: "resource",
      p_challenge: "challenge", p_id: id, p_access_hash: hashCredential("access"), p_refresh_hash: randomUUID() };
    expect((await admin.rpc("exchange_oauth_code", { ...args, p_challenge: "wrong" })).data).toBeNull();
    const results = await Promise.all([admin.rpc("exchange_oauth_code", args), admin.rpc("exchange_oauth_code", args)]);
    expect(results.every(result => !result.error)).toBe(true);
    expect(results.filter(result => result.data !== null)).toHaveLength(1);
    return args;
  }
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
