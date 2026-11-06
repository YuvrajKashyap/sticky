import type { ActorContext, ListDto } from "@sticky/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  executeGoogleTaskTransfer,
  googleTaskTransferFingerprint,
  previewGoogleTaskTransfer,
  type GoogleTaskTransferDependencies,
} from "./google-task-transfer";

const actor: ActorContext = {
  userId: "d55e5980-ceb7-4bdf-ac92-1a9a873875a7",
  actorType: "agent",
  actorId: "poke:poke-user",
  credentialId: "4d1cc3fa-546d-4618-8c6f-2191f29e0fc9",
  scopes: new Set(["tasks:read", "tasks:write", "tasks:destructive"]),
  requestId: "request-1",
  idempotencyKey: "transfer-test-1",
  providerUserId: "poke-user",
  accessToken: null,
};

const stickyList: ListDto = {
  id: "04e7cd4d-f3d2-4c89-a0ce-06e153089e1d",
  userId: actor.userId,
  name: "Software",
  color: "sun",
  sortOrder: 1000,
  isVisibleOnBoard: true,
  archivedAt: null,
  version: 1,
  createdAt: "2026-07-18T12:00:00.000Z",
  updatedAt: "2026-07-18T12:00:00.000Z",
};

const sourceList = { id: "google-software", title: "Software", updatedAt: "2026-07-18T12:00:00.000Z" };
const sourceTasks = [
  {
    id: "google-parent",
    taskListId: sourceList.id,
    title: "Ship the build",
    notes: "Run production smoke tests",
    status: "needsAction",
    completed: false,
    dueDate: "2026-07-20",
    completedAt: null,
    updatedAt: "2026-07-18T12:00:00.000Z",
    parentId: null,
    position: "0001",
    webViewLink: null,
  },
  {
    id: "google-child",
    taskListId: sourceList.id,
    title: "Check Poke",
    notes: "",
    status: "needsAction",
    completed: false,
    dueDate: null,
    completedAt: null,
    updatedAt: "2026-07-18T12:01:00.000Z",
    parentId: "google-parent",
    position: "0002",
    webViewLink: null,
  },
];

function importedTasks() {
  return sourceTasks.map((task, index) => ({
    id: `sticky-${index}`,
    title: task.title,
    details: [task.notes, task.parentId ? "Originally a Google subtask of “Ship the build”." : ""].filter(Boolean).join("\n\n"),
    due_date: task.dueDate,
    is_completed: task.completed,
    completed_at: task.completedAt,
    sync_metadata: { source: "google_tasks", google_task_list_id: sourceList.id, google_task_id: task.id },
  }));
}

function dependencies(overrides: Partial<GoogleTaskTransferDependencies> = {}): GoogleTaskTransferDependencies {
  return {
    listGoogleTaskLists: async () => [sourceList],
    listGoogleTasks: async () => sourceTasks,
    listStickyLists: async () => [stickyList],
    getStickyList: async () => stickyList,
    importTasks: async () => ({ createdCount: sourceTasks.length }),
    listImportedTasks: async () => importedTasks(),
    deleteGoogleTask: async () => ({ deleted: true }),
    ...overrides,
  };
}

describe("guarded Google Tasks to Sticky transfers", () => {
  it("previews the exact source and destination without copying anything", async () => {
    const importTasks = vi.fn(async () => ({ createdCount: 0 }));
    const deleteTask = vi.fn(async () => ({ deleted: true }));

    const preview = await previewGoogleTaskTransfer(actor, {
      googleTaskList: "Software",
      stickyList: "Software",
      mode: "copy",
      includeCompleted: false,
      includeHidden: false,
    }, dependencies({ importTasks, deleteGoogleTask: deleteTask }));

    expect(preview).toMatchObject({
      mode: "copy",
      source: { listId: sourceList.id, listName: "Software" },
      destination: { listId: stickyList.id, listName: "Software" },
      taskCount: 2,
      confirmationPhrase: "COPY 2 GOOGLE TASKS TO STICKY",
    });
    expect(preview.separationNotice).toContain("does not enable syncing");
    expect(importTasks).not.toHaveBeenCalled();
    expect(deleteTask).not.toHaveBeenCalled();
  });

  it("rejects a changed Google list before copying or deleting anything", async () => {
    const importTasks = vi.fn(async () => ({ createdCount: 0 }));
    const deleteTask = vi.fn(async () => ({ deleted: true }));

    await expect(executeGoogleTaskTransfer(actor, {
      googleTaskListId: sourceList.id,
      stickyListId: stickyList.id,
      mode: "move",
      includeCompleted: false,
      includeHidden: false,
      expectedTaskCount: sourceTasks.length,
      sourceFingerprint: "0".repeat(64),
      acknowledgedSeparateSystems: true,
      confirmedAfterPreview: true,
      confirmedDeleteGoogleOriginals: true,
      confirmationPhrase: "MOVE 2 GOOGLE TASKS TO STICKY AND DELETE GOOGLE ORIGINALS",
    }, dependencies({ importTasks, deleteGoogleTask: deleteTask }))).rejects.toMatchObject({ code: "conflict" });

    expect(importTasks).not.toHaveBeenCalled();
    expect(deleteTask).not.toHaveBeenCalled();
  });

  it("never deletes Google originals when one Sticky copy cannot be verified", async () => {
    const deleteTask = vi.fn(async () => ({ deleted: true }));

    await expect(executeGoogleTaskTransfer(actor, {
      googleTaskListId: sourceList.id,
      stickyListId: stickyList.id,
      mode: "move",
      includeCompleted: false,
      includeHidden: false,
      expectedTaskCount: sourceTasks.length,
      sourceFingerprint: googleTaskTransferFingerprint(sourceTasks),
      acknowledgedSeparateSystems: true,
      confirmedAfterPreview: true,
      confirmedDeleteGoogleOriginals: true,
      confirmationPhrase: "MOVE 2 GOOGLE TASKS TO STICKY AND DELETE GOOGLE ORIGINALS",
    }, dependencies({
      listImportedTasks: async () => importedTasks().slice(0, 1),
      deleteGoogleTask: deleteTask,
    }))).rejects.toMatchObject({ code: "internal_error" });

    expect(deleteTask).not.toHaveBeenCalled();
  });

  it("copies, verifies, then deletes children before parents for a confirmed move", async () => {
    const events: string[] = [];
    let remaining = [...sourceTasks];
    const transferDependencies = dependencies({
      listGoogleTasks: async () => remaining,
      importTasks: async () => { events.push("copy"); return { createdCount: sourceTasks.length }; },
      listImportedTasks: async () => { events.push("verify"); return importedTasks(); },
      deleteGoogleTask: async (_current, _listId, taskId) => {
        events.push(`delete:${taskId}`);
        remaining = remaining.filter((task) => task.id !== taskId);
        return { deleted: true };
      },
    });

    const moved = await executeGoogleTaskTransfer(actor, {
      googleTaskListId: sourceList.id,
      stickyListId: stickyList.id,
      mode: "move",
      includeCompleted: false,
      includeHidden: false,
      expectedTaskCount: sourceTasks.length,
      sourceFingerprint: googleTaskTransferFingerprint(sourceTasks),
      acknowledgedSeparateSystems: true,
      confirmedAfterPreview: true,
      confirmedDeleteGoogleOriginals: true,
      confirmationPhrase: "MOVE 2 GOOGLE TASKS TO STICKY AND DELETE GOOGLE ORIGINALS",
    }, transferDependencies);

    expect(moved).toMatchObject({ status: "completed", createdCount: 2, verifiedStickyCount: 2, deletedGoogleCount: 2 });
    expect(events.indexOf("verify")).toBeLessThan(events.indexOf("delete:google-child"));
    expect(events.indexOf("delete:google-child")).toBeLessThan(events.indexOf("delete:google-parent"));
  });

  it("reports a safe deduplicated retry instead of creating another copy", async () => {
    const copied = await executeGoogleTaskTransfer(actor, {
      googleTaskListId: sourceList.id,
      stickyListId: stickyList.id,
      mode: "copy",
      includeCompleted: false,
      includeHidden: false,
      expectedTaskCount: sourceTasks.length,
      sourceFingerprint: googleTaskTransferFingerprint(sourceTasks),
      acknowledgedSeparateSystems: true,
      confirmedAfterPreview: true,
      confirmationPhrase: "COPY 2 GOOGLE TASKS TO STICKY",
    }, dependencies({ importTasks: async () => ({ createdCount: 0 }) }));

    expect(copied).toMatchObject({ status: "completed", createdCount: 0, alreadyCopiedCount: 2, deletedGoogleCount: 0 });
  });

  it("waits for child deletion to finish before starting parent deletion", async () => {
    let remaining = [...sourceTasks];
    let childFinished = false;
    let parentStartedBeforeChildFinished = false;
    await executeGoogleTaskTransfer(actor, {
      googleTaskListId: sourceList.id,
      stickyListId: stickyList.id,
      mode: "move",
      includeCompleted: false,
      includeHidden: false,
      expectedTaskCount: sourceTasks.length,
      sourceFingerprint: googleTaskTransferFingerprint(sourceTasks),
      acknowledgedSeparateSystems: true,
      confirmedAfterPreview: true,
      confirmedDeleteGoogleOriginals: true,
      confirmationPhrase: "MOVE 2 GOOGLE TASKS TO STICKY AND DELETE GOOGLE ORIGINALS",
    }, dependencies({
      listGoogleTasks: async () => remaining,
      deleteGoogleTask: async (_actor, _list, id) => {
        if (id === "google-child") {
          await Promise.resolve();
          childFinished = true;
        } else {
          parentStartedBeforeChildFinished = !childFinished;
        }
        remaining = remaining.filter((task) => task.id !== id);
        return { deleted: true };
      },
    }));
    expect(parentStartedBeforeChildFinished).toBe(false);
  });

  it("does not delete changed Google originals when deduplication retains an older Sticky copy", async () => {
    const changedTasks = sourceTasks.map((task) => ({ ...task, notes: "New notes that must survive the move" }));
    const deleted: string[] = [];
    await expect(executeGoogleTaskTransfer(actor, {
      googleTaskListId: sourceList.id,
      stickyListId: stickyList.id,
      mode: "move",
      includeCompleted: false,
      includeHidden: false,
      expectedTaskCount: changedTasks.length,
      sourceFingerprint: googleTaskTransferFingerprint(changedTasks),
      acknowledgedSeparateSystems: true,
      confirmedAfterPreview: true,
      confirmedDeleteGoogleOriginals: true,
      confirmationPhrase: "MOVE 2 GOOGLE TASKS TO STICKY AND DELETE GOOGLE ORIGINALS",
    }, dependencies({
      listGoogleTasks: async () => changedTasks,
      importTasks: async () => ({ createdCount: 0 }),
      listImportedTasks: async () => importedTasks(),
      deleteGoogleTask: async (_actor, _list, id) => { deleted.push(id); return { deleted: true }; },
    }))).rejects.toMatchObject({ code: "conflict" });
    expect(deleted).toEqual([]);
  });

  it.each([
    { title: "Edited in Sticky" },
    { details: "Edited notes in Sticky" },
    { due_date: "2026-12-31" },
    { is_completed: true },
  ])("blocks deletion when the current Sticky copy was edited: %j", async (patch) => {
    const deleted: string[] = [];
    await expect(executeGoogleTaskTransfer(actor, {
      googleTaskListId: sourceList.id,
      stickyListId: stickyList.id,
      mode: "move",
      includeCompleted: false,
      includeHidden: false,
      expectedTaskCount: sourceTasks.length,
      sourceFingerprint: googleTaskTransferFingerprint(sourceTasks),
      acknowledgedSeparateSystems: true,
      confirmedAfterPreview: true,
      confirmedDeleteGoogleOriginals: true,
      confirmationPhrase: "MOVE 2 GOOGLE TASKS TO STICKY AND DELETE GOOGLE ORIGINALS",
    }, dependencies({
      importTasks: async () => ({ createdCount: 0 }),
      listImportedTasks: async () => importedTasks().map((copy, index) => index === 0 ? { ...copy, ...patch } : copy),
      deleteGoogleTask: async (_actor, _list, id) => { deleted.push(id); return { deleted: true }; },
    }))).rejects.toMatchObject({ code: "conflict" });
    expect(deleted).toEqual([]);
  });
});
