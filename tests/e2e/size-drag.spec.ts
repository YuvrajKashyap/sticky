import { expect, test } from "@playwright/test";

test("interface size drag stays controlled as the page resizes", async ({ page, isMobile }) => {
  await page.goto("/");
  await page.getByLabel("Open appearance settings").click();
  if (!isMobile) {
    await page.getByRole("button", { name: "Manual", exact: true }).click();
    await page.getByRole("button", { name: "100%", exact: true }).click();
  }
  const min = isMobile ? 60 : 25;
  const max = isMobile ? 140 : 400;
  const slider = page.getByRole("slider", { name: isMobile ? "Mobile interface size" : "Manual interface size", exact: true });
  const box = (await slider.boundingBox())!;
  const x = box.x + box.width * (100 - min) / (max - min);
  await page.mouse.move(x, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(x + 20, box.y + box.height / 2, { steps: 10 });
  expect(Number(await slider.inputValue())).toBeGreaterThan(100);
  expect(Number(await slider.inputValue())).toBeLessThanOrEqual(110);
  await page.mouse.move(x, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(slider).toHaveValue("100");
  await slider.press("End");
  await expect(slider).toHaveValue(String(max));
  await slider.press("Home");
  await expect(slider).toHaveValue(String(min));
});
