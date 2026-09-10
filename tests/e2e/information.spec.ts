import { expect, test } from "@playwright/test";

test("public information is readable without signing in", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  for (const [path, heading] of [["/about", "Sticky"], ["/privacy", "Privacy policy"], ["/terms", "Terms of use"]]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: heading, exact: true, level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "About Sticky" }).getByRole("link", { name: "Privacy", exact: true })).toHaveAttribute("href", "/privacy");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  expect(errors).toEqual([]);
});
