import { z } from "zod";
import { idSchema } from "./api";

export const integrationProviderSchema = z.enum(["google_tasks", "poke"]);
export const integrationStatusSchema = z.enum(["disconnected", "connecting", "healthy", "degraded", "revoked"]);

export const googleListSelectionSchema = z.object({
  externalListIds: z.array(z.string().min(1)).max(100),
});

export const apiCredentialCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  provider: z.string().trim().min(1).max(40).default("custom"),
  providerUserId: z.string().trim().max(200).nullable().default(null),
  scopes: z.array(z.enum(["tasks:read", "tasks:write", "tasks:destructive", "integrations:read", "integrations:write"])).min(1),
});

export const apiCredentialRevokeSchema = z.object({ id: idSchema });
