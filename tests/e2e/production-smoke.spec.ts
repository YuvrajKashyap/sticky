import { expect, test, type Page } from "@playwright/test";

import { GENERIC_STICKY_ACCESS_MESSAGE } from "../../src/lib/sticky/messages";

function recordConsoleErrors(page: Page) {
  const errors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });

  page.on("pageerror", (error) => {
    errors.push(error.message);
  });

  return errors;
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    .toBe(true);
}

async function expectMobileZoomAllowed(page: Page) {
  const viewport = page.locator('meta[name="viewport"]');

  await expect(viewport).toHaveAttribute("content", /width=device-width/);
  await expect(viewport).not.toHaveAttribute("content", /maximum-scale=1|user-scalable=no/i);
}

async function expectNoTechnicalTerms(page: Page) {
  await expect(page.locator("body")).not.toContainText(
    /sticky\.allowed_emails|row-level security|Supabase Auth|NEXT_PUBLIC_SUPABASE|permission denied|schema sticky/i,
  );
}

test.describe("Sticky production smoke", () => {
  test("signed-out shell is polished and responsive", async ({ page }) => {
    const consoleErrors = recordConsoleErrors(page);

    await page.goto("/");
    await expect(page).toHaveTitle(/Sticky/);
    await expect(page.getByRole("heading", { name: "Sign in to Sticky" })).toBeVisible();
    await expect(page.getByText("Tactile planning")).toBeVisible();
    await expect(page.getByText("Private by default")).toBeVisible();
    await expectNoTechnicalTerms(page);
    await expectMobileZoomAllowed(page);
    await expectNoHorizontalOverflow(page);
    expect(consoleErrors).toEqual([]);
  });

  test("auth callback errors stay product-facing", async ({ page }) => {
    const consoleErrors = recordConsoleErrors(page);

    await page.goto("/auth/callback?error_description=permission%20denied%20for%20schema%20sticky");
    const redirectedUrl = new URL(page.url());

    expect(redirectedUrl.pathname).toBe("/");
    expect(redirectedUrl.searchParams.get("auth_error")).toBe(GENERIC_STICKY_ACCESS_MESSAGE);
    await expect(page.getByRole("heading", { name: "Sign in to Sticky" })).toBeVisible();
    await expect(page.getByText(GENERIC_STICKY_ACCESS_MESSAGE)).toBeVisible();
    await expectNoTechnicalTerms(page);
    await expectNoHorizontalOverflow(page);
    expect(consoleErrors).toEqual([]);
  });

  test("provider callback errors preserve the production origin", async ({ page }, testInfo) => {
    const consoleErrors = recordConsoleErrors(page);
    const expectedOrigin = new URL(
      String(testInfo.project.use.baseURL ?? process.env.PLAYWRIGHT_BASE_URL ?? "https://sticky-green.vercel.app"),
    ).origin;

    await page.goto("/auth/callback?error_description=Provider%20denied");
    const redirectedUrl = new URL(page.url());

    expect(redirectedUrl.origin).toBe(expectedOrigin);
    expect(redirectedUrl.pathname).toBe("/");
    expect(redirectedUrl.searchParams.get("auth_error")).toBe("Provider denied");
    await expect(page.getByRole("heading", { name: "Sign in to Sticky" })).toBeVisible();
    await expect(page.getByText("Provider denied")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect(consoleErrors).toEqual([]);
  });

  test("production routes expose install assets and hardened headers", async ({ request }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "route smoke only needs one browser project");

    for (const route of ["/", "/api/recurrence/catch-up"]) {
      const response = await request.get(route);
      const csp = response.headers()["content-security-policy"];

      if (route === "/") {
        expect(response.status()).toBe(200);
      } else {
        expect([401, 503]).toContain(response.status());
      }

      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(response.headers()["strict-transport-security"]).toContain("max-age=63072000");
      expect(response.headers()["x-frame-options"]).toBe("DENY");
      expect(response.headers()["x-content-type-options"]).toBe("nosniff");
      expect(response.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");
      expect(response.headers()["permissions-policy"]).toContain("camera=()");
    }

    const cronResponse = await request.get("/api/recurrence/catch-up");
    expect([401, 503]).toContain(cronResponse.status());

    const manifestResponse = await request.get("/manifest.webmanifest");
    expect(manifestResponse.status()).toBe(200);
    expect(manifestResponse.headers()["content-type"]).toContain("application/manifest+json");

    const manifest = (await manifestResponse.json()) as {
      screenshots?: Array<{ src: string; form_factor?: string; sizes?: string }>;
      shortcuts?: Array<{ name: string; url: string }>;
    };

    expect(manifest.shortcuts?.map((shortcut) => shortcut.url)).toEqual([
      "/?intent=capture",
      "/?view=today",
      "/?view=scheduled",
      "/?intent=search",
    ]);
    expect(manifest.screenshots).toEqual([
      expect.objectContaining({ src: "/install-screenshot-wide", form_factor: "wide" }),
      expect.objectContaining({ src: "/install-screenshot-narrow", form_factor: "narrow" }),
    ]);

    for (const route of [
      "/install-screenshot-wide",
      "/install-screenshot-narrow",
      "/opengraph-image",
      "/twitter-image",
    ]) {
      const response = await request.get(route);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toContain("image/png");
      expect((await response.body()).length).toBeGreaterThan(10_000);
    }
  });
});
