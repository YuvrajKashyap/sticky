import { expect, test } from "@playwright/test";

for (const reducedMotion of ["reduce", "no-preference"] as const) {
  test(`remembered overview hydrates with a live clock (${reducedMotion})`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", error => errors.push(error.message));
    await page.emulateMedia({ reducedMotion });
    await page.goto("/");
    await expect(page.locator(".save-status")).toContainText("Local demo saved");
    await page.getByRole("button", { name: "Open command deck overview" }).click();
    await expect(page.getByRole("dialog", { name: "Command deck overview" })).toBeVisible();
    await page.reload();
    await expect(page.locator(".save-status")).toContainText("Local demo saved");
    await expect(page.getByRole("dialog", { name: "Command deck overview" })).toBeVisible();
    await expect(page.locator(".deck-topbar")).toHaveCSS("opacity", "1");
    const clock = page.locator(".deck-clock-time");
    await expect(clock).toHaveText(/^\d{2}:\d{2}:\d{2}$/);
    await expect(page.locator(".deck-clock-date")).toHaveText(/^[A-Z]{3} \d{2} [A-Z]{3} \d{4}$/);
    const firstTick = await clock.textContent();
    await expect.poll(() => clock.textContent(), { timeout: 5_000 }).not.toBe(firstTick);
    expect(errors).toEqual([]);
  });
}
