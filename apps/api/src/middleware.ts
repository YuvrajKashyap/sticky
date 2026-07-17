import type { ActorContext } from "@sticky/contracts";
import { StickyDomainError } from "@sticky/domain";
import type { MiddlewareHandler } from "hono";
import { authenticateRequest } from "./runtime";

export type ApiVariables = {
  actor: ActorContext;
  requestId: string;
};

const mutationMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const requestContext: MiddlewareHandler<{ Variables: ApiVariables }> = async (c, next) => {
  const requestId = c.req.header("x-request-id")?.slice(0, 120) || crypto.randomUUID();
  c.set("requestId", requestId);
  c.header("X-Request-Id", requestId);
  await next();
};

export const authenticate: MiddlewareHandler<{ Variables: ApiVariables }> = async (c, next) => {
  c.set("actor", await authenticateRequest(c.req.raw, c.get("requestId")));
  await next();
};

export const enforceOrigin: MiddlewareHandler<{ Variables: ApiVariables }> = async (c, next) => {
  if (!mutationMethods.has(c.req.method) || c.req.header("authorization")) return next();
  const origin = c.req.header("origin");
  const expected = new URL(c.req.url).origin;
  if (!origin || origin !== expected) throw new StickyDomainError("forbidden", "Request origin was rejected.", 403);
  await next();
};

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export const agentRateLimit: MiddlewareHandler<{ Variables: ApiVariables }> = async (c, next) => {
  const actor = c.get("actor");
  if (actor.actorType !== "agent") return next();
  const now = Date.now();
  const bucket = rateBuckets.get(actor.actorId);
  if (!bucket || bucket.resetAt <= now) rateBuckets.set(actor.actorId, { count: 1, resetAt: now + 60_000 });
  else if (bucket.count >= 120) throw new StickyDomainError("rate_limited", "Too many agent requests. Try again shortly.", 429);
  else bucket.count += 1;
  await next();
};
