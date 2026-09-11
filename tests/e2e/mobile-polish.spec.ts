import { expect, test } from "@playwright/test";

test.describe("mobile content geometry", () => {
  test.beforeEach(async ({ page }, info) => {
    test.skip(info.project.name !== "mobile");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
  });

  test("sort help never overlaps controls", async ({ page }) => {
    await page.locator(".task-sort-control button").nth(1).click();
    const controls = await page.locator(".task-sort-control").boundingBox();
    const help = await page.locator(".task-sort-row > span").boundingBox();
    expect(controls && help).toBeTruthy();
    expect(help!.y >= controls!.y + controls!.height || help!.x >= controls!.x + controls!.width).toBe(true);
    await page.screenshot({ path: ".tmp-mobile-board-polish.png" });
  });

  test("calendar shows complete weeks and scrolls to its agenda", async ({ page }) => {
    await page.getByRole("button", { name: "Show calendar view" }).click();
    const grid = page.locator(".calendar-grid");
    await expect(grid).toBeVisible();
    expect(await grid.evaluate(el => el.clientHeight >= el.scrollHeight - 1)).toBe(true);
    await page.screenshot({ path: ".tmp-mobile-calendar-polish.png" });
    await page.locator(".calendar-cell-header").last().click();
    await expect(page.locator(".calendar-agenda-header")).toBeInViewport();
    await page.screenshot({ path: ".tmp-mobile-agenda-polish.png" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test("overview stays closable after scrolling to the horizon", async ({ page }) => {
    await page.getByRole("button", { name: "Open command deck overview" }).click();
    await page.screenshot({ path: ".tmp-mobile-overview-polish.png" });
    await page.locator(".deck-horizon").scrollIntoViewIfNeeded();
    await expect(page.getByRole("button", { name: "Close command deck" })).toBeInViewport();
    await page.screenshot({ path: ".tmp-mobile-overview-scrolled.png" });
    await page.getByRole("button", { name: "Close command deck" }).click();
    await expect(page.getByRole("dialog", { name: "Command deck overview" })).toHaveCount(0);
  });

  test("touch swipes and short screens keep navigation usable", async ({ page, context }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    const board = page.locator(".board-scroll");
    await board.scrollIntoViewIfNeeded();
    const box = await page.locator(".board-column").first().locator(".column-header").boundingBox();
    expect(box).not.toBeNull();
    const session = await context.newCDPSession(page);
    const y = Math.min(440, box!.y + box!.height / 2);
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 255, y }] });
    for (let step = 1; step <= 10; step++) {
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 255 - step * 20, y }] });
      await page.waitForTimeout(20);
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => board.evaluate(el => el.scrollLeft)).toBeGreaterThan(100);
    await expect(page.locator(".board-pager-dot.active")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Show calendar view" })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: ".tmp-mobile-short-board.png" });
  });

  test("landscape keeps the board wide and restores other screens after rotation", async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.locator(".sticky-app")).toHaveClass(/phone-landscape/);
    await expect(page.locator(".board-scroll")).toBeVisible();
    const first = await page.locator(".board-column").first().boundingBox();
    expect(first!.width).toBeLessThan(350);
    await expect(page.locator(".board-column").nth(1)).toBeInViewport();
    await page.screenshot({ path: ".tmp-landscape-board.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Open command deck overview" }).click();
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.locator(".calendar-view")).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Command deck overview" })).toHaveCount(0);
    const month = await page.locator(".calendar-month").boundingBox();
    const agenda = await page.locator(".calendar-agenda").boundingBox();
    expect(agenda!.x).toBeGreaterThanOrEqual(month!.x + month!.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: ".tmp-landscape-calendar.png" });
    await page.setViewportSize({ width: 932, height: 430 });
    await expect(page.locator(".sticky-app")).toHaveClass(/phone-landscape/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("dialog", { name: "Command deck overview" })).toBeVisible();
    await page.getByRole("button", { name: "Close command deck" }).click();
    // A portrait software keyboard must not switch workspace modes.
    await page.setViewportSize({ width: 390, height: 300 });
    await expect(page.locator(".sticky-app")).not.toHaveClass(/phone-landscape/);
    await expect(page.locator(".board-scroll")).toBeVisible();
  });

  test("rotation preserves task edits and unfinished subtask capture", async ({ page }) => {
    await page.locator(".task-card").first().click();
    const details = page.getByRole("complementary", { name: "Task details" });
    await details.getByRole("textbox", { name: "Title", exact: true }).fill("Preserved across rotation");
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.locator(".calendar-view")).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(details.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Preserved across rotation");
    await details.getByPlaceholder("Add subtask", { exact: true }).fill("Unsubmitted subtask draft");
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.locator(".calendar-view")).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(details.getByPlaceholder("Add subtask", { exact: true })).toHaveValue("Unsubmitted subtask draft");
  });
});

test("completed section cannot collapse underneath its own control", async ({ page }, info) => {
  await page.setViewportSize(info.project.name === "mobile" ? { width: 390, height: 640 } : { width: 1280, height: 622 });
  await page.goto("/");
  await expect(page.locator(".completed-toggle").first()).toBeVisible();
  const geometry = await page.locator(".completed-toggle").first().evaluate(button => ({
    control: button.getBoundingClientRect().height,
    section: button.parentElement!.getBoundingClientRect().height,
  }));
  expect(geometry.control).toBeGreaterThanOrEqual(44);
  expect(geometry.section).toBeGreaterThanOrEqual(geometry.control);
});
