import { expect, test } from "@playwright/test";

test("calendar period selection survives navigation and reload", async ({ page }) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: "Show calendar view" }).click();
  const views = page.getByRole("group", { name: "Calendar view", exact: true });
  for (const view of ["Week", "Day", "Month"]) {
    await views.getByRole("button", { name: view, exact: true }).click();
    await page.reload();
    await expect(page.locator(".save-status")).toContainText("Local demo saved");
    await page.getByRole("button", { name: /^Show all tasks,/ }).click();
    await page.getByRole("button", { name: "Show calendar view" }).click();
    await expect(views).toBeVisible();
    await expect(views.getByRole("button", { name: view, exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.goto("/archive");
    await page.goto("/");
    await expect(page.locator(".save-status")).toContainText("Local demo saved");
    await page.getByRole("button", { name: /^Show all tasks,/ }).click();
    await page.getByRole("button", { name: "Show calendar view" }).click();
    await expect(views).toBeVisible();
    await expect(views.getByRole("button", { name: view, exact: true })).toHaveAttribute("aria-pressed", "true");
  }
});

test("calendar content filter follows every view and survives reload", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".save-status")).toContainText("Local demo saved");
  await page.getByRole("button", { name: "Show calendar view" }).click();
  const filter = page.getByRole("group", { name: "Calendar content" });
  await expect(filter.getByRole("button", { name: /^All\b/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".calendar-agenda-task").first()).toBeVisible();
  await filter.getByRole("button", { name: /^Events\b/ }).click();
  await expect(page.locator(".calendar-task, .calendar-agenda-task")).toHaveCount(0);
  for (const view of ["Week", "Day", "Month"]) {
    await page.getByRole("button", { name: view, exact: true }).click();
    await expect(page.locator(".calendar-task, .calendar-agenda-task, .calendar-week-task, .calendar-day-task")).toHaveCount(0);
  }
  await page.reload();
  await expect(page.locator(".save-status")).toContainText("Local demo saved");
  if (!await filter.isVisible()) await page.getByRole("button", { name: "Show calendar view" }).click();
  await expect(filter.getByRole("button", { name: /^Events\b/ })).toHaveAttribute("aria-pressed", "true");
  await filter.getByRole("button", { name: /^Tasks\b/ }).click();
  await expect(page.locator(".calendar-agenda-task").first()).toBeVisible();
  await expect(page.locator(".calendar-summary")).not.toContainText("events");
  await filter.getByRole("button", { name: /^All\b/ }).click();
  await expect(page.locator(".calendar-summary")).toContainText("events");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/calendar-filter-${test.info().project.name}.png` });
});
