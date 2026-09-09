import { test, expect } from "@playwright/test";

test.setTimeout(90_000);

test("monthly capture selects multiple dates and preserves them through completion", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.setFixedTime(new Date("2026-09-09T12:00:00Z"));
  await page.goto("/");
  await page.getByText("Local demo saved", { exact: true }).waitFor({ state: "attached" });
  await page.getByRole("button", { name: "Add a task", exact: true }).first().click();
  await page.getByLabel("Quick add task").fill("Monthly dates verification");
  await page.getByRole("button", { name: "Set a repeat cadence", exact: true }).click();
  await page.getByRole("button", { name: "Monthly", exact: true }).click();
  const picker = page.getByRole("group", { name: "Days of the month", exact: true });
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: "1st & 15th", exact: true }).click();
  await expect(picker.getByRole("button", { name: "Repeat on day 1", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(picker.getByRole("button", { name: "Repeat on day 15", exact: true })).toHaveAttribute("aria-pressed", "true");
  const form = page.locator(".board-quick-capture.expanded");
  const formBox = await form.boundingBox();
  const columnBox = await form.locator("..").boundingBox();
  expect(formBox!.y + formBox!.height).toBeLessThanOrEqual(columnBox!.y + columnBox!.height + 1);
  await page.screenshot({ path: `.tmp-monthly-full-${testInfo.project.name}.png` });
  await picker.screenshot({ path: `.tmp-monthly-${testInfo.project.name}.png` });
  await page.getByRole("button", { name: /^Add task to/ }).first().click();
  const details = page.getByRole("complementary", { name: "Task details", exact: true });
  if (!(await details.isVisible())) await page.getByText("Monthly dates verification", { exact: true }).first().click();
  await expect(details.locator('input[aria-label="Due date"]')).toHaveValue("2026-09-15");
  await expect(details.getByRole("button", { name: "Repeat on day 15", exact: true })).toHaveAttribute("aria-pressed", "true");
  await details.getByRole("button", { name: "Repeat on last day", exact: true }).click();
  await details.getByRole("button", { name: "Complete Monthly dates verification", exact: true }).click();
  await page.reload();
  await page.getByText("Monthly dates verification", { exact: true }).first().click();
  await expect(details.getByRole("button", { name: "Repeat on last day", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
