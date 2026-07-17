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
const recurrenceCronPath = process.env.STICKY_CRON_PATH ?? "/api/recurrence/catch-up";
const recurrenceCronSchedule = process.env.STICKY_CRON_SCHEDULE ?? "15 11 * * *";
const deploymentLogWindow = process.env.STICKY_LOG_WINDOW ?? "30m";
const supabaseProjectRef = process.env.SUPABASE_PROJECT_REF ?? "sqskfdcwfwywjoobbpos";
const supabaseAuthSiteUrl = process.env.SUPABASE_AUTH_SITE_URL ?? null;
let productionDeploymentOrigin = null;
let vercelProjectMetadataPromise = null;

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
    `https://${customDomain}/auth/callback`,
  ].filter(Boolean);
}

function redirectUrlIsAllowed(redirectUrl, allowedUrls) {
  if (allowedUrls.has(redirectUrl)) {
    return true;
  }

  try {
    const { origin } = new URL(redirectUrl);
    return allowedUrls.has(`${origin}/**`) || allowedUrls.has(`${origin}/*`);
  } catch {
    return false;
  }
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

async function runGit(args) {
  return execFileAsync("git", args, {
    timeout: 10_000,
    windowsHide: true,
  });
}

async function getVercelProjectMetadata() {
  vercelProjectMetadataPromise ??= runVercel([
    "api",
    `/v9/projects/${vercelProjectId}`,
    "--scope",
    vercelScope,
    "--raw",
  ]).then(({ stdout }) => JSON.parse(stdout));

  return vercelProjectMetadataPromise;
}

function formatVercelGitLink(link) {
  const provider = typeof link.type === "string" ? link.type : "git provider";
  const org = typeof link.org === "string" ? link.org : null;
  const repo = typeof link.repo === "string" ? link.repo : null;
  const branch = typeof link.productionBranch === "string" ? link.productionBranch : null;

  return [
    provider,
    org && repo ? `${org}/${repo}` : repo,
    branch ? `production branch ${branch}` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

function formatDeploymentProtection(value) {
  if (!value || typeof value !== "object") {
    return String(value ?? "unknown");
  }

  return Object.entries(value)
    .map(([key, entry]) => `${key}=${String(entry)}`)
    .join(", ");
}

function parseJsonLogLines(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"))
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function checkWorkflow(path, pattern, label, detail) {
  try {
    const workflow = await readFile(path, "utf8");

    if (pattern.test(workflow)) {
      pass(label, detail);
    } else {
      fail(label, `${path} does not include the expected command`);
    }
  } catch (error) {
    fail(label, error instanceof Error ? error.message : String(error));
  }
}

async function checkSourceControlReadiness() {
  await checkWorkflow(
    ".github/workflows/verify.yml",
    /name:\s+Verify[\s\S]*npm\s+run\s+verify/i,
    "CI workflow",
    ".github/workflows/verify.yml runs npm run verify",
  );
  await checkWorkflow(
    ".github/workflows/production-smoke.yml",
    /name:\s+Production Smoke[\s\S]*npm\s+run\s+test:production-smoke/i,
    "Production smoke workflow",
    ".github/workflows/production-smoke.yml runs npm run test:production-smoke",
  );

  try {
    const { stdout } = await runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
    const branch = stdout.trim();

    if (branch === "main") {
      pass("Git release branch", "local checkout is on main");
    } else {
      warn("Git release branch", `local checkout is on ${branch || "unknown"}, expected main for release`);
    }
  } catch (error) {
    warn("Git release branch", `could not inspect local branch (${error instanceof Error ? error.message : String(error)})`);
  }

  try {
    const { stdout } = await runGit(["remote", "get-url", "origin"]);
    const origin = stdout.trim();

    if (!origin) {
      warn("Git origin remote", "origin is empty; connect a GitHub remote before relying on CI or preview env vars");
    } else if (/github\.com[:/]/i.test(origin)) {
      pass("Git origin remote", `origin points to ${origin}`);
    } else {
      warn("Git origin remote", `origin points to ${origin}; connect GitHub/Vercel Git integration before preview release`);
    }
  } catch {
    warn("Git origin remote", "no origin remote configured; connect GitHub and Vercel Git integration before preview release");
  }

  try {
    const project = await getVercelProjectMetadata();

    if (project.link && typeof project.link === "object") {
      pass("Vercel Git integration", formatVercelGitLink(project.link));
    } else {
      warn(
        "Vercel Git integration",
        "project has no connected Git repository; preview deployments and preview-scoped env vars still need Vercel Git setup",
      );
    }
  } catch (error) {
    warn(
      "Vercel Git integration",
      `could not inspect project Git link (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

async function checkDeploymentProtection() {
  try {
    const project = await getVercelProjectMetadata();

    if (project.ssoProtection == null) {
      pass("Vercel deployment protection", "Deployment Protection is disabled for public production smoke");
    } else {
      fail(
        "Vercel deployment protection",
        `Deployment Protection is enabled (${formatDeploymentProtection(project.ssoProtection)})`,
      );
    }
  } catch (error) {
    warn(
      "Vercel deployment protection",
      `could not inspect project protection settings (${error instanceof Error ? error.message : String(error)})`,
    );
  }
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

async function checkDeploymentErrorLogs() {
  try {
    const project = await getVercelProjectMetadata();
    const deploymentId = project.targets?.production?.id ?? project.crons?.deploymentId;

    if (!deploymentId) {
      warn("Vercel runtime error logs", "could not identify the current production deployment id");
      return;
    }

    const { stdout, stderr } = await runVercel([
      "logs",
      "--deployment",
      deploymentId,
      "--since",
      deploymentLogWindow,
      "--level",
      "error",
      "--json",
      "--no-follow",
      "--scope",
      vercelScope,
    ]);
    const logEntries = parseJsonLogLines(`${stdout}\n${stderr}`);

    if (logEntries.length === 0) {
      pass("Vercel runtime error logs", `no error logs for ${deploymentId} in the last ${deploymentLogWindow}`);
    } else {
      fail("Vercel runtime error logs", `${logEntries.length} error log entr${logEntries.length === 1 ? "y" : "ies"} found for ${deploymentId}`);
    }
  } catch (error) {
    warn(
      "Vercel runtime error logs",
      `could not query recent production errors (${error instanceof Error ? error.message : String(error)})`,
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
    const { response } = await fetchText(recurrenceCronPath, origin);

    if (response.status === 401 || response.status === 503) {
      pass("cron guard", `${recurrenceCronPath} refused unauthenticated request with ${response.status}`);
    } else {
      fail("cron guard", `${recurrenceCronPath} returned ${response.status}; expected 401 or 503`);
    }
  } catch (error) {
    fail("cron guard", error instanceof Error ? error.message : String(error));
  }
}

async function checkVercelCronConfig() {
  try {
    const config = JSON.parse(await readFile("vercel.json", "utf8"));
    const crons = Array.isArray(config.crons) ? config.crons : [];
    const cron = crons.find((entry) => entry?.path === recurrenceCronPath);

    if (cron?.schedule === recurrenceCronSchedule) {
      pass("Vercel cron config", `vercel.json schedules ${recurrenceCronPath} at ${recurrenceCronSchedule}`);
    } else if (cron) {
      fail("Vercel cron config", `${recurrenceCronPath} schedule is ${cron.schedule || "missing"}, expected ${recurrenceCronSchedule}`);
    } else {
      fail("Vercel cron config", `vercel.json does not schedule ${recurrenceCronPath}`);
    }
  } catch (error) {
    fail("Vercel cron config", error instanceof Error ? error.message : String(error));
  }

  try {
    const project = await getVercelProjectMetadata();
    const definitions = Array.isArray(project.crons?.definitions) ? project.crons.definitions : [];
    const cron = definitions.find((entry) => entry?.path === recurrenceCronPath);

    if (cron?.schedule === recurrenceCronSchedule) {
      pass("Vercel cron deployment", `project schedules ${recurrenceCronPath} at ${recurrenceCronSchedule}`);
    } else if (cron) {
      fail("Vercel cron deployment", `${recurrenceCronPath} schedule is ${cron.schedule || "missing"}, expected ${recurrenceCronSchedule}`);
    } else {
      fail("Vercel cron deployment", `project has no deployed cron for ${recurrenceCronPath}`);
    }
  } catch (error) {
    warn(
      "Vercel cron deployment",
      `could not inspect deployed cron definitions (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

async function checkVercelEnv() {
  const requiredProductionEnv = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_STICKY_DEMO_MODE",
    "NEXT_PUBLIC_SITE_URL",
    "CRON_SECRET",
    "SUPABASE_SECRET_KEY",
    "WORKFLOW_ENABLED",
    "INTEGRATION_ENCRYPTION_KEY",
    "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
    "VAPID_PRIVATE_KEY",
    "VAPID_SUBJECT",
  ];
  const optionalProviderEnv = [
    ["POKE_API_KEY", "Poke reminder delivery is disconnected"],
    ["GOOGLE_CLIENT_ID", "Google Tasks sync is disconnected"],
    ["GOOGLE_CLIENT_SECRET", "Google Tasks sync is disconnected"],
    ["GOOGLE_REDIRECT_URI", "Google Tasks sync is disconnected"],
  ];

  try {
    const { stdout } = await runVercel([
      "api",
      `/v10/projects/${vercelProjectId}/env`,
      "--scope",
      vercelScope,
      "--raw",
    ]);
    const payload = JSON.parse(stdout);
    const productionKeys = new Set(
      (Array.isArray(payload.envs) ? payload.envs : [])
        .filter((entry) => Array.isArray(entry.target) && entry.target.includes("production"))
        .map((entry) => entry.key),
    );

    for (const key of requiredProductionEnv) {
      if (productionKeys.has(key)) {
        pass("Vercel production env", `${key} is present`);
      } else {
        fail("Vercel production env", `${key} is missing`);
      }
    }

    for (const [key, consequence] of optionalProviderEnv) {
      if (productionKeys.has(key)) {
        pass("Vercel provider env", `${key} is present`);
      } else {
        warn("Vercel provider env", `${key} is missing; ${consequence}`);
      }
    }
  } catch (error) {
    warn(
      "Vercel production env",
      `could not inspect project environment names (${error instanceof Error ? error.message : String(error)})`,
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
    const magicLinkTemplate = findConfigValue(config, [
      "mailer_templates_magic_link_content",
    ]);
    const redirectUrls = new Set(asArray(redirectListValue));

    if (supabaseAuthSiteUrl && String(siteUrlValue ?? "") === supabaseAuthSiteUrl) {
      pass("Supabase Auth site URL", `site URL is ${supabaseAuthSiteUrl}`);
    } else if (supabaseAuthSiteUrl) {
      fail(
        "Supabase Auth site URL",
        `site URL is ${siteUrlValue ? String(siteUrlValue) : "missing"}, expected ${supabaseAuthSiteUrl}`,
      );
    } else if (siteUrlValue) {
      pass(
        "Supabase Auth site URL",
        `shared project default is ${String(siteUrlValue)}; Sticky uses its explicit redirect URL`,
      );
    } else {
      fail("Supabase Auth site URL", "shared project site URL is missing");
    }

    if (!redirectUrls.size) {
      fail("Supabase Auth redirect URLs", "redirect allow list was missing from Management API response");
      return;
    }

    for (const redirectUrl of getSupabaseAuthRedirectUrls()) {
      if (redirectUrlIsAllowed(redirectUrl, redirectUrls)) {
        pass("Supabase Auth redirect URL", `${redirectUrl} is allowed`);
      } else {
        fail("Supabase Auth redirect URL", `${redirectUrl} is missing`);
      }
    }

    const magicLinkContent = String(magicLinkTemplate ?? "");
    if (
      magicLinkContent.includes("{{ .RedirectTo }}") &&
      magicLinkContent.includes("{{ .TokenHash }}") &&
      magicLinkContent.includes("type=magiclink")
    ) {
      pass("Supabase Auth magic link", "template honors Sticky's explicit callback URL");
    } else {
      fail("Supabase Auth magic link", "template does not honor Sticky's explicit callback URL");
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
    await checkSourceControlReadiness();
    await checkLocalVercelLink();
    await checkDeploymentProtection();
    await checkDeploymentInspect(normalizedProductionUrl);
    await checkDeploymentErrorLogs();
    await checkRoot(normalizedProductionUrl, "production");
    await checkRobots(normalizedProductionUrl);
    await checkManifest(normalizedProductionUrl);
    await checkCronGuard(normalizedProductionUrl);
    await checkVercelCronConfig();
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
