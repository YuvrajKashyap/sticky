import { z } from "zod";
import { idSchema, versionSchema } from "./api";
import { stickyColorSchema } from "./lists";

export const calendarDtoSchema = z.object({
  id: idSchema,
  userId: idSchema,
  name: z.string(),
  color: stickyColorSchema,
  timezone: z.string(),
  isDefault: z.boolean(),
  isVisible: z.boolean(),
  archivedAt: z.iso.datetime().nullable(),
  version: versionSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

const eventBaseSchema = z.object({
  id: idSchema.optional(),
  calendarId: idSchema.optional(),
  taskId: idSchema.nullable().default(null),
  title: z.string().trim().min(1).max(240),
  details: z.string().max(20_000).default(""),
  location: z.string().max(500).default(""),
  timezone: z.string().min(1).max(100).default("America/Chicago"),
  recurrence: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  status: z.enum(["confirmed", "tentative", "cancelled"]).default("confirmed"),
  transparency: z.enum(["opaque", "transparent"]).default("opaque"),
  color: stickyColorSchema.nullable().default(null),
});

export const createCalendarEventSchema = z.discriminatedUnion("allDay", [
  eventBaseSchema.extend({
    allDay: z.literal(false),
    startAt: z.iso.datetime({ offset: true }),
    endAt: z.iso.datetime({ offset: true }),
  }),
  eventBaseSchema.extend({
    allDay: z.literal(true),
    startDate: z.iso.date(),
    endDate: z.iso.date(),
  }),
]).refine((event) => event.allDay
  ? event.endDate > event.startDate
  : new Date(event.endAt) > new Date(event.startAt), {
  message: "Calendar event must end after it starts.",
  path: ["endAt"],
});

export const updateCalendarEventSchema = z.object({
  version: versionSchema,
  calendarId: idSchema.optional(),
  taskId: idSchema.nullable().optional(),
  title: z.string().trim().min(1).max(240).optional(),
  details: z.string().max(20_000).optional(),
  location: z.string().max(500).optional(),
  allDay: z.boolean().optional(),
  startAt: z.iso.datetime({ offset: true }).nullable().optional(),
  endAt: z.iso.datetime({ offset: true }).nullable().optional(),
  startDate: z.iso.date().nullable().optional(),
  endDate: z.iso.date().nullable().optional(),
  timezone: z.string().min(1).max(100).optional(),
  recurrence: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
  status: z.enum(["confirmed", "tentative", "cancelled"]).optional(),
  transparency: z.enum(["opaque", "transparent"]).optional(),
  color: stickyColorSchema.nullable().optional(),
});

export const calendarEventDtoSchema = z.object({
  id: idSchema,
  userId: idSchema,
  calendarId: idSchema,
  taskId: idSchema.nullable(),
  title: z.string(),
  details: z.string(),
  location: z.string(),
  allDay: z.boolean(),
  startAt: z.iso.datetime().nullable(),
  endAt: z.iso.datetime().nullable(),
  startDate: z.iso.date().nullable(),
  endDate: z.iso.date().nullable(),
  timezone: z.string(),
  recurrence: z.array(z.string()),
  status: z.enum(["confirmed", "tentative", "cancelled"]),
  transparency: z.enum(["opaque", "transparent"]),
  color: stickyColorSchema.nullable(),
  version: versionSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const calendarRangeSchema = z.object({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
}).refine(({ from, to }) => new Date(to) > new Date(from), {
  message: "Calendar range must end after it starts.",
  path: ["to"],
});

export const timeBlockTaskSchema = z.object({
  startAt: z.iso.datetime({ offset: true }),
  durationMinutes: z.number().int().min(5).max(1_440).default(30),
  calendarId: idSchema.optional(),
  location: z.string().max(500).default(""),
});

export type CalendarDto = z.infer<typeof calendarDtoSchema>;
export type CalendarEventDto = z.infer<typeof calendarEventDtoSchema>;
export type CreateCalendarEventInput = z.infer<typeof createCalendarEventSchema>;
export type UpdateCalendarEventInput = z.infer<typeof updateCalendarEventSchema>;
export type CalendarRangeInput = z.infer<typeof calendarRangeSchema>;
export type TimeBlockTaskInput = z.infer<typeof timeBlockTaskSchema>;
