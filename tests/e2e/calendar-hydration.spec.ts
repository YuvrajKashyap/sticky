import { expect, test } from "@playwright/test";

for (const reducedMotion of ["reduce", "no-preference"] as const) {
test(`remembered calendar hydrates with visible tasks (${reducedMotion})`, async ({ page }) => {
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion });
  await page.goto("/");
  await expect(page.locator(".save-status")).toContainText("Local demo saved");
  await page.getByRole("button", { name: "Show calendar view" }).click();
  await page.getByRole("group", { name: "Calendar view", exact: true }).getByRole("button", { name: "Week", exact: true }).click();
  await page.reload();
  await expect(page.locator(".save-status")).toContainText("Local demo saved");
  await expect(page.getByRole("group", { name: "Calendar view", exact: true }).getByRole("button", { name: "Week", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".calendar-task").first()).toBeVisible();
  await expect(page.locator(".calendar-task").first()).toHaveCSS("opacity", "1");
  expect(errors).toEqual([]);
});
}
