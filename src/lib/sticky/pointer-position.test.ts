import { expect, it } from "vitest";
import { pointerPercent } from "./pointer-position";

it("keeps a pointer aligned in scaled and offset surfaces", () => {
  expect(pointerPercent(600, 0, 1200)).toBe("50%");
  expect(pointerPercent(262, 100, 324)).toBe("50%");
  expect(pointerPercent(586, 100, 648)).toBe("75%");
});

it("handles empty surfaces without invalid CSS", () => {
  expect(pointerPercent(10, 0, 0)).toBe("50%");
});
