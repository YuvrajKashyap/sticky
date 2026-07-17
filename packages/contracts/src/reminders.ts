import { z } from "zod";
import { idSchema, versionSchema } from "./api";

export const reminderChannelSchema = z.enum(["push", "poke"]);
export const reminderKindSchema = z.enum(["absolute", "relative"]);

export const reminderDtoSchema = z.object({
  id: idSchema,
  taskId: idSchema,
  kind: reminderKindSchema,
  remindAt: z.iso.datetime(),
  relativeMinutes: z.number().int().positive().nullable(),
  channels: z.array(reminderChannelSchema).min(1),
  status: z.enum(["scheduled", "delivering", "delivered", "cancelled", "failed"]),
  version: versionSchema,
});

export const createReminderSchema = z.object({
  kind: reminderKindSchema,
  remindAt: z.iso.datetime().optional(),
  relativeMinutes: z.number().int().positive().max(525_600).optional(),
  channels: z.array(reminderChannelSchema).min(1),
}).superRefine((value, ctx) => {
  if (value.kind === "absolute" && !value.remindAt) {
    ctx.addIssue({ code: "custom", path: ["remindAt"], message: "Absolute reminders need a date and time." });
  }
  if (value.kind === "relative" && !value.relativeMinutes) {
    ctx.addIssue({ code: "custom", path: ["relativeMinutes"], message: "Relative reminders need an offset." });
  }
});

export const snoozeReminderSchema = z.object({
  version: versionSchema,
  remindAt: z.iso.datetime(),
});

export type ReminderDto = z.infer<typeof reminderDtoSchema>;
export type CreateReminderInput = z.infer<typeof createReminderSchema>;
