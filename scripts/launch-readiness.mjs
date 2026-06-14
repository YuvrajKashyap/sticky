import { execFile } from "node:child_process";
import { resolve4 } from "node:dns/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const productionUrl = process.env.STICKY_PRODUCTION_URL ?? "https://sticky-green.vercel.app";
const customDomain = process.env.STICKY_DOMAIN ?? "sticky.yuvrajkashyap.com";
const expectedARecord = process.env.STICKY_EXPECTED_A_RECORD ?? "76.76.21.21";
const vercelScope = process.env.VERCEL_SCOPE ?? "yuvraj-kashyaps-projects";

const results = [];

function record(status, check, detail) {
  results.push({ status, check, detail });
  console.log(`${status.toUpperCase()} ${check}: ${detail}`);
}

function pass(check, detail) {
  record("pass", check, detail);
}

function warn(check, detail) {
  record("warn", check, detail);
}

function fail(check, detail) {
  record("fail", check, detail);
}

function normalizeBaseUrl(value) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

async function fetchText(path, baseUrl) {
  const url = new URL(path, baseUrl);
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();

  return { response, text, url };
}

function headerIncludes(headers, name, expected) {
  return headers.get(name)?.toLowerCase().includes(expected.toLowerCase()) ?? false;
}

function quoteCmdArg(value) {
  return /^[A-Za-z0-9_./:=@-]+$/.test(value) ? value : `"${value.replace(/"/g, '""')}"`;
}

async function runVercel(args) {
  if (process.platform === "win32") {
    return execFileAsync(
      process.env.ComSpec ?? "cmd.exe",
      ["/d", "/s", "/c", ["vercel", ...args].map(quoteCmdArg).join(" ")],
      {
        timeout: 30_000,
        windowsHide: true,
      },
    );
  }

  return execFileAsync("vercel", args, {
    timeout: 30_000,
  });
}

async function checkDns() {
  try {
    const records = await resolve4(customDomain);

    if (records.includes(expectedARecord)) {
      pass("custom domain DNS", `${customDomain} resolves to ${expectedARecord}`);
      return true;
    }

    fail(
      "custom domain DNS",
      `${customDomain} resolves to ${records.join(", ") || "no A records"}, expected ${expectedARecord}`,
    );
    return false;
  } catch (error) {
    fail(
      "custom domain DNS",
      `${customDomain} does not resolve; add A ${customDomain} ${expectedARecord} at the DNS host`,
    );
    warn("custom domain DNS detail", error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function checkRoot(origin, label) {
  try {
    const { response, text } = await fetchText("/", origin);
    const title = text.match(/<title[^>]*>(.*?)<\/title>/is)?.[1]?.trim() ?? "";

    if (response.status === 200) {
      pass(`${label} home`, `${origin}/ returned HTTP 200`);
    } else {
      fail(`${label} home`, `${origin}/ returned HTTP ${response.status}`);
    }

    if (title.includes("Sticky")) {
      pass(`${label} title`, `page title includes Sticky`);
    } else {
      fail(`${label} title`, `page title was ${title || "missing"}`);
    }

    checkSecurityHeaders(response.headers, label);
  } catch (error) {
    fail(`${label} home`, error instanceof Error ? error.message : String(error));
  }
}

function checkSecurityHeaders(headers, label) {
  const requiredHeaders = [
    {
      name: "content-security-policy",
      checks: [
        ["default-src 'self'", "default source locked to self"],
        ["frame-ancestors 'none'", "frame ancestors denied"],
      ],
    },
    {
      name: "strict-transport-security",
      checks: [["max-age=", "HSTS present"]],
    },
    {
      name: "x-frame-options",
      checks: [["DENY", "legacy frame denial present"]],
    },
    {
      name: "x-content-type-options",
      checks: [["nosniff", "content sniffing disabled"]],
    },
    {
      name: "referrer-policy",
      checks: [["strict-origin-when-cross-origin", "referrer policy set"]],
    },
    {
      name: "permissions-policy",
      checks: [["camera=()", "permissions policy set"]],
    },
  ];

  for (const header of requiredHeaders) {
    for (const [expected, detail] of header.checks) {
      if (headerIncludes(headers, header.name, expected)) {
        pass(`${label} header ${header.name}`, detail);
      } else {
        fail(`${label} header ${header.name}`, `missing ${expected}`);
      }
    }
  }
}

async function checkRobots(origin) {
  try {
    const { response, text } = await fetchText("/robots.txt", origin);

    if (response.status === 200 && /Disallow:\s*\//i.test(text)) {
      pass("robots", "/robots.txt returns Disallow: /");
    } else {
      fail("robots", `/robots.txt returned HTTP ${response.status} without Disallow: /`);
    }
  } catch (error) {
    fail("robots", error instanceof Error ? error.message : String(error));
  }
}

async function checkManifest(origin) {
  try {
    const { response, text } = await fetchText("/manifest.webmanifest", origin);

    if (response.status !== 200) {
      fail("manifest", `/manifest.webmanifest returned HTTP ${response.status}`);
      return;
    }

    let manifest;

    try {
      manifest = JSON.parse(text);
    } catch (error) {
      fail("manifest", error instanceof Error ? error.message : String(error));
      return;
    }

    const hasStickyName =
      String(manifest.name ?? "").includes("Sticky") ||
      String(manifest.short_name ?? "").includes("Sticky");
    const shortcutCount = Array.isArray(manifest.shortcuts) ? manifest.shortcuts.length : 0;

    if (hasStickyName) {
      pass("manifest name", "manifest identifies Sticky");
    } else {
      fail("manifest name", "manifest is missing Sticky name or short_name");
    }

    if (shortcutCount > 0) {
      pass("manifest shortcuts", `${shortcutCount} shortcuts configured`);
    } else {
      fail("manifest shortcuts", "no shortcuts configured");
    }
  } catch (error) {
    fail("manifest", error instanceof Error ? error.message : String(error));
  }
}

async function checkCronGuard(origin) {
  try {
    const { response } = await fetchText("/api/recurrence/catch-up", origin);

    if (response.status === 401 || response.status === 503) {
      pass("cron guard", `/api/recurrence/catch-up refused unauthenticated request with ${response.status}`);
    } else {
      fail("cron guard", `/api/recurrence/catch-up returned ${response.status}; expected 401 or 503`);
    }
  } catch (error) {
    fail("cron guard", error instanceof Error ? error.message : String(error));
  }
}

function hasProductionEnv(output, key) {
  return output
    .split(/\r?\n/)
    .some((line) => line.trim().startsWith(`${key} `) && /\bProduction\b/.test(line));
}

async function checkVercelEnv() {
  const requiredProductionEnv = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_STICKY_DEMO_MODE",
    "CRON_SECRET",
    "SUPABASE_SECRET_KEY",
    "NEXT_PUBLIC_SITE_URL",
  ];

  try {
    const { stdout, stderr } = await runVercel(["env", "ls", "--scope", vercelScope]);
    const output = `${stdout}\n${stderr}`;

    for (const key of requiredProductionEnv) {
      if (hasProductionEnv(output, key)) {
        pass("Vercel production env", `${key} is present`);
      } else if (key === "NEXT_PUBLIC_SITE_URL") {
        fail(
          "Vercel production env",
          `${key} is missing; set it after DNS and Supabase Auth callbacks are ready`,
        );
      } else {
        fail("Vercel production env", `${key} is missing`);
      }
    }
  } catch (error) {
    warn(
      "Vercel production env",
      `could not run vercel env ls; install/login to Vercel CLI to verify env names (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

async function main() {
  console.log("Sticky launch readiness");
  console.log(`Production URL: ${productionUrl}`);
  console.log(`Custom domain: ${customDomain}`);
  console.log(`Expected A record: ${expectedARecord}`);
  console.log(`Vercel scope: ${vercelScope}`);
  console.log("");

  const normalizedProductionUrl = normalizeBaseUrl(productionUrl);

  if (!normalizedProductionUrl) {
    fail("production URL", `${productionUrl} is not a valid URL`);
  } else {
    await checkRoot(normalizedProductionUrl, "production");
    await checkRobots(normalizedProductionUrl);
    await checkManifest(normalizedProductionUrl);
    await checkCronGuard(normalizedProductionUrl);
  }

  const dnsReady = await checkDns();

  if (dnsReady) {
    await checkRoot(`https://${customDomain}`, "custom domain");
  }

  await checkVercelEnv();

  const failCount = results.filter((result) => result.status === "fail").length;
  const warnCount = results.filter((result) => result.status === "warn").length;
  const passCount = results.filter((result) => result.status === "pass").length;

  console.log("");
  console.log(`Summary: ${passCount} passed, ${warnCount} warnings, ${failCount} failed`);

  if (failCount > 0) {
    console.log("Launch readiness is blocked by the failed checks above.");
    process.exitCode = 1;
  } else {
    console.log("Launch readiness checks passed.");
  }
}

await main();
