import { expect, test } from "@playwright/test";

test("browser remembers the three main workspace views", async ({ page }) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: "Show calendar view" }).click();
  await page.reload();
  await expect(page.locator(".calendar-view")).toBeVisible();
  await page.getByLabel("Open appearance settings").click();
  await Promise.all([
    page.waitForEvent("framenavigated", frame => frame === page.mainFrame()),
    page.getByRole("button", { name: "Sign out", exact: true }).click(),
  ]);
  await expect(page.locator(".calendar-view")).toBeVisible();
  await page.getByRole("button", { name: "Open command deck overview" }).click();
  await page.reload();
  await expect(page.getByRole("dialog", { name: "Command deck overview" })).toBeVisible();
  await page.getByRole("button", { name: "Close command deck" }).click();
  await page.getByRole("button", { name: "Show board view" }).click();
  await page.reload();
  await expect(page.locator(".board-scroll")).toBeVisible();
  await expect(page.locator(".calendar-view")).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Command deck overview" })).toHaveCount(0);
});
