import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";

test("login spotlight preserves its gradient without inheriting through form contents", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?auth_error=Sign%20in%20to%20continue");
  const door = page.locator(".gate-door-google");
  await expect(door).toBeVisible();
  await expect(page.locator(".gate-decrypt")).toHaveText("Your lists are right where you left them.");
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator(".gate-card")).toHaveCSS("filter", "blur(0px)");
  await expect(page.locator(".gate-card")).toHaveCSS("opacity", "1");
  // Motion's JS-driven entrance can outlive the rounded blur value. Wait for
  // its actual scale and translation before sampling geometry or pixels.
  await expect.poll(() => page.locator(".gate-card").evaluate(element => {
    const transform = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return [transform.m11, transform.m22, transform.m41, transform.m42];
  })).toEqual([1, 1, 0, 0]);
  const result = await door.evaluate(async element => {
    const rect = element.getBoundingClientRect();
    let reads = 0;
    const originalRead = element.getBoundingClientRect.bind(element);
    element.getBoundingClientRect = () => { reads++; return originalRead(); };
    for (let i = 0; i < 100; i++) {
    element.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true, pointerType: "mouse",
      clientX: rect.left + rect.width * 0.25,
      clientY: rect.top + rect.height * 0.75,
    }));
    }
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    return {
      reads,
      gradient: getComputedStyle(element, "::after").backgroundImage,
      child: getComputedStyle(element.querySelector("strong")!).getPropertyValue("--gate-pointer-x").trim(),
    };
  });
  expect(result.gradient).toContain("220px at 25% 75%");
  expect(result.child).toBe("50%");
  expect(result.reads).toBe(1);
  await expect(page.locator(".gate-decrypt")).toHaveText("Your lists are right where you left them.");
  await door.focus();
  // Wait for the focus spotlight to finish fading in before comparing pixels.
  await expect.poll(() => door.evaluate(element => getComputedStyle(element, "::after").opacity)).toBe("1");
  const optimized = await door.screenshot({ animations: "disabled" });
  const optimizedGradient = await door.evaluate(e => getComputedStyle(e, "::after").backgroundImage);
  // Recreate the original gradient at the identical pointer coordinates.
  await page.addStyleTag({ content: ".gate-door-google::after { background: radial-gradient(220px circle at 25% 75%, rgba(var(--accent-rgb), 0.14), transparent 70%) !important; }" });
  const original = await door.screenshot({ animations: "disabled" });
  expect(await door.evaluate(e => getComputedStyle(e, "::after").backgroundImage)).toBe(optimizedGradient);
  // Compare decoded pixels, allowing only Chromium's observed 1-2/255 channel
  // rounding on repaints. CSS must match exactly above; no pixels are ignored.
  const difference = await page.evaluate(async ({ actual, expected }) => {
    async function decode(bytes: number[]) {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d")!;
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      return { width: canvas.width, height: canvas.height, pixels: context.getImageData(0, 0, canvas.width, canvas.height).data };
    }
    const [a, b] = await Promise.all([decode(actual), decode(expected)]);
    if (a.width !== b.width || a.height !== b.height) return { sameSize: false, maxChannelDelta: 255 };
    let maxChannelDelta = 0;
    for (let i = 0; i < a.pixels.length; i++) {
      maxChannelDelta = Math.max(maxChannelDelta, Math.abs(a.pixels[i] - b.pixels[i]));
    }
    return { sameSize: true, maxChannelDelta };
  }, { actual: [...optimized], expected: [...original] });
  if (!difference.sameSize || difference.maxChannelDelta > 2) {
    const optimizedPath = testInfo.outputPath("optimized-spotlight.png");
    const originalPath = testInfo.outputPath("original-spotlight.png");
    await writeFile(optimizedPath, optimized);
    await writeFile(originalPath, original);
    await testInfo.attach("optimized-spotlight", { path: optimizedPath, contentType: "image/png" });
    await testInfo.attach("original-spotlight", { path: originalPath, contentType: "image/png" });
  }
  expect(difference.sameSize).toBe(true);
  expect(difference.maxChannelDelta, "spotlight pixels must match apart from 8-bit rounding").toBeLessThanOrEqual(2);
});

test("login text animation survives form edits and motion preference changes", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/?auth_error=Sign%20in%20to%20continue");
  await page.locator("input[type=email]").fill("preview@example.com");
  const text = page.locator(".gate-decrypt > span");
  await expect(text).toHaveText("Your lists are right where you left them.");
  await page.locator("input[type=email]").fill("updated@example.com");
  await expect(text).toHaveText("Your lists are right where you left them.");
  const canvasReads = await page.locator(".gate-canvas").evaluate(async canvas => {
    let reads = 0;
    const originalRead = canvas.getBoundingClientRect.bind(canvas);
    canvas.getBoundingClientRect = () => { reads++; return originalRead(); };
    for (let i = 0; i < 100; i++) {
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 20 + i, clientY: 30 }));
    }
    const burst = reads;
    for (let i = 0; i < 5; i++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 120 + i, clientY: 30 }));
    }
    const acrossFrames = reads;
    window.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 120, clientY: 30 }));
    const afterScroll = reads;
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 120, clientY: 30 }));
    const afterResize = reads;
    window.visualViewport?.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 120, clientY: 30 }));
    return { burst, acrossFrames, afterScroll, afterResize, afterViewport: reads, hasViewport: !!window.visualViewport };
  });
  expect(canvasReads.burst).toBeLessThanOrEqual(1);
  expect(canvasReads.acrossFrames).toBe(canvasReads.burst);
  expect(canvasReads.afterScroll).toBe(canvasReads.burst + 1);
  expect(canvasReads.afterResize).toBe(canvasReads.afterScroll + 1);
  expect(canvasReads.afterViewport).toBe(canvasReads.afterResize + Number(canvasReads.hasViewport));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(text).toHaveText("Your lists are right where you left them.");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(text).toHaveText("Your lists are right where you left them.");
});
