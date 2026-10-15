import { expect, test } from "@playwright/test";

test("task due labels show Yesterday while preserving Today and older dates", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator(".save-status")).toContainText("Local demo saved");
  const card = page.locator('.task-card[data-task-id="demo-task-review-launch"]');
  await card.locator(".task-body-button").first().click();
  const details = page.getByRole("complementary", { name: "Task details", exact: true });
  const dates = await page.evaluate(() => {
    const key = (offset: number) => {
      const date = new Date();
      date.setDate(date.getDate() + offset);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    };
    return { today: key(0), yesterday: key(-1), older: key(-2) };
  });
  await details.getByLabel("Due date", { exact: true }).fill(dates.yesterday);
  await expect(details.getByRole("button", { name: "Due date: Yesterday", exact: true })).toBeVisible();
  await details.getByLabel("Due time", { exact: true }).fill("09:00");
  await expect(card).toContainText("Yesterday at 9:00 AM");
  await page.screenshot({ path: testInfo.outputPath("yesterday-label.png") });
  await details.getByLabel("Due date", { exact: true }).fill(dates.today);
  await expect(card).toContainText("Today at 9:00 AM");
  await details.getByLabel("Due date", { exact: true }).fill(dates.older);
  await expect(card).not.toContainText("Yesterday");
  await expect(card).not.toContainText("Today");
  await expect(card).toContainText("at 9:00 AM");
  expect(errors).toEqual([]);
});
