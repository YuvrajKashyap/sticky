import { describe, expect, it, vi } from "vitest";
import { capturePointerGeometry, pointerBounds, setPointerPercentage } from "./pointer-geometry";

describe("login pointer geometry", () => {
  it("uses one pre-write snapshot, then refreshes for the next event", () => {
    let left = 10;
    const element = { getBoundingClientRect: vi.fn(() => ({ left, width: 100 })) } as unknown as HTMLElement;
    const first = new Event("pointermove");
    capturePointerGeometry(first, [element, element]);
    left = 30;
    expect(pointerBounds(first, element).left).toBe(10);
    expect(element.getBoundingClientRect).toHaveBeenCalledTimes(1);
    const next = new Event("pointermove");
    capturePointerGeometry(next, [element]);
    expect(pointerBounds(next, element).left).toBe(30);
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
