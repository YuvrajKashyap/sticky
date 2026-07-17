import { z } from "zod";
import { idSchema, versionSchema } from "./api";
import { stickyColorSchema } from "./lists";

export const taskDtoSchema = z.object({
  id: idSchema,
  userId: idSchema,
  listId: idSchema,
  title: z.string(),
  details: z.string(),
  color: stickyColorSchema,
  dueDate: z.iso.date().nullable(),
  dueTime: z.string().nullable(),
  timezone: z.string(),
  isCompleted: z.boolean(),
  completedAt: z.iso.datetime().nullable(),
  sortOrder: z.number().int(),
  completedSortOrder: z.number().int().nullable(),
  version: versionSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const createTaskSchema = z.object({
  id: idSchema.optional(),
  listId: idSchema,
  title: z.string().trim().min(1).max(180),
  details: z.string().max(20_000).default(""),
  color: stickyColorSchema.default("sun"),
  dueDate: z.iso.date().nullable().default(null),
  dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/).nullable().default(null),
  timezone: z.string().min(1).max(100).default("America/Chicago"),
  sortOrder: z.number().int().min(0).optional(),
});

export const updateTaskSchema = z.object({
  version: versionSchema,
  title: z.string().trim().min(1).max(180).optional(),
  details: z.string().max(20_000).optional(),
  color: stickyColorSchema.optional(),
  dueDate: z.iso.date().nullable().optional(),
  dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/).nullable().optional(),
  timezone: z.string().min(1).max(100).optional(),
});

export const moveTaskSchema = z.object({
  targetListId: idSchema,
  version: versionSchema,
});

export const completeTaskSchema = z.object({ version: versionSchema });
export const reorderTasksSchema = z.object({
  taskIds: z.array(idSchema).min(1),
  listId: idSchema,
});

export const createSubtaskSchema = z.object({
  id: idSchema.optional(),
  title: z.string().trim().min(1).max(160),
  sortOrder: z.number().int().min(0).optional(),
});

export type TaskDto = z.infer<typeof taskDtoSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
