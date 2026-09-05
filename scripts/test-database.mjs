import { spawnSync } from "node:child_process";

// Obtain ephemeral credentials from the named local stack, never .env.local.
const windows = process.platform === "win32";
const status = spawnSync(windows ? "npx.cmd" : "npx", ["--no-install", "supabase", "status", "-o", "json"], {
  encoding: "utf8", shell: windows,
});
if (status.status !== 0) {
  console.error("Start the disposable database with npm run database:start before running this gate.");
  process.exit(1);
}
const local = JSON.parse(status.stdout);
const url = new URL(local.API_URL);
if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== "55321") {
  throw new Error("Refusing to run database tests outside the disposable localhost:55321 stack.");
}
const env = {
  ...process.env,
  STICKY_DATABASE_TEST: "true",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: local.ANON_KEY,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.ANON_KEY,
  SUPABASE_SECRET_KEY: local.SERVICE_ROLE_KEY,
  SUPABASE_SERVICE_ROLE_KEY: "",
  STICKY_DEMO_MODE: "false",
  NEXT_PUBLIC_STICKY_DEMO_MODE: "false",
  WORKFLOW_ENABLED: "false",
  POKE_API_KEY: "",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
};
const browser = process.argv.includes("--browser");
const result = spawnSync(process.execPath, browser
  ? ["node_modules/@playwright/test/cli.js", "test", "--config", "playwright.database.config.ts"]
  : ["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.database.config.ts"],
{ env, stdio: "inherit" });
process.exit(result.status ?? 1);
