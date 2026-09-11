import { describe, expect, it, vi } from "vitest";
import { createPointerFrame, setPointerPercentage } from "./pointer-geometry";

describe("login pointer geometry", () => {
  it("consumes the latest input in the next scheduled frame, without an extra frame", () => {
    const pending = new Set<() => void>();
    const consume = vi.fn();
    const pointer = createPointerFrame<number>(consume, callback => { pending.add(callback); }, callback => { pending.delete(callback); });
    pointer.push(1);
    pointer.push(2);
    pointer.push(3);
    expect(pending.size).toBe(1);
    for (const callback of pending) callback();
    pending.clear();
    expect(consume.mock.calls).toEqual([[3]]);
    pointer.push(4);
    pointer.cancel();
    expect(pending.size).toBe(0);
    expect(consume.mock.calls).toEqual([[3]]);
    pointer.push(5);
    for (const callback of pending) callback();
    expect(consume.mock.calls).toEqual([[3], [5]]);
  });

  it("preserves rounding and only writes a percentage when it changes", () => {
    const values = new Map<string, string>();
    const style = {
      getPropertyValue: (name: string) => values.get(name) ?? "",
      setProperty: vi.fn((name: string, value: string) => values.set(name, value)),
    } as unknown as CSSStyleDeclaration;
    setPointerPercentage(style, "--mx", 0.1234);
    setPointerPercentage(style, "--mx", 0.12341);
    expect(values.get("--mx")).toBe("12.3%");
    expect(style.setProperty).toHaveBeenCalledTimes(1);
    setPointerPercentage(style, "--mx", 0.125);
    expect(values.get("--mx")).toBe("12.5%");
  });
});
