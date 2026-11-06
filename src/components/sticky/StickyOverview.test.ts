import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { StickyOverview } from "./StickyOverview";

afterEach(() => vi.useRealTimers());

function renderOverview() {
  return renderToStaticMarkup(createElement(StickyOverview, {
    lists: [], tasks: [], subtasks: [], recurrenceByTask: new Map(), instant: true,
    onClose() {}, onOpenTask() {}, onSelectList() {}, onShowFilter() {}, onOpenCalendar() {},
  }));
}

it("renders the same initial clock across a server/client minute boundary", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-06T12:06:59Z"));
  const before = renderOverview().match(/<div class="deck-clock"[\s\S]*?<\/div>/)?.[0];
  vi.setSystemTime(new Date("2026-11-06T12:07:00Z"));
  const after = renderOverview().match(/<div class="deck-clock"[\s\S]*?<\/div>/)?.[0];
  expect(before).toBeDefined();
  expect(after).toBe(before);
});

it("renders a remembered overview header visibly before hydration", () => {
  const header = renderOverview().match(/<header class="deck-topbar"[^>]*>/)?.[0];
  expect(header).toBeDefined();
  expect(header).toContain("opacity:1");
  expect(header).not.toContain("translateX(-14px)");
});
