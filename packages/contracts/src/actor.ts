import { z } from "zod";

export const actorTypeSchema = z.enum(["human", "agent", "google", "workflow", "webhook"]);
export const scopeSchema = z.enum([
  "tasks:read",
  "tasks:write",
  "tasks:destructive",
  "calendar:read",
  "calendar:write",
  "calendar:destructive",
  "integrations:read",
  "integrations:write",
  "credentials:manage",
]);

export type ActorType = z.infer<typeof actorTypeSchema>;
export type StickyScope = z.infer<typeof scopeSchema>;

export type ActorContext = {
  userId: string;
  actorType: ActorType;
  actorId: string;
  credentialId: string | null;
  scopes: ReadonlySet<StickyScope>;
  requestId: string;
  idempotencyKey: string | null;
  providerUserId: string | null;
  accessToken: string | null;
};
