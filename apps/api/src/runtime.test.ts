import { afterEach, describe, expect, it } from "vitest";
import { authenticateRequest, createCredentialToken, parseCredentialToken, setRuntimeForTests } from "./runtime";

describe("Sticky credential tokens", () => {
  it("preserves underscores inside the random secret", () => {
    expect(parseCredentialToken("stk_4d1cc3fa-546d-4618-8c6f-2191f29e0fc9_part_one_two")).toEqual({
      tokenPrefix: "stk_4d1cc3fa-546d-4618-8c6f-2191f29e0fc9",
      secret: "part_one_two",
    });
  });

  it("rejects malformed credential prefixes", () => {
    expect(parseCredentialToken("stk_not-a-uuid_secret")).toBeNull();
  });
});

describe("credential account access", () => {
  afterEach(() => setRuntimeForTests(undefined));

  function fixture(provider: string, profile: { id: string; is_active: boolean } | null, profileError = false, initiallyBound = false) {
    const id = "4d1cc3fa-546d-4618-8c6f-2191f29e0fc9";
    const credential = createCredentialToken(id);
    let providerUserId: string | null = initiallyBound ? "poke-account" : null;
    const writes: string[] = [];
    setRuntimeForTests({
      repository: {} as never,
      db: {
        from(table: string) {
          const filters = new Map<string, unknown>();
          let update: Record<string, unknown> | undefined;
          const query = {
            select() { return query; },
            eq(field: string, value: unknown) { filters.set(field, value); return query; },
            is() { return query; },
            update(value: Record<string, unknown>) { writes.push(table); update = value; return query; },
            async maybeSingle() {
              if (table === "users") return {
                data: profile && [...filters].every(([key, value]) => profile[key as keyof typeof profile] === value) ? profile : null,
                error: profileError ? { code: "unavailable" } : null,
              };
              if (typeof update?.provider_user_id === "string") providerUserId = update.provider_user_id;
              return { data: { id, user_id: "user-1", token_hash: credential.tokenHash, expires_at: null,
                provider, provider_user_id: providerUserId, scopes: ["tasks:read"] }, error: null };
            },
            then(resolve: (value: { error: null }) => unknown) { return Promise.resolve({ error: null }).then(resolve); },
          };
          return query;
        },
      } as never,
    });
    return { writes, request: new Request("http://localhost/api/v1/tasks", {
      headers: { authorization: `Bearer ${credential.token}`, "x-poke-user-id": "poke-account" },
    }) };
  }

  it("keeps the Poke idempotency identity stable across first binding, retries, and already-bound credentials", async () => {
    const { request } = fixture("poke", { id: "user-1", is_active: true });
    const first = await authenticateRequest(request, "first-request");
    const retry = await authenticateRequest(request, "retry-request");
    const bound = fixture("poke", { id: "user-1", is_active: true }, false, true);
    const existing = await authenticateRequest(bound.request, "existing-request");
    expect([first.actorId, retry.actorId, existing.actorId]).toEqual([
      "poke:poke-account", "poke:poke-account", "poke:poke-account",
    ]);
  });

  for (const provider of ["custom", "poke", "chatgpt_oauth"]) {
    it.each(["inactive", "missing", "lookup failure"])(`denies ${provider} credentials for %s accounts before any credential writes`, async (condition) => {
      const profile = condition === "missing" ? null : { id: "user-1", is_active: condition !== "inactive" };
      const { request, writes } = fixture(provider, profile, condition === "lookup failure");
      await expect(authenticateRequest(request, "request-1")).rejects.toMatchObject({ status: 401 });
      expect(writes).toEqual([]);
    });

    it(`preserves ${provider} access for active accounts`, async () => {
      const { request } = fixture(provider, { id: "user-1", is_active: true });
      await expect(authenticateRequest(request, "request-1")).resolves.toMatchObject({
        actorType: "agent", userId: "user-1", scopes: new Set(["tasks:read"]),
      });
    });
  }
});
