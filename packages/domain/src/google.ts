export type StickyGoogleTask = {
  title: string;
  details: string;
  dueDate: string | null;
  isCompleted: boolean;
};

export type GoogleTaskShape = {
  id?: string | null;
  title?: string | null;
  notes?: string | null;
  due?: string | null;
  status?: string | null;
  deleted?: boolean | null;
  hidden?: boolean | null;
  parent?: string | null;
  position?: string | null;
  updated?: string | null;
};

export function toGoogleTask(task: StickyGoogleTask): GoogleTaskShape {
  return {
    title: task.title,
    notes: task.details || null,
    due: task.dueDate ? `${task.dueDate}T00:00:00.000Z` : null,
    status: task.isCompleted ? "completed" : "needsAction",
  };
}

export function fromGoogleTask(task: GoogleTaskShape): StickyGoogleTask {
  return {
    title: task.title?.trim() || "Untitled task",
    details: task.notes ?? "",
    dueDate: task.due ? task.due.slice(0, 10) : null,
    isCompleted: task.status === "completed",
  };
}
