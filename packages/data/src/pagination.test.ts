import { describe, expect, it } from "vitest";
import { readAllPages } from "./pagination";

describe("complete paginated reads", () => {
  it("reads past a server cap smaller than the requested page size", async () => {
    const rows = Array.from({ length: 1205 }, (_, id) => ({ id: String(id) }));
    const result = await readAllPages(async (from, to) => ({ data: rows.slice(from, Math.min(to + 1, from + 100)), error: null }));
    expect(result.data).toHaveLength(1205);
    expect(result.data?.at(-1)).toEqual({ id: "1204" });
  });

  it("never returns a partial workspace as success after a later page fails", async () => {
    const result = await readAllPages(async (from) => from === 0
      ? { data: [{ id: "first" }], error: null }
      : { data: null, error: { message: "connection lost" } });
    expect(result).toEqual({ data: null, error: { message: "connection lost" } });
  });
});
