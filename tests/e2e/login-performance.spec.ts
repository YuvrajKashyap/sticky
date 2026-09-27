import { expect, test } from "@playwright/test";

test("login spotlight preserves its gradient without inheriting through form contents", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?auth_error=Sign%20in%20to%20continue");
  const door = page.locator(".gate-door-google");
  await expect(door).toBeVisible();
  await expect(page.locator(".gate-decrypt")).toHaveText("Your lists are right where you left them.");
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator(".gate-card")).toHaveCSS("filter", "blur(0px)");
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
  // Recreate the original gradient at the identical pointer coordinates.
  await page.addStyleTag({ content: ".gate-door-google::after { background: radial-gradient(220px circle at 25% 75%, rgba(var(--accent-rgb), 0.14), transparent 70%) !important; }" });
  const original = await door.screenshot({ animations: "disabled" });
  expect(original.equals(optimized), "spotlight pixels must match the original gradient").toBe(true);
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
