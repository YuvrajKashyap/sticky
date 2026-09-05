import { describe, expect, it } from "vitest";
import { WorkspacePersistence, settleWorkspaceOperations } from "./workspace-persistence";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const initial = () => ({ tasks: [{ id: "a", title: "original" }, { id: "b", title: "other" }], preferences: { density: "compact" } });

describe("workspace persistence", () => {
  it("does not render malformed records when a later edit depends on a failed creation", async () => {
    let state = initial();
    const queue = new WorkspacePersistence(() => state, (next) => { state = next; });
    const before = state;
    state = { ...state, tasks: [...state.tasks, { id: "new", title: "captured" }] };
    const create = queue.save(before, async () => { throw new Error("create failed"); });
    const beforeEdit = state;
    state = { ...state, tasks: state.tasks.map((task) => task.id === "new" ? { ...task, title: "edited" } : task) };
    const done = deferred<void>();
    const edit = queue.save(beforeEdit, async () => { await done.promise; throw new Error("edit failed"); });
    await expect(create).rejects.toThrow("create failed");
    expect(state.tasks.every((task) => typeof task.id === "string")).toBe(true);
    done.resolve();
    await expect(edit).rejects.toThrow("edit failed");
    expect(state).toEqual(initial());
  });
  it("waits for every write in a failed compound command before reconciling", async () => {
    const second = deferred<void>();
    let finished = false;
    const result = settleWorkspaceOperations([Promise.reject(new Error("first failed")), second.promise]);
    const observed = result.catch(() => { finished = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(finished).toBe(false);
    second.resolve();
    await observed;
    expect(finished).toBe(true);
  });
  it("rolls back a failed save without discarding a later edit to another task", async () => {
    let state = initial();
    const queue = new WorkspacePersistence(() => state, (next) => { state = next; });
    const first = deferred<void>();
    const before = state;
    state = { ...state, tasks: [{ id: "a", title: "failed" }, state.tasks[1]] };
    const a = queue.save(before, async () => { await first.promise; throw new Error("offline"); });
    const beforeB = state;
    state = { ...state, tasks: [state.tasks[0], { id: "b", title: "saved" }] };
    const b = queue.save(beforeB, async () => undefined);
    first.resolve();
    await expect(a).rejects.toThrow("offline");
    await b;
    expect(state.tasks).toEqual([{ id: "a", title: "original" }, { id: "b", title: "saved" }]);
  });

  it("rebases overlapping failed edits back to the last saved value", async () => {
    let state = initial();
    const queue = new WorkspacePersistence(() => state, (next) => { state = next; });
    const before = state;
    state = { ...state, tasks: [{ id: "a", title: "first" }, state.tasks[1]] };
    const a = queue.save(before, async () => { throw new Error("first failed"); });
    const secondBefore = state;
    state = { ...state, tasks: [{ id: "a", title: "second" }, state.tasks[1]] };
    const b = queue.save(secondBefore, async () => { throw new Error("second failed"); });
    await expect(a).rejects.toThrow("first failed");
    await expect(b).rejects.toThrow("second failed");
    expect(state).toEqual(initial());
  });

  it("discards a snapshot started before a new task was captured", async () => {
    let state = initial();
    const queue = new WorkspacePersistence(() => state, (next) => { state = next; });
    const snapshot = deferred<ReturnType<typeof initial>>();
    const refresh = queue.refresh(() => snapshot.promise);
    const before = state;
    state = { ...state, tasks: [...state.tasks, { id: "new", title: "captured" }] };
    await queue.save(before, async () => undefined);
    snapshot.resolve(initial());
    expect(await refresh).toBe(false);
    expect(state.tasks.at(-1)).toEqual({ id: "new", title: "captured" });
  });

  it("does not apply snapshots while a title edit is pending and accepts canonical state afterwards", async () => {
    let state = initial();
    const queue = new WorkspacePersistence(() => state, (next) => { state = next; });
    const done = deferred<void>();
    const before = state;
    state = { ...state, tasks: [{ id: "a", title: "new title" }, state.tasks[1]] };
    const save = queue.save(before, () => done.promise);
    expect(await queue.refresh(async () => initial())).toBe(false);
    expect(state.tasks[0].title).toBe("new title");
    done.resolve();
    await save;
    const canonical = { ...state, preferences: { density: "comfortable" } };
    expect(await queue.refresh(async () => canonical)).toBe(true);
    expect(state.preferences.density).toBe("comfortable");
  });

  it("sends completion and undo in order while keeping undo visible", async () => {
    let state = initial();
    const queue = new WorkspacePersistence(() => state, (next) => { state = next; });
    const done = deferred<void>();
    const sent: string[] = [];
    const before = state;
    state = { ...state, tasks: [] };
    const remove = queue.save(before, async () => { sent.push("delete"); await done.promise; });
    const afterDelete = state;
    state = before;
    const undo = queue.save(afterDelete, async () => { sent.push("undo"); });
    await Promise.resolve();
    expect(sent).toEqual(["delete"]);
    expect(state.tasks).toHaveLength(2);
    done.resolve();
    await Promise.all([remove, undo]);
    expect(sent).toEqual(["delete", "undo"]);
    expect(state).toEqual(initial());
  });
});
