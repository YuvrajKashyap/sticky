import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { readWorkspaceRecords } from "./workspace-read";

const userId = "owner";
const lists = [{ id: "one", user_id: userId }, { id: "two", user_id: userId }];
const tasks = [
  { id: "active", list_id: "one", user_id: userId, is_completed: false },
  { id: "done", list_id: "one", user_id: userId, is_completed: true },
  { id: "other-done", list_id: "two", user_id: userId, is_completed: true },
];

function database(completeDuringRead = false) {
  const taskRows = tasks.map((task) => ({ ...task }));
  return createClient("http://localhost:54321", "test-key", {
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      const table = url.pathname.split("/").at(-1);
      expect(url.searchParams.get("user_id")).toBe("eq.owner");
      let rows: object[] = [];
      if (table === "lists") rows = lists;
      if (table === "tasks") {
        if (completeDuringRead && url.searchParams.get("is_completed") === "eq.true") taskRows[0].is_completed = true;
        rows = taskRows.filter((task) => {
          const completed = url.searchParams.get("is_completed");
          const list = url.searchParams.get("list_id");
          return (!completed || task.is_completed === (completed === "eq.true")) && (!list || list === `eq.${task.list_id}`);
        });
      }
      if (table === "user_preferences") return Response.json({ completed_open_by_list: {} });
      if (table === "user_state") return Response.json({ selected_list_id: "one", search_query: "" });
      if (init?.method === "HEAD") return new Response(null, { headers: { "content-range": `0-0/${rows.length}` } });
      const from = Number(url.searchParams.get("offset") ?? 0);
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 2), 2);
      return Response.json(rows.slice(from, from + limit));
    } },
    db: { schema: "sticky" },
  });
}

describe("workspace loading", () => {
  it("does not duplicate a task completed between the active and history reads", async () => {
    const records = await readWorkspaceRecords(database(true), userId, ["one"]);
    expect(records.tasks.map((task) => task.id)).toEqual(["active", "done"]);
    expect(records.tasks.find((task) => task.id === "active")?.is_completed).toBe(true);
  });
  it("initially returns active tasks plus exact completed counts without loading closed piles", async () => {
    const records = await readWorkspaceRecords(database(), userId);
    expect(records.tasks.map((task) => task.id)).toEqual(["active"]);
    expect(records.history.completedCounts).toEqual({ one: 1, two: 1 });
    expect(records.history.loadedListIds).toEqual([]);
  });

  it("loads only the requested completed pile and includes state needed after reconnect", async () => {
    const records = await readWorkspaceRecords(database(), userId, ["one"]);
    expect(records.tasks.map((task) => task.id)).toEqual(["active", "done"]);
    expect(records.history.loadedListIds).toEqual(["one"]);
    expect(records.userState).toMatchObject({ selected_list_id: "one" });
    expect(records.preferences).toMatchObject({ completed_open_by_list: {} });
    expect(records.subtasks).toEqual([]);
    expect(records.recurrenceRules).toEqual([]);
  });
});
