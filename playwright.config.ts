import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100";
const parsedBaseURL = new URL(baseURL);
const shouldStartLocalServer = ["localhost", "127.0.0.1"].includes(parsedBaseURL.hostname);
const devServerPort =
  parsedBaseURL.port || (parsedBaseURL.protocol === "https:" ? "443" : "80");

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 8_000,
  },
  use: {
    baseURL,
    channel: "chrome",
    trace: "on-first-retry",
  },
  webServer: shouldStartLocalServer
    ? {
        command: `npm run dev -- --port ${devServerPort}`,
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
        env: {
          CRON_SECRET: process.env.CRON_SECRET ?? "test-cron-secret",
          NEXT_PUBLIC_STICKY_DEMO_MODE:
            process.env.NEXT_PUBLIC_STICKY_DEMO_MODE ?? "true",
          SUPABASE_SECRET_KEY: "",
          SUPABASE_SERVICE_ROLE_KEY: "",
        },
      }
    : undefined,
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 960 },
      },
    },
    {
      name: "mobile",
      use: {
        ...devices["Pixel 7"],
      },
    },
  ],
});
