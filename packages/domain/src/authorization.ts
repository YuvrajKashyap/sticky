import type { ActorContext, StickyScope } from "@sticky/contracts";
import { StickyDomainError } from "./errors";

export function requireScope(actor: ActorContext, scope: StickyScope): void {
  if (actor.actorType === "human" || actor.scopes.has(scope)) return;
  throw new StickyDomainError("forbidden", `This credential does not have ${scope} access.`, 403);
}

export function requireDestructiveConfirmation(
  actor: ActorContext,
  confirmation: { confirmed: true; summary: string } | undefined,
  expectedTerms: string[],
): void {
  requireScope(actor, "tasks:destructive");
  if (actor.actorType === "human") return;
  const summary = confirmation?.summary.toLowerCase() ?? "";
  if (!confirmation?.confirmed || !expectedTerms.every((term) => summary.includes(term.toLowerCase()))) {
    throw new StickyDomainError(
      "validation_error",
      "Agent destructive actions require an explicit confirmation summary.",
      422,
      { expectedTerms },
    );
  }
}

export function requireIdempotency(actor: ActorContext): string {
  if (actor.actorType === "human" && actor.idempotencyKey === null) return actor.requestId;
  if (!actor.idempotencyKey) {
    throw new StickyDomainError("idempotency_required", "This mutation requires an Idempotency-Key header.", 400);
  }
  return actor.idempotencyKey;
}
