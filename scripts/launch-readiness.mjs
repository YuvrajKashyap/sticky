import { execFile } from "node:child_process";
import { resolve4 } from "node:dns/promises";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const productionUrl = process.env.STICKY_PRODUCTION_URL ?? "https://sticky-green.vercel.app";
const customDomain = process.env.STICKY_DOMAIN ?? "sticky.yuvrajkashyap.com";
const expectedARecord = process.env.STICKY_EXPECTED_A_RECORD ?? "76.76.21.21";
const vercelScope = process.env.VERCEL_SCOPE ?? "yuvraj-kashyaps-projects";
const vercelProject = process.env.VERCEL_PROJECT ?? "sticky";
const vercelProjectId = process.env.VERCEL_PROJECT_ID ?? "prj_nfiyWrEfak04ah1pIqvFqcytQcmh";
const supabaseProjectRef = process.env.SUPABASE_PROJECT_REF ?? "sqskfdcwfwywjoobbpos";
const supabaseAuthSiteUrl =
  process.env.SUPABASE_AUTH_SITE_URL ?? `https://${customDomain}`;
let productionDeploymentOrigin = null;

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

function asArray(value) {
  if (Array.isArray(value)) {
    return value.flatMap(asArray);
  }

  if (typeof value === "string") {
    return value
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function getSupabaseAuthRedirectUrls() {
  const configured = asArray(process.env.SUPABASE_AUTH_REDIRECT_URLS);

  if (configured.length) {
    return configured;
  }

  return [
    "http://localhost:3000/auth/callback",
    "http://localhost:3100/auth/callback",
    `https://${customDomain}/auth/callback`,
    "https://sticky-green.vercel.app/auth/callback",
    "https://sticky-yuvraj-kashyaps-projects.vercel.app/auth/callback",
    productionDeploymentOrigin ? `${productionDeploymentOrigin}/auth/callback` : null,
  ].filter(Boolean);
}

function findConfigValue(value, acceptedKeys) {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (acceptedKeys.includes(key.toLowerCase())) {
      return entry;
    }
  }

  for (const entry of Object.values(value)) {
    const found = findConfigValue(entry, acceptedKeys);

    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}

function hasLineValue(output, label, expected) {
  const matcher = new RegExp(`^\\s*${label}\\s+.*${expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "im");

  return matcher.test(output);
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

async function checkLocalVercelLink() {
  try {
    const projectFile = await readFile(".vercel/project.json", "utf8");
    const project = JSON.parse(projectFile);

    if (project.projectName === vercelProject) {
      pass("Vercel local link", `.vercel/project.json is linked to ${vercelProject}`);
    } else {
      fail("Vercel local link", `linked project is ${project.projectName || "missing"}, expected ${vercelProject}`);
    }

    if (project.projectId === vercelProjectId) {
      pass("Vercel project id", `.vercel/project.json matches ${vercelProjectId}`);
    } else {
      fail("Vercel project id", `project id is ${project.projectId || "missing"}, expected ${vercelProjectId}`);
    }
  } catch (error) {
    fail("Vercel local link", error instanceof Error ? error.message : String(error));
  }
}

async function checkDeploymentInspect(origin) {
  try {
    const { stdout, stderr } = await runVercel(["inspect", origin, "--scope", vercelScope]);
    const output = `${stdout}\n${stderr}`;
    const deploymentUrl = output.match(/^\s*url\s+(https:\/\/\S+)/im)?.[1];

    if (deploymentUrl) {
      productionDeploymentOrigin = new URL(deploymentUrl).origin;
      pass("Vercel deployment URL", `${productionDeploymentOrigin} is the current generated production URL`);
    } else {
      warn("Vercel deployment URL", "could not parse the generated production URL from vercel inspect");
    }

    if (hasLineValue(output, "name", vercelProject)) {
      pass("Vercel deployment project", `deployment belongs to ${vercelProject}`);
    } else {
      fail("Vercel deployment project", `deployment inspect did not show project ${vercelProject}`);
    }

    if (hasLineValue(output, "target", "production")) {
      pass("Vercel deployment target", "deployment target is production");
    } else {
      fail("Vercel deployment target", "deployment target is not production");
    }

    if (/^\s*status\s+.*Ready/im.test(output)) {
      pass("Vercel deployment status", "deployment is Ready");
    } else {
      fail("Vercel deployment status", "deployment is not Ready");
    }

    if (output.includes(new URL(origin).hostname)) {
      pass("Vercel deployment alias", `${new URL(origin).hostname} is an alias`);
    } else {
      fail("Vercel deployment alias", `${new URL(origin).hostname} was not listed as an alias`);
    }

    if (output.includes(customDomain)) {
      pass("Vercel custom-domain alias", `${customDomain} is attached as an alias`);
    } else {
      fail("Vercel custom-domain alias", `${customDomain} was not listed as an alias`);
    }
  } catch (error) {
    fail(
      "Vercel deployment inspect",
      `could not inspect ${origin} (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

async function checkDomainInspect() {
  try {
    const { stdout, stderr } = await runVercel(["domains", "inspect", customDomain, "--scope", vercelScope]);
    const output = `${stdout}\n${stderr}`;

    if (output.includes(vercelProject) && output.includes(customDomain)) {
      pass("Vercel domain attachment", `${customDomain} is attached to ${vercelProject}`);
    } else {
      fail("Vercel domain attachment", `${customDomain} is not attached to ${vercelProject}`);
    }

    if (/not configured properly/i.test(output)) {
      fail("Vercel domain configuration", `Vercel still requires A ${customDomain} ${expectedARecord}`);
    } else {
      pass("Vercel domain configuration", "Vercel reports the domain as configured");
    }
  } catch (error) {
    fail(
      "Vercel domain inspect",
      `could not inspect ${customDomain} (${error instanceof Error ? error.message : String(error)})`,
    );
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

async function checkSupabaseAuthConfig() {
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;

  if (!accessToken) {
    warn(
      "Supabase Auth config",
      "SUPABASE_ACCESS_TOKEN is not set; skipped Management API callback verification",
    );
    return;
  }

  try {
    const response = await fetch(`https://api.supabase.com/v1/projects/${supabaseProjectRef}/config/auth`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      fail("Supabase Auth config", `Management API returned HTTP ${response.status}`);
      return;
    }

    const config = await response.json();
    const siteUrlValue = findConfigValue(config, ["site_url", "siteurl"]);
    const redirectListValue = findConfigValue(config, [
      "uri_allow_list",
      "additional_redirect_urls",
      "redirect_urls",
      "redirect_uris",
    ]);
    const redirectUrls = new Set(asArray(redirectListValue));

    if (String(siteUrlValue ?? "") === supabaseAuthSiteUrl) {
      pass("Supabase Auth site URL", `site URL is ${supabaseAuthSiteUrl}`);
    } else {
      fail(
        "Supabase Auth site URL",
        `site URL is ${siteUrlValue ? String(siteUrlValue) : "missing"}, expected ${supabaseAuthSiteUrl}`,
      );
    }

    if (!redirectUrls.size) {
      fail("Supabase Auth redirect URLs", "redirect allow list was missing from Management API response");
      return;
    }

    for (const redirectUrl of getSupabaseAuthRedirectUrls()) {
      if (redirectUrls.has(redirectUrl)) {
        pass("Supabase Auth redirect URL", `${redirectUrl} is allowed`);
      } else {
        fail("Supabase Auth redirect URL", `${redirectUrl} is missing`);
      }
    }
  } catch (error) {
    fail("Supabase Auth config", error instanceof Error ? error.message : String(error));
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
    await checkLocalVercelLink();
    await checkDeploymentInspect(normalizedProductionUrl);
    await checkRoot(normalizedProductionUrl, "production");
    await checkRobots(normalizedProductionUrl);
    await checkManifest(normalizedProductionUrl);
    await checkCronGuard(normalizedProductionUrl);
  }

  const dnsReady = await checkDns();
  await checkDomainInspect();

  if (dnsReady) {
    await checkRoot(`https://${customDomain}`, "custom domain");
  }

  await checkVercelEnv();
  await checkSupabaseAuthConfig();

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
