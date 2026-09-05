import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/database-browser",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  use: { baseURL: "http://localhost:3198", channel: "chrome", trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev -- --port 3198",
    url: "http://localhost:3198",
    reuseExistingServer: false,
    timeout: 120_000,
    env: { STICKY_DEMO_MODE: "false", NEXT_PUBLIC_STICKY_DEMO_MODE: "false", WORKFLOW_ENABLED: "false" },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 960 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
