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

function dependencies(overrides: Partial<GoogleTaskTransferDependencies> = {}): GoogleTaskTransferDependencies {
  return {
    listGoogleTaskLists: async () => [sourceList],
    listGoogleTasks: async () => sourceTasks,
    listStickyLists: async () => [stickyList],
    getStickyList: async () => stickyList,
    importTasks: async () => ({ createdCount: sourceTasks.length }),
    listImportedTasks: async () => sourceTasks.map((task, index) => ({
      id: `sticky-${index}`,
      sync_metadata: { source: "google_tasks", google_task_list_id: sourceList.id, google_task_id: task.id },
    })),
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
      listImportedTasks: async () => [{
        id: "sticky-1",
        sync_metadata: { source: "google_tasks", google_task_list_id: sourceList.id, google_task_id: sourceTasks[0].id },
      }],
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
      listImportedTasks: async () => { events.push("verify"); return sourceTasks.map((task, index) => ({ id: `sticky-${index}`, sync_metadata: { google_task_id: task.id } })); },
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
});
