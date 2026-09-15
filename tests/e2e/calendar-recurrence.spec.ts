import { expect, test } from "@playwright/test";

test.use({ timezoneId: "UTC" });
test("counts each class meeting and edits the original series without moving its start", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("sticky.demo.calendar-events.v1", JSON.stringify([14, 16].map((day) => ({
      id: "class", occurrenceId: `class:2026-09-${day}`, calendarId: "calendar", taskId: null,
      title: "CS 4390", details: "", location: "", allDay: false,
      startAt: `2026-09-${day}T13:30:00.000Z`, endAt: `2026-09-${day}T14:45:00.000Z`,
      startDate: null, endDate: null, timezone: "America/Chicago", version: 2,
      recurrence: ["FREQ=WEEKLY", "BYDAY=MO,WE", "UNTIL=20261209"],
      series: { startAt: "2026-08-24T13:30:00.000Z", endAt: "2026-08-24T14:45:00.000Z", startDate: null, endDate: null },
      status: "confirmed", transparency: "opaque", color: null,
    }))));
  });
  await page.goto("/");
  await expect(page.locator(".save-status")).toContainText("Local demo saved");
  // Keep SSR and hydration on the same clock; fix the calendar date only after loading.
  await page.clock.setFixedTime(new Date("2026-09-14T12:00:00Z"));
  await page.getByRole("button", { name: "Show calendar view" }).click();
  await expect(page.locator(".calendar-summary")).toContainText("2 events this month");
  await page.locator(".calendar-agenda .cal-event").filter({ hasText: "CS 4390" }).first().click();
  const editor = page.getByRole("dialog", { name: "Edit calendar event" });
  await expect(editor.locator('input[type="date"]').first()).toHaveValue("2026-08-24");
  await expect(editor.locator('input[type="time"]').first()).toHaveValue("08:30");
  await expect(editor).toContainText("Changes apply to every occurrence");
  await page.getByRole("button", { name: "Close event editor" }).click();
  for (const name of ["Week", "Day", "Month"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.locator(".cal-event:visible").filter({ hasText: "CS 4390" }).first()).toBeVisible();
  }
  expect(errors).toEqual([]);
  await page.screenshot({ path: `test-results/calendar-recurrence-${test.info().project.name}.png` });
});
