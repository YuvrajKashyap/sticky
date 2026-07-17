import { z } from "zod";
import { idSchema } from "./api";

export const integrationProviderSchema = z.enum(["google_tasks", "google_workspace", "poke"]);
export const integrationStatusSchema = z.enum(["disconnected", "connecting", "healthy", "degraded", "revoked"]);

export const googleListSelectionSchema = z.object({
  externalListIds: z.array(z.string().min(1)).max(100),
});

export const googleCalendarSelectionSchema = z.object({
  calendars: z.array(z.object({
    externalCalendarId: z.string().min(1).max(1_000),
    calendarId: idSchema.optional(),
    name: z.string().trim().min(1).max(80).optional(),
    syncDirection: z.enum(["two_way", "import_only", "export_only"]).default("two_way"),
    isDefaultTarget: z.boolean().default(false),
  })).max(100),
});

export const apiCredentialCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  provider: z.string().trim().min(1).max(40).default("custom"),
  providerUserId: z.string().trim().max(200).nullable().default(null),
  scopes: z.array(z.enum([
    "tasks:read", "tasks:write", "tasks:destructive",
    "calendar:read", "calendar:write", "calendar:destructive",
    "integrations:read", "integrations:write",
  ])).min(1),
});

export const apiCredentialRevokeSchema = z.object({ id: idSchema });
