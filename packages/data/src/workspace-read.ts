import type { StickySupabaseClient } from "./client";
import type { DataRow } from "./mappers";
import { readAllPages } from "./pagination";

export type WorkspaceRecords = {
  lists: DataRow[]; tasks: DataRow[]; subtasks: DataRow[]; recurrenceRules: DataRow[];
  preferences: DataRow | null; userState: DataRow | null;
  history: { completedCounts: Record<string, number>; loadedCounts: Record<string, number>; loadedListIds: string[] };
};

export async function readWorkspaceRecords(db: StickySupabaseClient, userId: string, completedListIds: string[] = []): Promise<WorkspaceRecords> {
  const [listResult, preferencesResult, stateResult, activeResult] = await Promise.all([
    readAllPages<DataRow>((from, to) => db.from("lists").select("*").eq("user_id", userId).order("sort_order").order("id").range(from, to)),
    db.from("user_preferences").select("*").eq("user_id", userId).maybeSingle(),
    db.from("user_state").select("selected_list_id,search_query").eq("user_id", userId).maybeSingle(),
    readAllPages<DataRow>((from, to) => db.from("tasks").select("*").eq("user_id", userId).eq("is_completed", false).order("id").range(from, to)),
  ]);
  for (const result of [listResult, preferencesResult, stateResult, activeResult]) {
    if (result.error) throw new Error(result.error.message);
  }
  const lists = listResult.data ?? [];
  const preferences = preferencesResult.data as DataRow | null;
  const userState = stateResult.data as DataRow | null;
  const openPiles = (preferences?.completed_open_by_list ?? {}) as Record<string, boolean>;
  const requested = new Set(completedListIds);
  const searchActive = Boolean(String(userState?.search_query ?? "").trim());
  const loadedListIds = lists.map((list) => String(list.id)).filter((id) => requested.has(id) || openPiles[id] || searchActive);
  const [counts, completed] = await Promise.all([
    Promise.all(lists.map(async (list) => {
      const { count, error } = await db.from("tasks").select("id", { count: "exact", head: true })
        .eq("user_id", userId).eq("list_id", String(list.id)).eq("is_completed", true);
      if (error) throw new Error(error.message);
      return [String(list.id), count ?? 0] as const;
    })),
    Promise.all(loadedListIds.map(async (id) => {
      const { data, error } = await readAllPages<DataRow>((from, to) => db.from("tasks").select("*")
        .eq("user_id", userId).eq("list_id", id).eq("is_completed", true).order("id").range(from, to));
      if (error) throw new Error(error.message);
      return data ?? [];
    })),
  ]);
  // A completion can commit between these reads. Keep the later row once.
  const tasks = [...new Map([...(activeResult.data ?? []), ...completed.flat()].map((task) => [String(task.id), task])).values()];
  const subtasks: DataRow[] = [];
  const recurrenceRules: DataRow[] = [];
  // Bound IN filters as well as result pages; a large workspace must not exceed
  // URL limits when loading the children of its active tasks.
  for (let offset = 0; offset < tasks.length; offset += 100) {
    const ids = tasks.slice(offset, offset + 100).map((task) => String(task.id));
    const results = await Promise.all(["subtasks", "task_recurrence_rules"].map((table) =>
      readAllPages<DataRow>((from, to) => db.from(table).select("*").eq("user_id", userId).in("task_id", ids).order("id").range(from, to)),
    ));
    for (const result of results) if (result.error) throw new Error(result.error.message);
    subtasks.push(...(results[0].data ?? []));
    recurrenceRules.push(...(results[1].data ?? []));
  }
  return {
    lists, tasks, subtasks, recurrenceRules, preferences, userState,
    history: {
      completedCounts: Object.fromEntries(counts),
      loadedCounts: Object.fromEntries(loadedListIds.map((id, index) => [id, completed[index].length])),
      loadedListIds,
    },
  };
}
