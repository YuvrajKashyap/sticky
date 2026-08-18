import { describe, expect, it } from "vitest";
import { reconcileWorkspaceTasks } from "./workspace-sync";

describe("reconcileWorkspaceTasks", () => {
  it("keeps an optimistic completion when an older workspace snapshot arrives late", () => {
    const optimistic = [{ id: "task-1", version: 2, isCompleted: true }];
    const staleSnapshot = [{ id: "task-1", version: 1, isCompleted: false }];

    expect(reconcileWorkspaceTasks(optimistic, staleSnapshot)).toEqual(optimistic);
  });

  it("keeps an optimistic completion when a conflicting snapshot has the same version", () => {
    const optimistic = [{ id: "task-1", version: 2, isCompleted: true }];
    const conflictingSnapshot = [{ id: "task-1", version: 2, isCompleted: false }];

    expect(reconcileWorkspaceTasks(optimistic, conflictingSnapshot)).toEqual(optimistic);
  });

  it("accepts the server record once it is at least as new as the local record", () => {
    const optimistic = [{ id: "task-1", version: 2, isCompleted: true, completedAt: "local" }];
    const canonical = [{ id: "task-1", version: 2, isCompleted: true, completedAt: "server" }];

    expect(reconcileWorkspaceTasks(optimistic, canonical)).toEqual(canonical);
  });
});
