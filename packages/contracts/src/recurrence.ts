import { z } from "zod";
import { idSchema } from "./api";

export const recurrenceFrequencySchema = z.enum(["daily", "weekly", "monthly", "yearly", "custom"]);
export const recurrenceEndTypeSchema = z.enum(["never", "on_date", "after_count"]);

export const recurrenceScheduleSchema = z.object({
  frequency: recurrenceFrequencySchema,
  intervalCount: z.number().int().min(1).max(365).default(1),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  monthDay: z.number().int().min(1).max(31).nullable().default(null),
  startsOn: z.iso.date(),
  endType: recurrenceEndTypeSchema.default("never"),
  endDate: z.iso.date().nullable().default(null),
  occurrenceCount: z.number().int().positive().nullable().default(null),
  timezone: z.string().min(1).max(100).default("America/Chicago"),
  paused: z.boolean().default(false),
}).superRefine((value, context) => {
  if (new Set(value.daysOfWeek).size !== value.daysOfWeek.length) {
    context.addIssue({ code: "custom", path: ["daysOfWeek"], message: "Weekdays must be unique." });
  }
  if (value.frequency === "weekly" && value.daysOfWeek.length === 0) {
    context.addIssue({ code: "custom", path: ["daysOfWeek"], message: "Weekly recurrence needs at least one weekday." });
  }
  if (value.endType === "never" && (value.endDate !== null || value.occurrenceCount !== null)) {
    context.addIssue({ code: "custom", path: ["endType"], message: "A never-ending recurrence cannot have an end date or occurrence count." });
  }
  if (value.endType === "on_date" && (!value.endDate || value.occurrenceCount !== null)) {
    context.addIssue({ code: "custom", path: ["endDate"], message: "An on-date recurrence needs only an end date." });
  }
  if (value.endType === "on_date" && value.endDate && value.endDate < value.startsOn) {
    context.addIssue({ code: "custom", path: ["endDate"], message: "The recurrence cannot end before it starts." });
  }
  if (value.endType === "after_count" && (value.endDate !== null || value.occurrenceCount === null)) {
    context.addIssue({ code: "custom", path: ["occurrenceCount"], message: "An occurrence-limited recurrence needs only a positive occurrence count." });
  }
});

export const recurrenceRuleDtoSchema = z.object({
  id: idSchema,
  userId: idSchema,
  taskId: idSchema,
  frequency: recurrenceFrequencySchema,
  intervalCount: z.number().int(),
  daysOfWeek: z.array(z.number().int()),
  monthDay: z.number().int().nullable(),
  startsOn: z.iso.date(),
  endType: recurrenceEndTypeSchema,
  endDate: z.iso.date().nullable(),
  occurrenceCount: z.number().int().nullable(),
  timezone: z.string(),
  paused: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type RecurrenceFrequency = z.infer<typeof recurrenceFrequencySchema>;
export type RecurrenceScheduleInput = z.infer<typeof recurrenceScheduleSchema>;
export type RecurrenceRuleDto = z.infer<typeof recurrenceRuleDtoSchema>;
