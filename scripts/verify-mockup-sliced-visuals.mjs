import { chromium } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE_URL = process.env.STICKY_VISUAL_BASE_URL ?? "http://127.0.0.1:3100";
const OUT_DIR = path.join(ROOT, "test-results", "mockup-sliced");
const VIEWPORT = { width: 1672, height: 941 };

const MODES = [
  {
    name: "pad-light",
    board: "pad",
    tone: "light",
    reference: "assets/mockups/pad_light_mockup.png",
    expectedColumns: [
      { x: 260, y: 48, width: 266, height: 467 },
      { x: 532, y: 48, width: 298, height: 845 },
      { x: 838, y: 48, width: 257, height: 302 },
      { x: 1102, y: 55, width: 271, height: 840 },
      { x: 1388, y: 58, width: 282, height: 844 },
    ],
    topbar: { x: 1418, y: 8, width: 242, height: 56 },
  },
  {
    name: "pad-dark",
    board: "pad",
    tone: "dark",
    reference: "assets/mockups/pad_dark_mockup.png",
    expectedColumns: [
      { x: 260, y: 48, width: 266, height: 467 },
      { x: 532, y: 48, width: 298, height: 845 },
      { x: 838, y: 48, width: 257, height: 302 },
      { x: 1102, y: 55, width: 271, height: 840 },
      { x: 1388, y: 58, width: 282, height: 844 },
    ],
    topbar: { x: 1418, y: 8, width: 242, height: 56 },
  },
  {
    name: "board-light",
    board: "wood",
    tone: "light",
    reference: "assets/mockups/board_light_mockup.png",
    expectedColumns: [
      { x: 260, y: 64, width: 255, height: 831 },
      { x: 532, y: 64, width: 266, height: 831 },
      { x: 815, y: 64, width: 233, height: 831 },
      { x: 1065, y: 64, width: 263, height: 831 },
      { x: 1350, y: 64, width: 290, height: 831 },
    ],
    topbar: { x: 1442, y: 8, width: 218, height: 50 },
  },
  {
    name: "board-dark",
    board: "wood",
    tone: "dark",
    reference: "assets/mockups/board_dark_mockup.png",
    expectedColumns: [
      { x: 260, y: 64, width: 255, height: 831 },
      { x: 532, y: 64, width: 266, height: 831 },
      { x: 815, y: 64, width: 233, height: 831 },
      { x: 1065, y: 64, width: 263, height: 831 },
      { x: 1350, y: 64, width: 290, height: 831 },
    ],
    topbar: { x: 1442, y: 8, width: 218, height: 50 },
  },
];

function roundRect(rect) {
  if (!rect) {
    return null;
  }

  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

function rectDelta(actual, expected) {
  if (!actual || !expected) {
    return null;
  }

  return {
    dx: Math.round(actual.x - expected.x),
    dy: Math.round(actual.y - expected.y),
    dw: Math.round(actual.width - expected.width),
    dh: Math.round(actual.height - expected.height),
  };
}

function maxAbsDelta(items) {
  return Math.max(
    0,
    ...items
      .filter(Boolean)
      .flatMap((item) => [item.dx, item.dy, item.dw, item.dh].map((value) => Math.abs(value))),
  );
}

function runPixelCompare(mode, screenshotPath) {
  const diffPath = path.join(OUT_DIR, `${mode.name}.diff.png`);
  const result = spawnSync(
    "python",
    [
      path.join(ROOT, "scripts", "compare-mockup-screenshots.py"),
      path.join(ROOT, mode.reference),
      screenshotPath,
      diffPath,
    ],
    { cwd: ROOT, encoding: "utf8" },
  );

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `pixel comparison failed for ${mode.name}`);
  }

  return JSON.parse(result.stdout);
}

async function captureMode(browser, mode) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  await context.addInitScript(() => window.localStorage.clear());
  const page = await context.newPage();
  const consoleErrors = [];

  page.on("console", (message) => {
    if (message.type() !== "error") {
      return;
    }
    const text = message.text();
    if (/hot|hmr|fast refresh/i.test(text)) {
      return;
    }
    consoleErrors.push(text);
  });

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".sticky-app");
  await page.evaluate(({ board, tone }) => {
    const app = document.querySelector(".sticky-app");
    app?.classList.remove("tone-light", "tone-dark", "board-pad", "board-wood");
    app?.classList.add(`tone-${tone}`, `board-${board}`);
    document.querySelectorAll("details[open]").forEach((details) => details.removeAttribute("open"));
  }, mode);
  await page.waitForTimeout(450);

  const screenshotPath = path.join(OUT_DIR, `${mode.name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });

  const geometry = await page.evaluate(() => {
    const getRect = (element) => {
      if (!element) {
        return null;
      }
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const columns = Array.from(document.querySelectorAll(".board-column")).slice(0, 5);
    return {
      sidebar: getRect(document.querySelector(".list-rail")),
      topbar: getRect(document.querySelector(".workspace-tools")),
      columns: columns.map((column) => getRect(column)),
      headers: columns.map((column) => getRect(column.querySelector(".column-header"))),
      quickRows: columns.map((column) => getRect(column.querySelector(".board-quick-capture, .board-add-task"))),
      firstNotes: columns.map((column) => getRect(column.querySelector(".task-card, .plate-group"))),
      pins: columns.map((column) => getRect(column.querySelector(".column-pin"))),
      bodyOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  const rounded = {
    sidebar: roundRect(geometry.sidebar),
    topbar: roundRect(geometry.topbar),
    columns: geometry.columns.map(roundRect),
    headers: geometry.headers.map(roundRect),
    quickRows: geometry.quickRows.map(roundRect),
    firstNotes: geometry.firstNotes.map(roundRect),
    pins: geometry.pins.map(roundRect),
    bodyOverflowX: Math.round(geometry.bodyOverflowX),
  };

  const columnDeltas = rounded.columns.map((rect, index) => rectDelta(rect, mode.expectedColumns[index]));
  const topbarDelta = rectDelta(rounded.topbar, mode.topbar);
  const pixel = runPixelCompare(mode, screenshotPath);

  await context.close();
  return {
    mode: mode.name,
    screenshot: screenshotPath,
    pixel,
    geometry: rounded,
    deltas: {
      topbar: topbarDelta,
      columns: columnDeltas,
      maxColumnDelta: maxAbsDelta(columnDeltas),
      maxTopbarDelta: maxAbsDelta([topbarDelta]),
    },
    consoleErrors,
  };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const results = [];

  try {
    for (const mode of MODES) {
      results.push(await captureMode(browser, mode));
    }
  } finally {
    await browser.close();
  }

  for (const result of results) {
    console.log(
      [
        result.mode,
        `mean=${result.pixel.meanAbsDelta}`,
        `rms=${result.pixel.rmsDelta}`,
        `edge=${result.pixel.edgeDelta}`,
        `maxColumnDelta=${result.deltas.maxColumnDelta}px`,
        `maxTopbarDelta=${result.deltas.maxTopbarDelta}px`,
        `overflowX=${result.geometry.bodyOverflowX}px`,
        `consoleErrors=${result.consoleErrors.length}`,
      ].join(" | "),
    );
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
