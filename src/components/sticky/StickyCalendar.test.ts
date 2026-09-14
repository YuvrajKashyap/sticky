import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { addDays, format, startOfMonth, startOfWeek } from "date-fns";
import { expect, it, vi } from "vitest";
import type { StickyTask } from "../../types/sticky";
import { StickyCalendar } from "./StickyCalendar";

vi.mock("@/lib/sticky/api-client", () => ({ createStickyPlatformClient: vi.fn(() => ({ request: vi.fn() })) }));

it("prioritizes events in crowded dates while retaining tasks in the agenda", () => {
  const today = new Date();
  const date = format(today, "yyyy-MM-dd");
  const start = startOfWeek(startOfMonth(today));
  const client = new QueryClient();
  client.setQueryData(["sticky-calendar-events", start.toISOString(), addDays(start, 42).toISOString()], {
    events: ["Meeting", "Appointment", "Workshop", "Review", "Overflow meeting"].map((title, index) => ({
      id: String(index), calendarId: "calendar", taskId: null, details: "", location: "", timezone: "UTC", status: "confirmed", transparency: "opaque", color: null, version: 1, title, allDay: true, startDate: index === 0 ? format(addDays(startOfMonth(today), -1), "yyyy-MM-dd") : date,
      endDate: format(addDays(today, 1), "yyyy-MM-dd"), startAt: null, endAt: null,
    })),
  });
  const task = { id: "task", title: "Prepare notes", dueDate: date, dueTime: null, listId: "list", color: "sky", isCompleted: false } as StickyTask;
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(StickyCalendar, {
    tasks: [task], lists: [], recurringTaskIds: new Set<string>(), onTaskSelect: () => {}, mode: "supabase",
  }))).replace(/<!--.*?-->/g, "");
  const cell = html.match(/<article[^>]*class="calendar-cell[^"]*today[^"]*selected[^"]*"[\s\S]*?<\/article>/)![0];
  expect(cell).toContain("Appointment");
  expect(cell.indexOf("Appointment")).toBeLessThan(cell.indexOf("Prepare notes"));
  expect(cell).not.toContain("Workshop");
  expect(cell).toContain("+1 more");
  expect(html).toContain("<strong>5</strong> events this month");
  expect(html.slice(html.indexOf('class="calendar-agenda"'))).toContain("Prepare notes");
  client.clear();
});
