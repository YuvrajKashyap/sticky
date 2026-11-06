import { expect, test } from "@playwright/test";

test("offline navigation never replays a cached workspace", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  const cachedPaths = await page.evaluate(async () => {
    const paths: string[] = [];
    for (const name of await caches.keys()) {
      if (!name.startsWith("sticky-shell-")) continue;
      for (const request of await (await caches.open(name)).keys()) paths.push(new URL(request.url).pathname);
    }
    return paths;
  });
  expect(cachedPaths).not.toContain("/");
  expect(cachedPaths).toContain("/manifest.webmanifest");
  await context.setOffline(true);
  try {
    const response = await page.goto("/");
    expect(response?.status()).toBe(503);
    await expect(page.getByRole("heading", { name: "Sticky is offline" })).toBeVisible();
    await expect(page.getByText("Reconnect to load your workspace, then refresh this page.")).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
