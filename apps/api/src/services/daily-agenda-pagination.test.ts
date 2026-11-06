import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getRuntime } from "../runtime";
import { loadDailyAgendaItems } from "./daily-agenda";

vi.mock("../runtime", () => ({ getRuntime: vi.fn() }));
afterEach(() => vi.clearAllMocks());

function cappedDatabase(failLaterPage = false) {
  const rows: Record<string, Record<string, unknown>[]> = {
    lists: [1, 2, 3].map((n) => ({ id: `list-${n}`, name: `List ${n}`, user_id: "owner", sort_order: n, archived_at: null })),
    tasks: [1, 2, 3].map((n) => ({ id: `task-${n}`, list_id: `list-${n}`, user_id: "owner", title: `Task ${n}`, due_date: "2026-11-06", due_time: null, is_completed: false, sort_order: n })),
    subtasks: [1, 2, 3].map((n) => ({ id: `child-${n}`, task_id: `task-${n}`, user_id: "owner", title: `Child ${n}`, due_date: "2026-11-06", is_completed: false, sort_order: n })),
  };
  // Exercise actual Supabase query serialization; only the HTTP transport is fake.
  return createClient("http://localhost:54321", "test-key", {
    db: { schema: "sticky" },
    global: { fetch: async (input) => {
      const url = new URL(String(input));
      const table = url.pathname.split("/").at(-1)!;
      expect(url.searchParams.get("user_id")).toBe("eq.owner");
      expect(url.searchParams.get(table === "lists" ? "archived_at" : "is_completed"))
        .toBe(table === "lists" ? "is.null" : "eq.false");
      expect(url.searchParams.get("order")).toBe(table === "lists" ? "sort_order.asc,id.asc" : "id.asc");
      expect(Number(url.searchParams.get("limit"))).toBeLessThanOrEqual(500);
      const from = Number(url.searchParams.get("offset") ?? 0);
      if (failLaterPage && table === "tasks" && from > 0) {
        return Response.json({ message: "Later agenda page unavailable", code: "XX000" }, { status: 500 });
      }
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 2), 2);
      return Response.json(rows[table].slice(from, from + limit));
    } },
  });
}

describe("daily agenda capped database reads", () => {
  it("includes due tasks and subtasks beyond the server row cap, including their lists", async () => {
    vi.mocked(getRuntime).mockReturnValue({ db: cappedDatabase() } as never);
    const items = await loadDailyAgendaItems("owner", "2026-11-06");
    expect(items.dueTasks.map((task) => task.id)).toEqual(["task-1", "task-2", "task-3"]);
    expect(items.dueSubtasks.map((task) => task.id)).toEqual(["child-1", "child-2", "child-3"]);
    expect(items.dueTasks[2].listName).toBe("List 3");
  });

  it("rejects a failed later page instead of sending an incomplete agenda", async () => {
    vi.mocked(getRuntime).mockReturnValue({ db: cappedDatabase(true) } as never);
    await expect(loadDailyAgendaItems("owner", "2026-11-06")).rejects.toMatchObject({ message: "Later agenda page unavailable" });
  });
});
