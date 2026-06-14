import { spawn } from "node:child_process";

const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ??
  process.env.STICKY_PRODUCTION_URL ??
  "https://sticky-green.vercel.app";
const playwrightArgs = ["playwright", "test", "tests/e2e/production-smoke.spec.ts", ...process.argv.slice(2)];

function quoteCmdArg(value) {
  return /^[A-Za-z0-9_./:=@-]+$/.test(value) ? value : `"${value.replace(/"/g, '""')}"`;
}

const command = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npx";
const args =
  process.platform === "win32"
    ? ["/d", "/s", "/c", ["npx", ...playwrightArgs].map(quoteCmdArg).join(" ")]
    : playwrightArgs;

console.log(`Sticky production smoke`);
console.log(`PLAYWRIGHT_BASE_URL=${baseURL}`);
console.log("");

const child = spawn(command, args, {
  env: {
    ...process.env,
    PLAYWRIGHT_BASE_URL: baseURL,
  },
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Production smoke stopped by ${signal}`);
    process.exitCode = 1;
    return;
  }

  process.exitCode = code ?? 1;
});
