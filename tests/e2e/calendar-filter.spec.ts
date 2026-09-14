import { expect, test } from "@playwright/test";

test("calendar content filter follows every view and survives reload", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".save-status")).toContainText("Local demo saved");
  await page.getByRole("button", { name: "Show calendar view" }).click();
  const filter = page.getByRole("group", { name: "Calendar content" });
  await expect(filter.getByRole("button", { name: "Both", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".calendar-agenda-task").first()).toBeVisible();
  await filter.getByRole("button", { name: "Events", exact: true }).click();
  await expect(page.locator(".calendar-task, .calendar-agenda-task")).toHaveCount(0);
  for (const view of ["Week", "Day", "Month"]) {
    await page.getByRole("button", { name: view, exact: true }).click();
    await expect(page.locator(".calendar-task, .calendar-agenda-task, .calendar-week-task, .calendar-day-task")).toHaveCount(0);
  }
  await page.reload();
  await expect(page.locator(".save-status")).toContainText("Local demo saved");
  if (!await filter.isVisible()) await page.getByRole("button", { name: "Show calendar view" }).click();
  await expect(filter.getByRole("button", { name: "Events", exact: true })).toHaveAttribute("aria-pressed", "true");
  await filter.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(page.locator(".calendar-agenda-task").first()).toBeVisible();
  await expect(page.locator(".calendar-summary")).not.toContainText("events");
  await filter.getByRole("button", { name: "Both", exact: true }).click();
  await expect(page.locator(".calendar-summary")).toContainText("events");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/calendar-filter-${test.info().project.name}.png` });
});
