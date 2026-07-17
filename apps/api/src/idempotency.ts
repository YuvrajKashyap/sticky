import { createHash } from "node:crypto";
import type { ActorContext } from "@sticky/contracts";
import { requireIdempotency, StickyDomainError } from "@sticky/domain";
import { getRuntime } from "./runtime";

type StoredResult<T> = { value: T; replayed: boolean };

function fingerprint(route: string, body: unknown): string {
  return createHash("sha256").update(`${route}:${JSON.stringify(body)}`).digest("hex");
}

export async function idempotent<T>(actor: ActorContext, route: string, body: unknown, operation: () => Promise<T>): Promise<StoredResult<T>> {
  const key = requireIdempotency(actor);
  const requestFingerprint = fingerprint(route, body);
  const { db } = getRuntime();
  const record = {
    user_id: actor.userId,
    actor_id: actor.actorId,
    idempotency_key: key,
    request_fingerprint: requestFingerprint,
  };
  const { data: inserted, error } = await db.from("idempotency_records").insert(record).select("id").maybeSingle();

  if (error?.code === "23505") {
    const { data: existing } = await db.from("idempotency_records").select("*")
      .eq("user_id", actor.userId).eq("actor_id", actor.actorId).eq("idempotency_key", key).single();
    if (existing.request_fingerprint !== requestFingerprint) {
      throw new StickyDomainError("conflict", "That idempotency key was already used for a different request.", 409);
    }
    if (existing.completed_at) return { value: existing.response_body as T, replayed: true };
    throw new StickyDomainError("conflict", "An identical request is still being processed.", 409);
  }
  if (error || !inserted) throw new StickyDomainError("internal_error", "Sticky could not reserve this request.", 500);

  try {
    const value = await operation();
    await db.from("idempotency_records").update({
      response_status: 200,
      response_body: value,
      completed_at: new Date().toISOString(),
    }).eq("id", inserted.id);
    return { value, replayed: false };
  } catch (operationError) {
    await db.from("idempotency_records").delete().eq("id", inserted.id);
    throw operationError;
  }
}
