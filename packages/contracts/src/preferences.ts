import { z } from "zod";

export const workspacePreferencesDtoSchema = z.object({
  completedOpenByList: z.record(z.string(), z.boolean()),
  density: z.enum(["compact", "comfortable"]),
  colorMode: z.enum(["light", "dark"]),
  boardStyle: z.enum(["pad", "wood"]),
  taskViewFilter: z.enum(["all", "today", "due", "overdue", "recurring", "subtasks"]),
  taskSortMode: z.enum(["custom", "due"]),
});

export const updateWorkspacePreferencesSchema = workspacePreferencesDtoSchema.partial().refine(
  (input) => Object.keys(input).length > 0,
  { message: "At least one workspace preference must change." },
);

export type WorkspacePreferencesDto = z.infer<typeof workspacePreferencesDtoSchema>;
export type UpdateWorkspacePreferencesInput = z.infer<typeof updateWorkspacePreferencesSchema>;
