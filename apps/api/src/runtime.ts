import { createHash, randomBytes } from "node:crypto";
import type { ActorContext, StickyScope } from "@sticky/contracts";
import { createStickyAdminClient, StickyRepository, type StickySupabaseClient } from "@sticky/data";
import { StickyDomainError } from "@sticky/domain";

export type ApiRuntime = {
  db: StickySupabaseClient;
  repository: StickyRepository;
};

let runtime: ApiRuntime | undefined;

export function getRuntime(): ApiRuntime {
  if (!runtime) {
    const db = createStickyAdminClient();
    runtime = { db, repository: new StickyRepository(db) };
  }
  return runtime;
}

export function setRuntimeForTests(value: ApiRuntime | undefined): void {
  runtime = value;
}

export function hashCredential(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function createCredentialToken(id: string) {
  const secret = randomBytes(32).toString("base64url");
  const tokenPrefix = `stk_${id}`;
  return { token: `${tokenPrefix}_${secret}`, tokenPrefix, tokenHash: hashCredential(secret) };
}

export function parseCredentialToken(token: string): { tokenPrefix: string; secret: string } | null {
  const parts = /^(stk_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_(.+)$/i.exec(token);
  return parts ? { tokenPrefix: parts[1], secret: parts[2] } : null;
}

export async function authenticateRequest(request: Request, requestId: string): Promise<ActorContext> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new StickyDomainError("unauthorized", "Sign in or provide a Sticky API credential.", 401);
  }
  const token = authorization.slice(7).trim();
  if (token.startsWith("stk_")) return authenticateCredential(token, request, requestId);

  const { db } = getRuntime();
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new StickyDomainError("unauthorized", "Your Sticky session is no longer valid.", 401);
  const { data: profile } = await db.from("users").select("id,is_active").eq("id", data.user.id).eq("is_active", true).maybeSingle();
  if (!profile) throw new StickyDomainError("forbidden", "This account is not active in Sticky.", 403);

  return {
    userId: data.user.id,
    actorType: "human",
    actorId: data.user.id,
    credentialId: null,
    scopes: new Set<StickyScope>([
      "tasks:read", "tasks:write", "tasks:destructive",
      "calendar:read", "calendar:write", "calendar:destructive",
      "integrations:read", "integrations:write", "credentials:manage",
    ]),
    requestId,
    idempotencyKey: request.headers.get("idempotency-key"),
    providerUserId: null,
    accessToken: token,
  };
}

async function authenticateCredential(token: string, request: Request, requestId: string): Promise<ActorContext> {
  const tokenParts = parseCredentialToken(token);
  if (!tokenParts) throw new StickyDomainError("unauthorized", "Invalid Sticky API credential.", 401);
  const { tokenPrefix, secret } = tokenParts;
  const { db } = getRuntime();
  const { data, error } = await db.from("api_credentials").select("*")
    .eq("token_prefix", tokenPrefix).is("revoked_at", null).maybeSingle();
  if (error) {
    console.error("Sticky credential lookup failed", { code: error.code, message: error.message });
    throw new StickyDomainError("internal_error", "Sticky could not verify this API credential.", 500);
  }
  if (!data || data.token_hash !== hashCredential(secret) || (data.expires_at && new Date(data.expires_at) <= new Date())) {
    throw new StickyDomainError("unauthorized", "Invalid or revoked Sticky API credential.", 401);
  }
  const pokeUserId = request.headers.get("x-poke-user-id")?.trim() || null;
  if (data.provider === "poke") {
    if (!pokeUserId) {
      throw new StickyDomainError("forbidden", "Poke did not identify the requesting account.", 403);
    }

    if (!data.provider_user_id) {
      const { data: bound, error: bindError } = await db.from("api_credentials")
        .update({ provider_user_id: pokeUserId })
        .eq("id", data.id)
        .is("provider_user_id", null)
        .select("provider_user_id")
        .maybeSingle();
      if (bindError) throw bindError;

      if (!bound) {
        const { data: current, error: currentError } = await db.from("api_credentials")
          .select("provider_user_id")
          .eq("id", data.id)
          .maybeSingle();
        if (currentError) throw currentError;
        if (current?.provider_user_id !== pokeUserId) {
          throw new StickyDomainError("forbidden", "This Sticky key is already connected to another Poke account.", 403);
        }
      }
    } else if (pokeUserId !== data.provider_user_id) {
      throw new StickyDomainError("forbidden", "This Sticky key is connected to another Poke account.", 403);
    }
  }
  void db.from("api_credentials").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return {
    userId: data.user_id,
    actorType: "agent",
    actorId: `${data.provider}:${data.provider_user_id ?? data.id}`,
    credentialId: data.id,
    scopes: new Set(data.scopes as StickyScope[]),
    requestId,
    idempotencyKey: request.headers.get("idempotency-key"),
    providerUserId: pokeUserId,
    accessToken: null,
  };
}
