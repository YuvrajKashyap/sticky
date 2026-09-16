import { expect, test } from "@playwright/test";

test("interface size drag stays controlled as the page resizes", async ({ page, isMobile }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByLabel("Open appearance settings").click();
  if (!isMobile) {
    await page.getByRole("button", { name: "Manual", exact: true }).click();
    await page.getByRole("button", { name: "100%", exact: true }).click();
  }
  const min = isMobile ? 60 : 25;
  const max = isMobile ? 140 : 400;
  const slider = page.getByRole("slider", { name: isMobile ? "Mobile interface size" : "Manual interface size", exact: true });
  const tools = page.locator(".workspace-tools");
  const panel = page.locator(".preference-controls");
  await panel.evaluate(async node => { await Promise.all(node.getAnimations().map(animation => animation.finished)); });
  const beforeTools = (await tools.boundingBox())!;
  const beforePanel = (await panel.boundingBox())!;
  const box = (await slider.boundingBox())!;
  const x = box.x + box.width * (100 - min) / (max - min);
  await page.mouse.move(x, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(x + 20, box.y + box.height / 2, { steps: 10 });
  await expect(slider).toHaveValue("100");
  await page.mouse.move(x + 240, box.y + box.height / 2, { steps: 12 });
  await expect(slider).toHaveValue("105");
  await page.mouse.move(x, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(slider).toHaveValue("100");
  await slider.press("End");
  await expect(slider).toHaveValue(String(max));
  const afterTools = (await tools.boundingBox())!;
  const afterPanel = (await panel.boundingBox())!;
  for (const key of ["x", "y", "width", "height"] as const) {
    expect(Math.abs(afterTools[key] - beforeTools[key]), `toolbar ${key}`).toBeLessThan(2);
    expect(Math.abs(afterPanel[key] - beforePanel[key]), `panel ${key}`).toBeLessThan(2);
  }
  await slider.press("Home");
  await expect(slider).toHaveValue(String(min));
  const smallestTools = (await tools.boundingBox())!;
  const smallestPanel = (await panel.boundingBox())!;
  for (const key of ["x", "y", "width", "height"] as const) {
    expect(Math.abs(smallestTools[key] - beforeTools[key]), `small toolbar ${key}`).toBeLessThan(2);
    expect(Math.abs(smallestPanel[key] - beforePanel[key]), `small panel ${key}`).toBeLessThan(2);
  }
  await page.screenshot({ path: `test-results/fixed-size-controls-${isMobile ? "mobile" : "desktop"}.png` });
});
