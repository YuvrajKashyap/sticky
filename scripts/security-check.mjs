import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const scanExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".env", ".example"]);
const skipDirectories = new Set([
  ".git",
  ".next",
  "node_modules",
  "playwright-report",
  "test-results",
]);

const serverOnlyRelPaths = new Set([
  "src/app/api/recurrence/catch-up/route.ts",
  "src/lib/sticky/server.ts",
  "src/lib/supabase/admin.ts",
  "src/lib/supabase/proxy.ts",
  "src/lib/supabase/server.ts",
  "src/proxy.ts",
]);

const secretReferencePatterns = [
  {
    label: "server-only Supabase secret env reference",
    pattern: /\bSUPABASE_(?:SECRET|SERVICE_ROLE)_KEY\b/g,
  },
  {
    label: "cron secret env reference",
    pattern: /\bCRON_SECRET\b/g,
  },
  {
    label: "literal Supabase secret key",
    pattern: /\bsb_secret_[A-Za-z0-9_-]{8,}\b/g,
  },
  {
    label: "service-role marker",
    pattern: /\bservice_role\b/g,
  },
];

const publicSecretEnvPattern =
  /\bNEXT_PUBLIC_[A-Z0-9_]*(?:SECRET|SERVICE_ROLE|PRIVATE|TOKEN|CRON)[A-Z0-9_]*\b/g;
const realSecretValuePattern = /\b(?:sb_secret_[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})\b/g;

const failures = [];
const passes = [];

function rel(filePath) {
  return path.relative(root, filePath).replace(/\\/g, "/");
}

function notePass(message) {
  passes.push(message);
  console.log(`PASS ${message}`);
}

function fail(message) {
  failures.push(message);
  console.log(`FAIL ${message}`);
}

async function walk(entryPath) {
  const entryStat = await stat(entryPath);

  if (entryStat.isDirectory()) {
    if (skipDirectories.has(path.basename(entryPath))) {
      return [];
    }

    const entries = await readdir(entryPath);
    const nested = await Promise.all(entries.map((entry) => walk(path.join(entryPath, entry))));

    return nested.flat();
  }

  return [entryPath];
}

function hasUseClientDirective(contents) {
  return /^\s*(?:"use client"|'use client')\s*;?/.test(contents);
}

function parseImports(contents) {
  const imports = new Set();
  const patterns = [
    /(?:import|export)\s+(?:type\s+)?[\s\S]*?\s+from\s+["']([^"']+)["']/g,
    /import\s*["']([^"']+)["']/g,
    /import\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of contents.matchAll(pattern)) {
      imports.add(match[1]);
    }
  }

  return [...imports];
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveLocalImport(fromFile, specifier) {
  if (!specifier.startsWith(".") && !specifier.startsWith("@/")) {
    return null;
  }

  const basePath = specifier.startsWith("@/")
    ? path.join(root, "src", specifier.slice(2))
    : path.resolve(path.dirname(fromFile), specifier);
  const candidates = [basePath];

  for (const extension of sourceExtensions) {
    candidates.push(`${basePath}${extension}`);
  }

  for (const extension of sourceExtensions) {
    candidates.push(path.join(basePath, `index${extension}`));
  }

  for (const candidate of candidates) {
    if ((await pathExists(candidate)) && sourceExtensions.has(path.extname(candidate))) {
      return candidate;
    }
  }

  return null;
}

function isServerOnly(filePath) {
  const relativePath = rel(filePath);

  return (
    serverOnlyRelPaths.has(relativePath) ||
    relativePath.startsWith("src/app/api/") ||
    /(?:^|\/)(?:admin|server|proxy)\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(relativePath)
  );
}

async function buildClientGraph(sourceFiles) {
  const fileContents = new Map();

  await Promise.all(
    sourceFiles.map(async (filePath) => {
      fileContents.set(filePath, await readFile(filePath, "utf8"));
    }),
  );

  const clientRoots = sourceFiles.filter((filePath) => hasUseClientDirective(fileContents.get(filePath) ?? ""));
  const seen = new Set();
  const stack = [...clientRoots];

  while (stack.length) {
    const filePath = stack.pop();

    if (!filePath || seen.has(filePath)) {
      continue;
    }

    seen.add(filePath);
    const contents = fileContents.get(filePath) ?? "";

    for (const specifier of parseImports(contents)) {
      const resolved = await resolveLocalImport(filePath, specifier);

      if (resolved && !seen.has(resolved)) {
        stack.push(resolved);
      }
    }
  }

  return { clientRoots, clientReachable: [...seen], fileContents };
}

function checkSecretReferences(clientReachable, fileContents) {
  let foundSecretReference = false;

  for (const filePath of clientReachable) {
    const contents = fileContents.get(filePath) ?? "";

    for (const { label, pattern } of secretReferencePatterns) {
      const matches = [...contents.matchAll(pattern)];

      for (const match of matches) {
        foundSecretReference = true;
        fail(`${rel(filePath)} contains ${label}: ${match[0]}`);
      }
    }
  }

  if (!foundSecretReference) {
    notePass("client-reachable modules do not reference server-only Supabase or cron secrets");
  }
}

function checkServerOnlyImports(clientReachable) {
  const badImports = clientReachable.filter(isServerOnly);

  if (!badImports.length) {
    notePass("client import graph does not reach server-only modules");
    return;
  }

  for (const filePath of badImports) {
    fail(`client import graph reaches server-only module ${rel(filePath)}`);
  }
}

async function checkPublicSurfaces(files) {
  let foundPublicSecret = false;

  for (const filePath of files) {
    const relativePath = rel(filePath);
    const extension = path.extname(filePath);
    const shouldScan =
      relativePath.startsWith("public/") ||
      relativePath === ".env.example" ||
      relativePath === "package.json" ||
      relativePath === "vercel.json" ||
      relativePath === "next.config.ts";

    if (!shouldScan || !scanExtensions.has(extension || path.extname(relativePath.replace(".env", ".env.example")))) {
      continue;
    }

    const contents = await readFile(filePath, "utf8");
    const publicSecretEnvMatches = [...contents.matchAll(publicSecretEnvPattern)];
    const realSecretValueMatches = [...contents.matchAll(realSecretValuePattern)];

    for (const match of publicSecretEnvMatches) {
      foundPublicSecret = true;
      fail(`${relativePath} contains forbidden public secret env name: ${match[0]}`);
    }

    for (const match of realSecretValueMatches) {
      foundPublicSecret = true;
      fail(`${relativePath} appears to contain a real secret value: ${match[0].slice(0, 12)}...`);
    }
  }

  if (!foundPublicSecret) {
    notePass("public/config surfaces do not contain public secret env names or literal secret values");
  }
}

async function main() {
  console.log("Sticky security check");

  const files = await walk(root);
  const sourceFiles = files.filter((filePath) => sourceExtensions.has(path.extname(filePath)) && rel(filePath).startsWith("src/"));
  const { clientRoots, clientReachable, fileContents } = await buildClientGraph(sourceFiles);

  console.log(`Client entrypoints: ${clientRoots.map(rel).join(", ") || "none"}`);
  checkServerOnlyImports(clientReachable);
  checkSecretReferences(clientReachable, fileContents);
  await checkPublicSurfaces(files);

  console.log("");
  console.log(`Summary: ${passes.length} passed, ${failures.length} failed`);

  if (failures.length) {
    process.exitCode = 1;
  }
}

await main();
