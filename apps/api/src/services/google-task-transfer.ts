import { createHash } from "node:crypto";
import type { ActorContext, ListDto } from "@sticky/contracts";
import { StickyDomainError } from "@sticky/domain";
import { getRuntime } from "../runtime";
import { deleteGoogleTask, listGoogleTaskLists, listGoogleTasks } from "./google";

export type GoogleTaskTransferMode = "copy" | "move";

type GoogleTaskList = Awaited<ReturnType<typeof listGoogleTaskLists>>[number];
type GoogleTask = Awaited<ReturnType<typeof listGoogleTasks>>[number];

type ImportTask = {
  external_task_id: string;
  title: string;
  details: string;
  due_date: string | null;
  is_completed: boolean;
  completed_at: string | null;
  parent_id: string | null;
  position: string | null;
  updated_at: string | null;
};

type ImportedTaskLink = {
  id: string;
  sync_metadata: Record<string, unknown> | null;
};

export type GoogleTaskTransferDependencies = {
  listGoogleTaskLists(actor: ActorContext): Promise<GoogleTaskList[]>;
  listGoogleTasks(actor: ActorContext, input: { taskListId: string; includeCompleted: boolean; includeHidden: boolean }): Promise<GoogleTask[]>;
  listStickyLists(actor: ActorContext): Promise<ListDto[]>;
  getStickyList(actor: ActorContext, listId: string): Promise<ListDto>;
  importTasks(actor: ActorContext, input: {
    sourceListId: string;
    targetListId: string;
    transferId: string;
    mode: GoogleTaskTransferMode;
    tasks: ImportTask[];
  }): Promise<{ createdCount: number }>;
  listImportedTasks(actor: ActorContext, sourceListId: string, targetListId: string): Promise<ImportedTaskLink[]>;
  deleteGoogleTask(actor: ActorContext, taskListId: string, taskId: string): Promise<unknown>;
};

const defaultDependencies: GoogleTaskTransferDependencies = {
  listGoogleTaskLists,
  listGoogleTasks,
  listStickyLists: (current) => getRuntime().repository.listLists(current),
  getStickyList: (current, listId) => getRuntime().repository.getList(current, listId),
  async importTasks(current, input) {
    const { data, error } = await getRuntime().db.rpc("import_google_tasks", {
      p_source_list_id: input.sourceListId,
      p_target_list_id: input.targetListId,
      p_transfer_id: input.transferId,
      p_mode: input.mode,
      p_tasks: input.tasks,
      p_actor_type: current.actorType,
      p_actor_id: current.actorId,
      p_credential_id: current.credentialId,
      p_request_id: current.requestId,
      p_idempotency_key: current.idempotencyKey,
      p_request_user_id: current.userId,
    });
    if (error) {
      console.error("Sticky Google task import RPC failed", { code: error.code, message: error.message });
      throw new StickyDomainError("internal_error", "Sticky could not safely copy the Google tasks.", 500);
    }
    const summary = data as { created_count?: number } | null;
    return { createdCount: Number(summary?.created_count ?? 0) };
  },
  async listImportedTasks(current, sourceListId, targetListId) {
    const { data, error } = await getRuntime().db.from("tasks")
      .select("id,sync_metadata")
      .eq("user_id", current.userId)
      .eq("list_id", targetListId)
      .contains("sync_metadata", { source: "google_tasks", google_task_list_id: sourceListId });
    if (error) throw error;
    return (data ?? []) as ImportedTaskLink[];
  },
  deleteGoogleTask,
};

function requiredGoogleTasks(tasks: GoogleTask[]): Array<GoogleTask & { id: string }> {
  const missingIds = tasks.filter((task) => !task.id).length;
  if (missingIds) {
    throw new StickyDomainError("internal_error", "Google returned tasks without stable ids, so Sticky stopped before copying anything.", 502);
  }
  return tasks as Array<GoogleTask & { id: string }>;
}

function resolveGoogleList(lists: GoogleTaskList[], requested: string): GoogleTaskList & { id: string } {
  const value = requested.trim();
  const byId = lists.find((list) => list.id === value);
  if (byId?.id) return byId as GoogleTaskList & { id: string };
  const byName = lists.filter((list) => list.title.toLocaleLowerCase() === value.toLocaleLowerCase());
  if (byName.length === 1 && byName[0].id) return byName[0] as GoogleTaskList & { id: string };
  if (byName.length > 1) {
    throw new StickyDomainError("validation_error", `More than one Google Tasks list is named “${value}”. Use the exact Google list id.`, 422);
  }
  throw new StickyDomainError("not_found", `Google Tasks list “${value}” was not found.`, 404, {
    availableGoogleLists: lists.map((list) => ({ id: list.id, title: list.title })),
  });
}

function resolveStickyList(lists: ListDto[], requested: string): ListDto {
  const value = requested.trim();
  const list = lists.find((candidate) => candidate.id === value)
    ?? lists.find((candidate) => candidate.name.toLocaleLowerCase() === value.toLocaleLowerCase());
  if (list) return list;
  throw new StickyDomainError("not_found", `Sticky list “${value}” was not found.`, 404, {
    availableStickyLists: lists.map((candidate) => ({ id: candidate.id, name: candidate.name })),
  });
}

export function googleTaskTransferFingerprint(tasks: GoogleTask[]): string {
  const stableTasks = tasks.map((task) => ({
    id: task.id ?? null,
    title: task.title,
    notes: task.notes,
    completed: task.completed,
    dueDate: task.dueDate,
    completedAt: task.completedAt,
    updatedAt: task.updatedAt,
    parentId: task.parentId,
    position: task.position,
  })).sort((left, right) => String(left.id).localeCompare(String(right.id)));
  return createHash("sha256").update(JSON.stringify(stableTasks)).digest("hex");
}

function confirmationPhrase(mode: GoogleTaskTransferMode, taskCount: number): string {
  return mode === "move"
    ? `MOVE ${taskCount} GOOGLE TASKS TO STICKY AND DELETE GOOGLE ORIGINALS`
    : `COPY ${taskCount} GOOGLE TASKS TO STICKY`;
}

function importPayload(tasks: Array<GoogleTask & { id: string }>): ImportTask[] {
  const titles = new Map(tasks.map((task) => [task.id, task.title]));
  return tasks.map((task) => {
    const fullTitle = task.title.trim() || "Untitled task";
    const provenance = task.parentId
      ? `Originally a Google subtask of “${titles.get(task.parentId) ?? task.parentId}”.`
      : "";
    const originalTitle = fullTitle.length > 180 ? `Original Google title: ${fullTitle}` : "";
    const details = [task.notes, originalTitle, provenance].filter(Boolean).join("\n\n").slice(0, 20_000);
    return {
      external_task_id: task.id,
      title: fullTitle.slice(0, 180),
      details,
      due_date: task.dueDate,
      is_completed: task.completed,
      completed_at: task.completedAt,
      parent_id: task.parentId,
      position: task.position,
      updated_at: task.updatedAt,
    };
  });
}

export async function previewGoogleTaskTransfer(
  current: ActorContext,
  input: {
    googleTaskList: string;
    stickyList: string;
    mode: GoogleTaskTransferMode;
    includeCompleted: boolean;
    includeHidden: boolean;
  },
  dependencies: GoogleTaskTransferDependencies = defaultDependencies,
) {
  const [googleLists, stickyLists] = await Promise.all([
    dependencies.listGoogleTaskLists(current),
    dependencies.listStickyLists(current),
  ]);
  const source = resolveGoogleList(googleLists, input.googleTaskList);
  const target = resolveStickyList(stickyLists, input.stickyList);
  const tasks = requiredGoogleTasks(await dependencies.listGoogleTasks(current, {
    taskListId: source.id,
    includeCompleted: input.includeCompleted,
    includeHidden: input.includeHidden,
  }));
  if (!tasks.length) {
    throw new StickyDomainError("validation_error", "No Google tasks matched this transfer preview, so there is nothing to copy.", 422);
  }
  if (tasks.length > 500) {
    throw new StickyDomainError("validation_error", "This transfer contains more than 500 Google tasks. Split it into smaller source lists before moving or copying.", 422, {
      taskCount: tasks.length,
      maximumTaskCount: 500,
    });
  }

  return {
    operation: "one_time_google_tasks_to_sticky_transfer" as const,
    mode: input.mode,
    source: { system: "google_tasks" as const, listId: source.id, listName: source.title },
    destination: { system: "sticky" as const, listId: target.id, listName: target.name },
    includeCompleted: input.includeCompleted,
    includeHidden: input.includeHidden,
    taskCount: tasks.length,
    activeCount: tasks.filter((task) => !task.completed).length,
    completedCount: tasks.filter((task) => task.completed).length,
    sourceFingerprint: googleTaskTransferFingerprint(tasks),
    sample: tasks.slice(0, 10).map((task) => ({ id: task.id, title: task.title, completed: task.completed, dueDate: task.dueDate })),
    confirmationPhrase: confirmationPhrase(input.mode, tasks.length),
    confirmationRequired: input.mode === "move"
      ? "Ask the user to confirm this exact preview, acknowledge that Google and Sticky remain separate, and explicitly approve deleting the Google originals."
      : "Ask the user to confirm this exact preview and acknowledge that Google and Sticky remain separate.",
    separationNotice: "This is a one-time transfer. It does not enable syncing, importing, or mirroring between Google and Sticky.",
  };
}

async function deleteInBatches(
  current: ActorContext,
  taskListId: string,
  tasks: Array<GoogleTask & { id: string }>,
  dependencies: GoogleTaskTransferDependencies,
) {
  const failures: Array<{ taskId: string; title: string; error: string }> = [];
  for (let offset = 0; offset < tasks.length; offset += 8) {
    const batch = tasks.slice(offset, offset + 8);
    const settled = await Promise.allSettled(batch.map((task) => dependencies.deleteGoogleTask(current, taskListId, task.id)));
    settled.forEach((outcome, index) => {
      if (outcome.status === "rejected") {
        const task = batch[index];
        failures.push({ taskId: task.id, title: task.title, error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason) });
      }
    });
  }
  return failures;
}

export async function executeGoogleTaskTransfer(
  current: ActorContext,
  input: {
    googleTaskListId: string;
    stickyListId: string;
    mode: GoogleTaskTransferMode;
    includeCompleted: boolean;
    includeHidden: boolean;
    expectedTaskCount: number;
    sourceFingerprint: string;
    acknowledgedSeparateSystems: true;
    confirmedAfterPreview: true;
    confirmedDeleteGoogleOriginals?: true;
    confirmationPhrase: string;
  },
  dependencies: GoogleTaskTransferDependencies = defaultDependencies,
) {
  const [googleLists, target, rawTasks] = await Promise.all([
    dependencies.listGoogleTaskLists(current),
    dependencies.getStickyList(current, input.stickyListId),
    dependencies.listGoogleTasks(current, {
      taskListId: input.googleTaskListId,
      includeCompleted: input.includeCompleted,
      includeHidden: input.includeHidden,
    }),
  ]);
  const source = resolveGoogleList(googleLists, input.googleTaskListId);
  const tasks = requiredGoogleTasks(rawTasks);
  const currentFingerprint = googleTaskTransferFingerprint(tasks);
  if (tasks.length !== input.expectedTaskCount || currentFingerprint !== input.sourceFingerprint) {
    throw new StickyDomainError("conflict", "The Google list changed after the preview. Run the preview again before transferring anything.", 409, {
      previewTaskCount: input.expectedTaskCount,
      currentTaskCount: tasks.length,
    });
  }
  const expectedPhrase = confirmationPhrase(input.mode, tasks.length);
  if (input.confirmationPhrase !== expectedPhrase) {
    throw new StickyDomainError("validation_error", "The transfer confirmation does not match the preview. Nothing was copied.", 422, { expectedPhrase });
  }
  if (input.mode === "move" && input.confirmedDeleteGoogleOriginals !== true) {
    throw new StickyDomainError("validation_error", "Moving tasks requires explicit approval to delete the Google originals after Sticky verifies the copies.", 422);
  }

  const transferId = crypto.randomUUID();
  const imported = await dependencies.importTasks(current, {
    sourceListId: source.id,
    targetListId: target.id,
    transferId,
    mode: input.mode,
    tasks: importPayload(tasks),
  });
  const linkedTasks = await dependencies.listImportedTasks(current, source.id, target.id);
  const linkedGoogleIds = new Set(linkedTasks.map((task) => String(task.sync_metadata?.google_task_id ?? "")).filter(Boolean));
  const missingCopies = tasks.filter((task) => !linkedGoogleIds.has(task.id));
  if (missingCopies.length) {
    throw new StickyDomainError("internal_error", "Sticky stopped before deleting anything because it could not verify every copied task.", 500, {
      verifiedCount: tasks.length - missingCopies.length,
      missingGoogleTaskIds: missingCopies.map((task) => task.id),
    });
  }

  const baseResult = {
    transferId,
    mode: input.mode,
    source: { system: "google_tasks" as const, listId: source.id, listName: source.title },
    destination: { system: "sticky" as const, listId: target.id, listName: target.name },
    requestedCount: tasks.length,
    createdCount: imported.createdCount,
    alreadyCopiedCount: tasks.length - imported.createdCount,
    verifiedStickyCount: tasks.length,
    separationNotice: "Google and Sticky remain separate. No sync or mirroring was enabled.",
  };
  if (input.mode === "copy") {
    return { ...baseResult, status: "completed" as const, deletedGoogleCount: 0, deletionFailures: [] };
  }

  // Delete children before parents so Google cannot make a successful child deletion look like a failure.
  const deletionOrder = [...tasks.filter((task) => task.parentId), ...tasks.filter((task) => !task.parentId)];
  const deletionFailures = await deleteInBatches(current, source.id, deletionOrder, dependencies);
  const remaining = requiredGoogleTasks(await dependencies.listGoogleTasks(current, {
    taskListId: source.id,
    includeCompleted: input.includeCompleted,
    includeHidden: input.includeHidden,
  }));
  const originalIds = new Set(tasks.map((task) => task.id));
  const remainingOriginals = remaining.filter((task) => originalIds.has(task.id));
  const failedById = new Map(deletionFailures.map((failure) => [failure.taskId, failure]));
  for (const task of remainingOriginals) {
    if (!failedById.has(task.id)) failedById.set(task.id, { taskId: task.id, title: task.title, error: "Google still returned this task after deletion." });
  }
  const verifiedFailures = [...failedById.values()];
  return {
    ...baseResult,
    status: verifiedFailures.length ? "partial" as const : "completed" as const,
    deletedGoogleCount: tasks.length - remainingOriginals.length,
    deletionFailures: verifiedFailures,
  };
}
