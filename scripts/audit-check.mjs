import { spawnSync } from "node:child_process";

const severityRank = {
  info: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
};

const minimumSeverity = "moderate";
const allowedAdvisories = new Map([
  [
    "1124334",
    {
      id: "GHSA-mh99-v99m-4gvg",
      reason:
        "Latest supported ESLint, Next.js lint plugins, and Workflow CLI releases still depend on older minimatch lines. Forcing brace-expansion 5 breaks their CommonJS API at runtime. These packages only receive trusted repository glob patterns in Sticky.",
      reviewBy: "2026-09-30",
    },
  ],
]);

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error("FAIL dependency audit could not locate the npm CLI.");
  process.exit(1);
}

const auditResult = spawnSync(
  process.execPath,
  [npmCli, "audit", "--json", `--audit-level=${minimumSeverity}`],
  {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  },
);

if (auditResult.error) {
  console.error(`FAIL dependency audit could not run: ${auditResult.error.message}`);
  process.exit(1);
}

let audit;
try {
  audit = JSON.parse(auditResult.stdout);
} catch {
  console.error("FAIL dependency audit did not return valid JSON.");
  if (auditResult.stderr) console.error(auditResult.stderr.trim());
  process.exit(1);
}

if (audit.error) {
  console.error(`FAIL dependency audit: ${audit.error.summary ?? audit.error.message ?? "npm audit failed"}`);
  process.exit(1);
}

const vulnerabilities = audit.vulnerabilities ?? {};

function exceptionIsActive(exception) {
  return Date.now() <= Date.parse(`${exception.reviewBy}T23:59:59Z`);
}

function advisorySources(packageName, visited = new Set()) {
  if (visited.has(packageName)) return new Set();
  visited.add(packageName);

  const entry = vulnerabilities[packageName];
  if (!entry) return new Set();

  const sources = new Set();
  for (const via of entry.via ?? []) {
    if (typeof via === "string") {
      for (const source of advisorySources(via, visited)) sources.add(source);
    } else if (via?.source !== undefined) {
      sources.add(String(via.source));
    }
  }
  return sources;
}

const blocked = [];
const allowed = [];

for (const [packageName, entry] of Object.entries(vulnerabilities)) {
  if ((severityRank[entry.severity] ?? -1) < severityRank[minimumSeverity]) continue;

  const sources = advisorySources(packageName);
  const unapprovedSources = [...sources].filter((source) => {
    const exception = allowedAdvisories.get(source);
    return !exception || !exceptionIsActive(exception);
  });
  if (sources.size === 0 || unapprovedSources.length > 0) {
    blocked.push({
      packageName,
      severity: entry.severity,
      sources: unapprovedSources.length > 0 ? unapprovedSources : ["unknown"],
    });
  } else {
    allowed.push({ packageName, severity: entry.severity, sources: [...sources] });
  }
}

console.log("Sticky dependency audit");

if (blocked.length > 0) {
  for (const finding of blocked) {
    console.error(
      `FAIL ${finding.packageName} (${finding.severity}) has unapproved advisory source(s): ${finding.sources.join(", ")}`,
    );
  }
  console.error(`Summary: ${blocked.length} unapproved finding(s) at ${minimumSeverity} severity or higher.`);
  process.exit(1);
}

for (const [source, exception] of allowedAdvisories) {
  if (!exceptionIsActive(exception)) continue;
  const affectedPackages = allowed
    .filter((finding) => finding.sources.includes(source))
    .map((finding) => finding.packageName)
    .sort();
  if (affectedPackages.length === 0) continue;

  console.log(
    `ALLOW ${exception.id} through ${exception.reviewBy}: ${exception.reason}`,
  );
  console.log(`      Affected dependency chain: ${affectedPackages.join(", ")}`);
}

console.log(
  `PASS no unapproved dependency advisories at ${minimumSeverity} severity or higher.`,
);
