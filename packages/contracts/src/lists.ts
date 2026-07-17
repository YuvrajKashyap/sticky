import { z } from "zod";
import { idSchema, versionSchema } from "./api";

export const stickyColorSchema = z.enum([
  "sun",
  "coral",
  "mint",
  "sky",
  "violet",
  "ink",
  "ember",
  "rose",
  "lime",
  "teal",
  "azure",
  "magenta",
]);

export const listDtoSchema = z.object({
  id: idSchema,
  userId: idSchema,
  name: z.string(),
  color: stickyColorSchema,
  sortOrder: z.number().int(),
  isVisibleOnBoard: z.boolean(),
  archivedAt: z.iso.datetime().nullable(),
  version: versionSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const createListSchema = z.object({
  id: idSchema.optional(),
  name: z.string().trim().min(1).max(80),
  color: stickyColorSchema.default("sun"),
  sortOrder: z.number().int().min(0).optional(),
});

export const updateListSchema = z.object({
  version: versionSchema,
  name: z.string().trim().min(1).max(80).optional(),
  color: stickyColorSchema.optional(),
  isVisibleOnBoard: z.boolean().optional(),
  archived: z.boolean().optional(),
}).refine((input) => Object.keys(input).some((key) => key !== "version"), {
  message: "At least one list field must change.",
});

export const reorderListsSchema = z.object({
  listIds: z.array(idSchema).min(1),
});

export type ListDto = z.infer<typeof listDtoSchema>;
export type CreateListInput = z.infer<typeof createListSchema>;
export type UpdateListInput = z.infer<typeof updateListSchema>;
