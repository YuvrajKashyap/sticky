import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }, info) => {
  test.skip(info.project.name !== "mobile");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".mobile-resizable")).toBeVisible();
});

test("filter bar fits both edges and its final filter remains reachable", async ({ page }) => {
  const bar = page.locator(".task-filter-bar");
  const bounds = await bar.boundingBox();
  expect(bounds!.x).toBeGreaterThan(0);
  expect(bounds!.x + bounds!.width).toBeLessThan(390);
  await bar.evaluate(el => { el.scrollLeft = el.scrollWidth; });
  await expect(bar.getByRole("button").last()).toBeInViewport({ ratio: 1 });
});

test("landscape defaults to a compact layout with the full month visible", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator(".sticky-app")).toHaveClass(/phone-landscape/);
  await expect.poll(async () => (await page.locator(".board-column").first().boundingBox())!.width).toBeLessThan(250);
  await page.screenshot({ path: ".tmp-compact-board.png" });
  await page.getByRole("button", { name: "Show calendar view" }).click();
  await expect(page.locator(".calendar-cell").last()).toBeInViewport({ ratio: 0.99 });
  expect((await page.locator(".calendar-cell").last().boundingBox())!.y + (await page.locator(".calendar-cell").last().boundingBox())!.height).toBeLessThan(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: ".tmp-compact-landscape.png" });
});

test("two-finger pinching reflows the workspace in both directions", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "Native touch injection uses Chromium CDP");
  const session = await context.newCDPSession(page);
  const title = page.locator(".workspace-title h2");
  const initial = (await title.boundingBox())!.height;
  const listOrder = await page.locator(".board-column").evaluateAll(els => els.map(el => el.getAttribute("data-list-id")));
  async function pinch(from: number, to: number) {
    const header = await page.locator(".column-header").first().boundingBox();
    const y = header!.y + header!.height / 2;
    const points = (gap: number) => [{ x: 195 - gap / 2, y, id: 1 }, { x: 195 + gap / 2, y, id: 2 }];
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(from).slice(0, 1) });
    await page.waitForTimeout(30);
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(from) });
    for (let step = 1; step <= 8; step++) {
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(from + (to - from) * step / 8) });
      await page.waitForTimeout(20);
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
  await pinch(200, 140);
  await expect.poll(async () => (await title.boundingBox())!.height).toBeLessThan(initial * 0.85);
  await page.reload();
  await expect(page.locator(".mobile-resizable")).toBeVisible();
  await expect.poll(async () => (await title.boundingBox())!.height).toBeLessThan(initial * 0.85);
  const smaller = (await title.boundingBox())!.height;
  await pinch(140, 200);
  await expect.poll(async () => (await title.boundingBox())!.height).toBeGreaterThan(smaller * 1.2);
  expect(await page.evaluate(() => window.visualViewport!.scale)).toBe(1);
  expect(await page.locator(".board-column").evaluateAll(els => els.map(el => el.getAttribute("data-list-id")))).toEqual(listOrder);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole("button", { name: "Show calendar view" })).toBeInViewport();
});

test("mobile size controls reset and remember each orientation independently", async ({ page }) => {
  await page.getByLabel("Open appearance settings").click();
  const slider = page.getByRole("slider", { name: "Mobile interface size" });
  await slider.focus();
  await slider.press("End");
  await expect(slider).toHaveValue("140");
  await expect(page.getByRole("button", { name: "Reset size" })).toBeInViewport();
  await page.getByRole("button", { name: "Reset size" }).click();
  await expect(slider).toHaveValue("100");
  await slider.press("Home");
  await expect(slider).toHaveValue("60");
  await page.getByLabel("Open appearance settings").click();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect.poll(() => page.locator(".sticky-app").evaluate(el => getComputedStyle(el).getPropertyValue("--mobile-zoom"))).toBe("0.7");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator(".sticky-app").evaluate(el => getComputedStyle(el).getPropertyValue("--mobile-zoom"))).toBe("0.6");
  await expect(page.getByLabel("Open appearance settings")).toBeInViewport();
  await page.getByRole("button", { name: "Show calendar view" }).click();
  await page.locator(".calendar-cell-header").last().click();
  await expect(page.locator(".calendar-agenda-header")).toBeInViewport();
});
