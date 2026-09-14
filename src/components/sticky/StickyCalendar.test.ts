import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { addDays, format, startOfMonth, startOfWeek } from "date-fns";
import { expect, it, vi } from "vitest";
import type { StickyTask } from "../../types/sticky";
import { StickyCalendar } from "./StickyCalendar";

vi.mock("@/lib/sticky/api-client", () => ({ createStickyPlatformClient: vi.fn() }));

it("prioritizes events in crowded dates while retaining tasks in the agenda", () => {
  const today = new Date();
  const date = format(today, "yyyy-MM-dd");
  const start = startOfWeek(startOfMonth(today));
  const client = new QueryClient();
  client.setQueryData(["sticky-calendar-events", start.toISOString(), addDays(start, 42).toISOString()], {
    events: ["Meeting", "Appointment", "Workshop"].map((title, index) => ({
      id: String(index), title, allDay: true, startDate: index === 0 ? format(addDays(startOfMonth(today), -1), "yyyy-MM-dd") : date,
      endDate: format(addDays(today, 1), "yyyy-MM-dd"), startAt: null,
    })),
  });
  const task = { id: "task", title: "Prepare notes", dueDate: date, dueTime: null, listId: "list", color: "sky", isCompleted: false } as StickyTask;
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(StickyCalendar, {
    tasks: [task], lists: [], recurringTaskIds: new Set<string>(), onTaskSelect: () => {}, mode: "demo",
  }))).replace(/<!--.*?-->/g, "");
  const cell = html.split('class="calendar-cell today selected"')[1].split("</article>")[0];
  expect(cell).toContain("Workshop");
  expect(cell).not.toContain("Prepare notes");
  expect(cell).toContain("+1 more");
  expect(html).toContain("<strong>3</strong> events this month");
  expect(html.split('class="calendar-agenda-list"')[1]).toContain("Prepare notes");
  client.clear();
});
