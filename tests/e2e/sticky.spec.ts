import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  GENERIC_STICKY_ACCESS_MESSAGE,
  GENERIC_STICKY_SAVE_MESSAGE,
  userFacingStickyMessage,
  userFacingStickySaveMessage,
} from "../../src/lib/sticky/messages";

const TEST_CRON_SECRET = process.env.CRON_SECRET ?? "test-cron-secret";

async function expectNoConsoleErrors(page: Page, run: () => Promise<void>) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  await run();
  expect(errors).toEqual([]);
}

async function dragBetween(page: Page, source: Locator, target: Locator) {
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();

  if (!sourceBox || !targetBox) {
    return;
  }

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
    steps: 14,
  });
  await page.mouse.up();
}

async function expectTextBefore(page: Page, selector: string, first: string, second: string) {
  const values = await page.locator(selector).allTextContents();
  const firstIndex = values.findIndex((value) => value.includes(first));
  const secondIndex = values.findIndex((value) => value.includes(second));
  expect(firstIndex).toBeGreaterThanOrEqual(0);
  expect(secondIndex).toBeGreaterThanOrEqual(0);
  expect(firstIndex).toBeLessThan(secondIndex);
}

function localDateKey(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function nextWeekdayKey(day: number) {
  const today = new Date();
  let delta = (day - today.getDay() + 7) % 7;
  if (delta === 0) {
    delta = 7;
  }
  return localDateKey(delta);
}

function shortDateLabel(dateKey: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(`${dateKey}T00:00:00`));
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    .toBe(true);
}

test("connected settings and task reminders stay integrated with the workspace", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open notifications" }).click();
  const connections = page.getByRole("dialog", { name: "Connections and notifications" });
  await expect(connections).toBeVisible();
  await expect(connections.getByText("Google Tasks")).toHaveCount(0);
  await expect(connections.getByText("Poke", { exact: true })).toBeVisible();
  await expect(connections.getByRole("button", { name: "Create private connection" })).toBeVisible();
  await expect(connections.getByText("Web notifications")).toBeVisible();
  await connections.getByRole("button", { name: "Close connections" }).click();

  const firstTask = page.locator("[data-task-id]").first();
  await firstTask.click();
  await expect(page.getByRole("region", { name: "Task reminders" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Push" })).toHaveAttribute("aria-pressed", "true");
  await expectNoHorizontalOverflow(page);
});

test("Hono health and private authentication boundaries are live", async ({ request }) => {
  const health = await request.get("/api/health");
  expect(health.ok()).toBe(true);
  expect(await health.json()).toMatchObject({ data: { status: "ok", service: "sticky-api" }, meta: { requestId: expect.any(String) } });

  const privateResponse = await request.get("/api/v1/lists");
  expect(privateResponse.status()).toBe(401);
  expect(await privateResponse.json()).toMatchObject({ error: { code: "unauthorized", requestId: expect.any(String) } });
});

async function expectDialogBackdropCoversViewport(page: Page) {
  const backdrop = page.locator(".dialog-backdrop");
  await expect(backdrop).toBeVisible();

  const geometry = await backdrop.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);

    return {
      height: rect.height,
      position: style.position,
      width: rect.width,
      x: rect.x,
      y: rect.y,
      zIndex: style.zIndex,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    };
  });

  expect(geometry.position).toBe("fixed");
  expect(geometry.zIndex).toBe("60");
  expect(Math.round(geometry.x)).toBe(0);
  expect(Math.round(geometry.y)).toBe(0);
  expect(geometry.width).toBeGreaterThanOrEqual(geometry.viewportWidth - 1);
  expect(geometry.height).toBeGreaterThanOrEqual(geometry.viewportHeight - 1);
}

async function expectMobileZoomAllowed(page: Page) {
  const viewport = page.locator('meta[name="viewport"]');

  await expect(viewport).toHaveAttribute("content", /width=device-width/);
  await expect(viewport).not.toHaveAttribute("content", /maximum-scale=1|user-scalable=no/i);
}

async function expectSingleLine(locator: Locator) {
  const lineRatio = await locator.evaluate((node) => {
    const lineHeight = Number.parseFloat(window.getComputedStyle(node).lineHeight);
    return node.getBoundingClientRect().height / lineHeight;
  });

  expect(lineRatio).toBeLessThan(1.2);
}

async function expectNoInlineClip(locator: Locator) {
  await expect
    .poll(() => locator.evaluate((node) => node.scrollWidth <= node.clientWidth + 1))
    .toBe(true);
}

async function expectLightText(locator: Locator, minimumLuminance = 0.62) {
  const sample = await locator.first().evaluate((node) => {
    const color = window.getComputedStyle(node).color;

    function parseColor(value: string) {
      const srgb = value.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
      if (srgb) {
        return srgb.slice(1, 4).map((channel) => Number(channel));
      }

      const rgb = value.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
      if (rgb) {
        return rgb.slice(1, 4).map((channel) => Number(channel) / 255);
      }

      return [0, 0, 0];
    }

    function linear(channel: number) {
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    }

    const [r, g, b] = parseColor(color);

    return {
      color,
      luminance: 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b),
    };
  });

  expect(sample.luminance, `${sample.color} should stay readable on dark materials`).toBeGreaterThanOrEqual(
    minimumLuminance,
  );
}

async function columnHeight(locator: Locator) {
  return locator.evaluate((node) => Math.round(node.getBoundingClientRect().height));
}

async function expectProfileSettingsTriggerVisible(page: Page) {
  const trigger = page.getByLabel("Open appearance settings");
  await expect(trigger).toBeVisible();

  const sample = await trigger.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);
    const icon = node.querySelector(".profile-settings-icon");
    const iconRect = icon?.getBoundingClientRect();

    return {
      borderRadius: style.borderRadius,
      color: style.color,
      height: rect.height,
      iconColor: icon ? window.getComputedStyle(icon).color : "missing",
      iconHeight: iconRect?.height ?? 0,
      iconWidth: iconRect?.width ?? 0,
      opacity: style.opacity,
      width: rect.width,
    };
  });

  expect(sample.width).toBeGreaterThanOrEqual(36);
  expect(sample.height).toBeGreaterThanOrEqual(36);
  expect(sample.borderRadius).not.toBe("0px");
  expect(sample.opacity).toBe("1");
  expect(sample.iconWidth).toBeGreaterThanOrEqual(14);
  expect(sample.iconHeight).toBeGreaterThanOrEqual(14);
  expect(sample.iconColor).toBe(sample.color);
}

function quickAddButton(page: Page, listName: string) {
  return page.getByRole("button", { name: `Add task to ${listName}` });
}

async function runCommand(page: Page, query: string) {
  const commandDialog = page.getByRole("dialog", { name: "Command center" });
  if ((await commandDialog.count()) === 0) {
    await page.getByRole("button", { name: "Open command center" }).click({ force: true });
    await page.waitForTimeout(100);
  }
  if ((await commandDialog.count()) === 0) {
    await page.keyboard.press("Control+K");
  }
  const commandSearch = page.getByLabel("Search commands");
  await expect(commandSearch).toBeVisible();
  await commandSearch.fill(query);
  await page.keyboard.press("Enter");
  await expect(commandDialog).toHaveCount(0);
}

test.describe("Sticky message hygiene", () => {
  test("keeps friendly messages while replacing technical save errors", () => {
    expect(userFacingStickyMessage("Magic link expired")).toBe("Magic link expired");
    expect(userFacingStickySaveMessage("Sticky is not connected in this environment.")).toBe(
      "Sticky is not connected in this environment.",
    );
    expect(
      userFacingStickySaveMessage('new row violates row-level security policy for table "lists"'),
    ).toBe(GENERIC_STICKY_SAVE_MESSAGE);
    expect(userFacingStickySaveMessage("")).toBe(GENERIC_STICKY_SAVE_MESSAGE);
  });
});

async function expectSpecificVisibleControlNames(page: Page) {
  const weakNames = await page.evaluate(() => {
    const genericNames = new Set([
      "Add",
      "Delete",
      "Duplicate",
      "Complete",
      "Restore",
      "Rename",
      "Move",
      "Open",
      "Close",
    ]);

    function labelText(element: Element) {
      const ariaLabel = element.getAttribute("aria-label");
      if (ariaLabel) {
        return ariaLabel.trim();
      }

      const labelledBy = element.getAttribute("aria-labelledby");
      if (labelledBy) {
        return labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim())
          .filter(Boolean)
          .join(" ");
      }

      if (element.id) {
        const explicitLabel = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
        if (explicitLabel?.textContent) {
          return explicitLabel.textContent.trim();
        }
      }

      const wrappingLabel = element.closest("label");
      if (wrappingLabel?.textContent) {
        return wrappingLabel.textContent.replace(/\s+/g, " ").trim();
      }

      return (element.textContent ?? "").replace(/\s+/g, " ").trim();
    }

    return Array.from(document.querySelectorAll("button, [role='button'], input, textarea, select"))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((element) => {
        const name = labelText(element);
        return {
          name,
          tag: element.tagName.toLowerCase(),
          className: typeof element.className === "string" ? element.className : "",
        };
      })
      .filter((control) => !control.name || genericNames.has(control.name));
  });

  expect(weakNames).toEqual([]);
}

test.describe("Sticky workspace", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.evaluate(() => window.localStorage.clear());
    await page.reload();
  });

  test("visible workspace controls avoid empty or generic action names", async ({ page }) => {
    await expectNoConsoleErrors(page, async () => {
      await expect(page.locator(".sticky-app")).toBeVisible();
      await expect(
        page.getByText("Sticky is running in local demo mode while sign-in is not connected."),
      ).toBeVisible();
      await expect(page.getByText("Supabase env vars")).toHaveCount(0);
      await expectSpecificVisibleControlNames(page);
    });
  });

  test("list editor overlays the full workspace while creating or renaming lists", async ({ page }) => {
    await expectNoConsoleErrors(page, async () => {
      await expect(page.locator(".sticky-app")).toBeVisible();

      await page.getByRole("button", { name: "New list" }).click();
      await expect(page.getByRole("dialog", { name: "New list" })).toBeVisible();
      await expectDialogBackdropCoversViewport(page);
      await page.getByRole("button", { name: "Close list editor" }).click();
      await expect(page.getByRole("dialog", { name: "New list" })).toHaveCount(0);

      await page.getByRole("button", { name: "Rename current list reminders" }).click();
      await expect(page.getByRole("dialog", { name: "Rename list" })).toBeVisible();
      await expectDialogBackdropCoversViewport(page);
    });
  });

  test("columns light a cursor-tracking aurora tracer on hover", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "hover frame is a desktop pointer state");

    await expectNoConsoleErrors(page, async () => {
      const column = page.locator(".board-column").first();
      await expect(column).toBeVisible();

      const sampleFrame = () =>
        column.evaluate((node) => {
          const style = window.getComputedStyle(node);
          const tracer = node.querySelector(".column-paper-stack");
          const glowStyle = tracer ? window.getComputedStyle(tracer, "::before") : null;
          const arcStyle = tracer ? window.getComputedStyle(tracer, "::after") : null;
          const pin = node.querySelector(".column-pin");
          const pinStyle = pin ? window.getComputedStyle(pin) : null;

          return {
            borderWidth: Number.parseFloat(style.borderLeftWidth),
            borderColorVisible: style.borderLeftColor !== "rgba(0, 0, 0, 0)",
            boxShadow: style.boxShadow,
            glowOpacity: glowStyle ? Number.parseFloat(glowStyle.opacity) : -1,
            arcOpacity: arcStyle ? Number.parseFloat(arcStyle.opacity) : -1,
            cursorX: node.style.getPropertyValue("--mx"),
            pinTransform: pinStyle ? pinStyle.transform : "",
          };
        });

      const base = await sampleFrame();
      expect(base.borderWidth).toBeGreaterThanOrEqual(1);
      expect(base.borderColorVisible).toBe(true);
      expect(base.boxShadow).not.toBe("none");
      expect(base.glowOpacity).toBe(0);
      expect(base.arcOpacity).toBe(0);

      await column.hover();
      await page.waitForTimeout(500);

      const hover = await sampleFrame();
      expect(hover.borderWidth).toBeGreaterThanOrEqual(1);
      expect(hover.borderColorVisible).toBe(true);
      expect(hover.boxShadow).not.toBe("none");
      expect(hover.glowOpacity).toBe(1);
      expect(hover.arcOpacity).toBe(1);
      expect(hover.pinTransform).not.toBe(base.pinTransform);

      // The tracer follows the pointer and stays lit while hovering
      const box = await column.boundingBox();
      if (!box) throw new Error("column has no bounding box");
      await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.7);
      await page.waitForTimeout(120);

      const moved = await sampleFrame();
      expect(moved.glowOpacity).toBe(1);
      expect(moved.arcOpacity).toBe(1);
      expect(moved.cursorX).not.toBe("");
      expect(moved.cursorX).not.toBe(hover.cursorX);
    });
  });

  test("list columns keep their neon color identity rim", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "desktop visual pass samples all visible columns");

    const sampleRims = () =>
      page.locator(".board-column").evaluateAll((nodes) =>
        nodes.slice(0, 5).map((node) => {
          const style = window.getComputedStyle(node);

          return {
            borderTopWidth: Number.parseFloat(style.borderTopWidth),
            borderTopColor: style.borderTopColor,
            hasColorClass: /color-(sun|coral|mint|sky|violet|ink)/.test(node.className),
          };
        }),
      );

    const expectColorRims = (samples: Awaited<ReturnType<typeof sampleRims>>) => {
      expect(samples.length).toBeGreaterThanOrEqual(3);

      for (const sample of samples) {
        expect(sample.hasColorClass).toBe(true);
        expect(sample.borderTopWidth).toBeGreaterThanOrEqual(2);
        expect(sample.borderTopColor).not.toBe("rgba(0, 0, 0, 0)");
      }
    };

    await expectNoConsoleErrors(page, async () => {
      await expect(page.locator(".sticky-app")).toBeVisible();
      expectColorRims(await sampleRims());
    });
  });

  test("task text stays readable on the dark glass", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "desktop visual pass samples the full board");

    await expectNoConsoleErrors(page, async () => {
      await page.getByLabel("Open appearance settings").click();
      await expect(page.getByLabel("Workspace appearance")).toBeVisible();
      await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
      await page.keyboard.press("Escape");

      const readableSelectors = [".board-add-task", ".task-title", ".completed-toggle"];

      for (const selector of readableSelectors) {
        await expectLightText(page.locator(selector));
      }
    });
  });

  test("profile settings trigger stays visible in the top toolbar", async ({ page }) => {
    await expectNoConsoleErrors(page, async () => {
      await expectProfileSettingsTriggerVisible(page);

      await page.getByLabel("Open appearance settings").click();
      await expect(page.getByLabel("Workspace appearance")).toBeVisible();
      await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

      await expectProfileSettingsTriggerVisible(page);
    });
  });

  test("workspace finder expands and highlights matches across the page", async ({ page }, testInfo) => {
    await expectNoConsoleErrors(page, async () => {
      const toolbar = page.locator(".workspace-tools");
      const collapsedBox = await toolbar.boundingBox();
      const finder = page.getByLabel("Find in workspace");

      await page.getByLabel("Open workspace search").click();
      await expect(toolbar).toHaveClass(/search-expanded/);
      await expect(finder).toBeVisible();
      await expect(finder).toBeFocused();
      const expandedBox = await toolbar.boundingBox();
      if (testInfo.project.name === "mobile") {
        expect(expandedBox?.width ?? 0).toBeGreaterThan((collapsedBox?.width ?? 0) + 30);
      } else {
        expect(expandedBox?.width ?? 0).toBeGreaterThan((collapsedBox?.width ?? 0) + 40);
      }

      await finder.fill("domain");
      await expect(page.locator(".search-match-count")).toContainText(/match/);

      const searchControl = page.locator(".workspace-find-control");
      const searchControlBox = await searchControl.boundingBox();
      const finderBox = await finder.boundingBox();
      const countBox = await page.locator(".search-match-count").boundingBox();
      expect(searchControlBox).not.toBeNull();
      expect(finderBox).not.toBeNull();
      expect(countBox).not.toBeNull();
      if (searchControlBox && finderBox && countBox) {
        expect(finderBox.x).toBeGreaterThanOrEqual(searchControlBox.x);
        expect(finderBox.x + finderBox.width).toBeLessThanOrEqual(searchControlBox.x + searchControlBox.width + 1);
        expect(countBox.x + countBox.width).toBeLessThanOrEqual(searchControlBox.x + searchControlBox.width + 1);
      }

      if (testInfo.project.name === "desktop") {
        const calendarBox = await page.getByRole("button", { name: "Show calendar view" }).boundingBox();
        expect(calendarBox).not.toBeNull();
        if (searchControlBox && calendarBox) {
          expect(searchControlBox.x + searchControlBox.width).toBeLessThanOrEqual(calendarBox.x);
        }
      }

      const highlights = page.locator("mark.find-highlight");
      await expect(highlights.first()).toBeVisible();
      await expect(highlights.filter({ hasText: /domain/i }).first()).toBeVisible();
      await expect(page.locator(".task-card", { hasText: /domain/i }).locator("mark.find-highlight").first()).toBeVisible();

      // On narrow viewports the first match can move the page far enough that
      // the sticky toolbar needs to be brought back before the next query.
      await finder.scrollIntoViewIfNeeded();
      await finder.fill("Next");
      await expect(page.locator(".list-tab-name mark.find-highlight", { hasText: "Next" })).toBeVisible();
      await expect(page.locator(".column-title-button mark.find-highlight", { hasText: "Next" })).toBeVisible();

      await finder.press("Escape");
      await expect(finder).toHaveValue("");
      await expect(page.locator("mark.find-highlight")).toHaveCount(0);
    });
  });

  test("calendar provides a complete month view and opens scheduled tasks", async ({ page }, testInfo) => {
    await expectNoConsoleErrors(page, async () => {
      await page.getByRole("button", { name: "Show calendar view" }).click();

      const calendar = page.getByRole("region", { name: "Workspace calendar" });
      await expect(calendar).toBeVisible();
      await expect(calendar.locator(".calendar-day-name")).toHaveCount(7);
      await expect(calendar.locator(".calendar-cell")).toHaveCount(42);
      await expect(calendar.getByText("Workspace calendar", { exact: true })).toBeVisible();
      await expect(
        calendar.locator(".calendar-agenda").getByText("Daily planning pass", { exact: true }),
      ).toBeVisible();

      if (testInfo.project.name === "mobile") {
        await expect
          .poll(() =>
            calendar.locator(".calendar-month").evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
          )
          .toBe(true);
      }

      const initialMonth = await calendar.locator(".calendar-month-title").textContent();
      await calendar.getByRole("button", { name: "Next month" }).click();
      await expect(calendar.locator(".calendar-month-title")).not.toHaveText(initialMonth ?? "");
      await calendar.getByRole("button", { name: "Today" }).click();
      await expect(calendar.locator(".calendar-month-title")).toHaveText(initialMonth ?? "");

      await calendar.locator(".calendar-task", { hasText: "Daily planning pass" }).first().click();
      await expect(page.getByRole("complementary", { name: "Task details", exact: true })).toBeVisible();
    });
  });

  test("calendar week and day views provide responsive close-up schedules", async ({ page }, testInfo) => {
    await expectNoConsoleErrors(page, async () => {
      await page.getByRole("button", { name: "Show calendar view" }).click();

      const calendar = page.getByRole("region", { name: "Workspace calendar" });
      const rangeTitle = calendar.locator(".calendar-month-title");
      await calendar.getByRole("button", { name: "Week", exact: true }).click();
      await expect(calendar.getByRole("button", { name: "Week", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(calendar.locator(".calendar-week-day")).toHaveCount(7);
      await expect(calendar.locator(".calendar-week-task", { hasText: "Daily planning pass" })).toBeVisible();

      if (testInfo.project.name === "desktop") {
        const toolbarBox = await page.locator(".workspace-tools").boundingBox();
        const calendarBox = await calendar.boundingBox();
        expect(toolbarBox).not.toBeNull();
        expect(calendarBox).not.toBeNull();
        if (toolbarBox && calendarBox) {
          expect(toolbarBox.y + toolbarBox.height).toBeLessThanOrEqual(calendarBox.y);
        }
      }

      const initialWeek = await rangeTitle.textContent();
      await calendar.getByRole("button", { name: "Next week" }).click();
      await expect(rangeTitle).not.toHaveText(initialWeek ?? "");
      await calendar.getByRole("button", { name: "Today" }).click();
      await expect(rangeTitle).toHaveText(initialWeek ?? "");

      if (testInfo.project.name === "mobile") {
        await expect
          .poll(() =>
            calendar.locator(".calendar-week-view").evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
          )
          .toBe(true);
      }

      await calendar.locator(".calendar-week-day.today .calendar-week-day-header").click();
      await expect(calendar.getByRole("button", { name: "Day", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(calendar.locator(".calendar-day-view")).toBeVisible();
      await expect(calendar.locator(".calendar-day-view")).toHaveAttribute("aria-label", /Day view for/);
      await expect(calendar.locator(".calendar-day-task", { hasText: "Daily planning pass" })).toBeVisible();

      const initialDay = await rangeTitle.textContent();
      await calendar.getByRole("button", { name: "Next day" }).click();
      await expect(rangeTitle).not.toHaveText(initialDay ?? "");
      await calendar.getByRole("button", { name: "Today" }).click();
      await expect(rangeTitle).toHaveText(initialDay ?? "");

      await calendar.locator(".calendar-day-task", { hasText: "Daily planning pass" }).click();
      await expect(page.getByRole("complementary", { name: "Task details", exact: true })).toBeVisible();
    });
  });

  test("list height starts equal for empty lists and grows with tasks", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "desktop visual pass samples the board columns");

    await expectNoConsoleErrors(page, async () => {
      const createList = async (name: string) => {
        await page.getByRole("button", { name: "New list" }).click();
        await page.getByRole("dialog", { name: "New list" }).getByRole("textbox", { name: "Name" }).fill(name);
        await page.getByRole("button", { name: "Save list" }).click();
        await expect(page.getByRole("dialog", { name: "New list" })).toHaveCount(0);
        await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
      };

      await createList("Empty Length A");
      const emptyAColumn = page.locator('.board-column[data-list-slug="empty-length-a"]');
      await expect(emptyAColumn).toBeVisible();
      const emptyAHeight = await columnHeight(emptyAColumn);

      await createList("Empty Length B");
      const emptyBColumn = page.locator('.board-column[data-list-slug="empty-length-b"]');
      await expect(emptyBColumn).toBeVisible();
      const emptyBHeight = await columnHeight(emptyBColumn);
      expect(Math.abs(emptyAHeight - emptyBHeight)).toBeLessThanOrEqual(1);

      await page.getByLabel("Quick add task").fill("First growth task");
      await quickAddButton(page, "Empty Length B").click();
      await expect(emptyBColumn.locator(".task-card", { hasText: "First growth task" })).toBeVisible();
      // The empty-state illustration can be taller than a single card, so growth
      // is asserted from one task onward rather than against the empty column.
      const oneTaskHeight = await columnHeight(emptyBColumn);
      expect(oneTaskHeight).toBeGreaterThan(0);

      await page.getByLabel("Quick add task").fill("Second growth task");
      await quickAddButton(page, "Empty Length B").click();
      await expect(emptyBColumn.locator(".task-card", { hasText: "Second growth task" })).toBeVisible();
      const twoTaskHeight = await columnHeight(emptyBColumn);
      expect(twoTaskHeight).toBeGreaterThan(oneTaskHeight + 20);
    });
  });

  test("all tasks is the default board and list checkboxes control visibility", async ({ page }) => {
    await expectNoConsoleErrors(page, async () => {
      await expect(page.getByRole("heading", { name: "All tasks" })).toBeVisible();
      await expect(page.getByRole("button", { name: /Show all tasks/ })).toBeVisible();
      await expect(page.getByRole("button", { name: "Show starred tasks" })).toHaveCount(0);

      await expect(page.locator(".board-column")).toHaveCount(6);
      await expect(page.locator('.board-column[data-list-slug="product"]')).toBeVisible();

      await page.getByRole("checkbox", { name: "Hide bring from All tasks" }).click();
      await expect(page.locator('.board-column[data-list-slug="bring"]')).toHaveCount(0);
      await expect(page.getByRole("checkbox", { name: "Show bring on All tasks" })).not.toBeChecked();

      await page.getByRole("checkbox", { name: "Show bring on All tasks" }).click();
      await expect(page.locator('.board-column[data-list-slug="bring"]')).toBeVisible();
      await expect(page.getByRole("checkbox", { name: "Hide bring from All tasks" })).toBeChecked();
    });
  });

  test("clicking empty board space deselects the current list", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "board background selection is a desktop interaction");

    await expectNoConsoleErrors(page, async () => {
      await page.locator("button.list-tab", { hasText: "reminders" }).click();
      await expect(page.locator(".list-tab.active")).toHaveCount(1);
      await expect(page.locator(".board-column.active")).toHaveCount(1);

      await expect
        .poll(() =>
          page.locator(".board-column.active .task-lane").evaluate((node) => ({
            overflowY: window.getComputedStyle(node).overflowY,
            scrollbarWidth: window.getComputedStyle(node).getPropertyValue("scrollbar-width"),
          })),
        )
        .toEqual({ overflowY: "auto", scrollbarWidth: "thin" });
      await expect
        .poll(() =>
          page.getByRole("region", { name: "Active tasks" }).evaluate((node) => ({
            overflowX: window.getComputedStyle(node).overflowX,
            scrollbarWidth: window.getComputedStyle(node).getPropertyValue("scrollbar-width"),
          })),
        )
        .toEqual({ overflowX: "auto", scrollbarWidth: "thin" });
      await expect
        .poll(() =>
          page.locator("html").evaluate((node) =>
            window.getComputedStyle(node).getPropertyValue("scrollbar-width"),
          ),
        )
        .toBe("thin");
      await expect
        .poll(() =>
          page.locator(".list-stack").evaluate((node) =>
            window.getComputedStyle(node).getPropertyValue("scrollbar-width"),
          ),
        )
        .toBe("thin");
      await expect
        .poll(() =>
          page.locator(".board-column.active").evaluate((column) => {
            const task = column.querySelector<HTMLElement>(".task-card");
            const title = column.querySelector<HTMLElement>(".task-title");
            const body = column.querySelector<HTMLElement>(".task-body-button");
            const check = column.querySelector<HTMLElement>(".task-check");

            if (!task || !title || !body || !check) {
              return null;
            }

            const taskStyle = window.getComputedStyle(task);
            const taskRect = task.getBoundingClientRect();
            const titleRect = title.getBoundingClientRect();
            const checkRect = check.getBoundingClientRect();

            return {
              cardTallEnoughToRead: taskRect.height >= 36,
              cardRounded: Number.parseFloat(taskStyle.borderTopLeftRadius) >= 2,
              cardElevated: taskStyle.boxShadow !== "none",
              titleInsideCard:
                titleRect.top >= taskRect.top - 1 && titleRect.bottom <= taskRect.bottom + 1,
              checkAlignedWithFirstLine: checkRect.top - taskRect.top <= 24,
              titleNotTransformed: window.getComputedStyle(title).transform === "none",
            };
          }),
        )
        .toEqual({
          cardTallEnoughToRead: true,
          cardRounded: true,
          cardElevated: true,
          titleInsideCard: true,
          checkAlignedWithFirstLine: true,
          titleNotTransformed: true,
        });

      await page.getByRole("region", { name: "Active tasks" }).click({ position: { x: 2, y: 2 } });

      await expect(page.locator(".list-tab.active")).toHaveCount(0);
      await expect(page.locator(".board-column.active")).toHaveCount(0);
      await page.waitForFunction(() => {
        const stored = window.localStorage.getItem("sticky.demo.workspace.v2");
        return Boolean(stored && JSON.parse(stored).userState.selectedListId === null);
      });

      await page.reload();
      await expect(page.locator(".list-tab.active")).toHaveCount(0);
      await expect(page.locator(".board-column.active")).toHaveCount(0);
    });
  });

  test("lists can be archived and restored from the sidebar", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "sidebar archive controls use desktop hover actions");

    await expectNoConsoleErrors(page, async () => {
      const financeColumn = page.locator('.board-column[data-list-slug="finance"]');
      await expect(financeColumn).toBeVisible();

      const financeRow = page.locator(".list-tab-wrap", { hasText: "Finance" });
      await financeRow.hover();
      await financeRow.getByRole("button", { name: "Archive Finance" }).click();

      await expect(financeColumn).toHaveCount(0);
      await expect(page.getByLabel("Archived lists").getByText("Finance")).toBeVisible();
      await expect(page.getByRole("button", { name: "Restore archived list Finance" })).toBeVisible();

      await page.getByRole("button", { name: "Restore archived list Finance" }).click();
      await expect(page.locator('.board-column[data-list-slug="finance"]')).toBeVisible();
      await expect(page.getByLabel("Archived lists")).toHaveCount(0);
    });
  });

  test("distant lists defer task controls until they approach the viewport", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "large-board rendering check runs in the desktop project");

    await expectNoConsoleErrors(page, async () => {
      const booksColumn = page.locator('.board-column[data-list-slug="books"]');

      await expect(booksColumn.getByRole("button", { name: "Load 12 tasks in Books" })).toBeVisible();
      await expect(booksColumn.locator(".task-card")).toHaveCount(0);

      await booksColumn.scrollIntoViewIfNeeded();
      await expect(booksColumn.locator(".task-card")).toHaveCount(12);
    });
  });

  test("desktop workflow covers lists, tasks, subtasks, due dates, recurrence, completed pile, and persistence", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "full workflow runs in the desktop project");
    test.setTimeout(300_000);

    await expectNoConsoleErrors(page, async () => {
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "All tasks" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "reminders", exact: true })).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: "Open list reminders, 4 active tasks, 8 completed tasks, shown on All tasks, current list",
        }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Current task view: All, 4 tasks" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Current task sort: Custom order" })).toBeVisible();
      await expectSingleLine(page.locator(".workspace-title h2"));
      await expectNoHorizontalOverflow(page);
      await expect(page.locator(".save-status")).toContainText("Local demo saved");
      await page.waitForFunction(() => document.readyState === "complete");
      await page.keyboard.press("KeyN");
      await expect(page.getByLabel("Quick add task")).toBeFocused();
      const commandTrigger = page.getByRole("button", { name: "Open command center" });
      await page.keyboard.press("Control+K");
      await expect(commandTrigger).toHaveAttribute("aria-expanded", "true");
      const commandDialog = page.getByRole("dialog", { name: "Command center" });
      await expect(commandDialog).toBeVisible();
      const commandSearch = page.getByRole("combobox", { name: "Search commands" });
      await expect(commandSearch).toHaveAttribute("aria-controls", "sticky-command-results");
      await expect(commandSearch).toHaveAttribute("aria-expanded", "true");
      await expect(commandSearch).toHaveAttribute("aria-activedescendant", "sticky-command-option-0");
      await expect(commandDialog.getByRole("option").first()).toHaveAttribute("id", "sticky-command-option-0");
      await commandSearch.fill("capture");
      await expect(commandDialog.getByRole("option", { name: "Capture a new task" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(commandDialog).toHaveCount(0);
      await page.keyboard.press("Control+K");
      await commandSearch.fill("capture");
      await page.keyboard.press("Escape");
      await expect(commandDialog).toHaveCount(0);
      await expect(commandTrigger).toHaveAttribute("aria-expanded", "false");
      await expect(commandTrigger).toBeFocused();
      await page.keyboard.press("Control+K");
      await expect(commandSearch).toHaveValue("");
      await page.keyboard.press("Escape");
      await expect(commandTrigger).toBeFocused();

      const newListButton = page.getByRole("button", { name: "New list" });
      await newListButton.click();
      const newListDialog = page.getByRole("dialog", { name: "New list" });
      await expect(newListDialog).toBeVisible();
      const newListName = newListDialog.getByRole("textbox", { name: "Name" });
      await expect(newListName).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(newListDialog.getByRole("button", { name: "Close list editor" })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(newListName).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(newListDialog).toHaveCount(0);
      await expect(newListButton).toBeFocused();

      await newListButton.click();
      await expect(newListDialog).toBeVisible();
      await newListName.fill("Verification");
      await page.getByText("Sky", { exact: true }).click();
      await page.getByRole("button", { name: "Save list" }).click();
      await expect(page.getByRole("heading", { name: "Verification" })).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: "Open list Verification, 0 active tasks, 0 completed tasks, shown on All tasks, current list",
        }),
      ).toBeVisible();
      await expect(newListButton).toBeFocused();

      const renameButton = page.getByRole("button", { name: "Rename current list Verification" });
      await renameButton.click();
      await expect(page.getByRole("dialog", { name: "Rename list" })).toBeVisible();
      await page.getByRole("textbox", { name: "Name" }).fill("Verification Prime");
      await page.getByRole("button", { name: "Save list" }).click();
      await expect(page.getByRole("heading", { name: "Verification Prime" })).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: "Open list Verification Prime, 0 active tasks, 0 completed tasks, shown on All tasks, current list",
        }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Rename current list Verification Prime" })).toBeFocused();

      await page.getByRole("button", { name: "New list" }).click();
      await page.getByRole("textbox", { name: "Name" }).fill("Move Target");
      await page.getByText("Mint", { exact: true }).click();
      await page.getByRole("button", { name: "Save list" }).click();
      await expect(page.getByRole("heading", { name: "Move Target" })).toBeVisible();
      const moveTargetTab = page.locator(".list-tab-wrap", { hasText: "Move Target" });
      await expect(
        moveTargetTab.getByRole("button", { name: "Drag list named Move Target" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Drag list named Move Target" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Drag list named Verification Prime" }),
      ).toBeVisible();
      await page.keyboard.press("Control+K");
      await page.getByLabel("Search commands").fill("Verification Prime");
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { name: "Verification Prime" })).toBeVisible();
      await page.keyboard.press("Control+K");
      await page.getByLabel("Search commands").fill("search");
      await page.keyboard.press("Enter");
      await expect(page.getByLabel("Find in workspace")).toBeFocused();

      const verificationPrimeTab = page.locator(".list-tab-wrap", { hasText: "Verification Prime" });
      await verificationPrimeTab.scrollIntoViewIfNeeded();
      await moveTargetTab.scrollIntoViewIfNeeded();
      await dragBetween(
        page,
        page.locator(".list-tab-wrap", { hasText: "Move Target" }).locator(".drag-handle"),
        verificationPrimeTab.locator(".drag-handle"),
      );
      await expectTextBefore(page, ".list-stack .list-tab-name", "Move Target", "Verification Prime");

      await page.locator("button.list-tab", { hasText: "Verification Prime" }).click();
      await page.getByLabel("Quick add task").fill("Write the verification sticky");
      await quickAddButton(page, "Verification Prime").click();
      await expect(page.getByText("Write the verification sticky")).toBeVisible();

      await page.getByLabel("Quick add task").fill("Second order sticky");
      await quickAddButton(page, "Verification Prime").click();
      await page
        .locator(".task-card", { hasText: "Second order sticky" })
        .getByRole("button", { name: /Move Second order sticky up/ })
        .click();
      await expectTextBefore(page, ".task-title", "Second order sticky", "Write the verification sticky");
      await page
        .locator(".task-card", { hasText: "Second order sticky" })
        .getByRole("button", { name: /Complete Second order sticky/ })
        .click();
      const completedToggle = page.locator('button[aria-controls="completed-stickies-list"]');
      await expect(completedToggle).toHaveAttribute("aria-controls", "completed-stickies-list");
      await expect(completedToggle).toHaveAttribute("aria-expanded", "false");
      await completedToggle.click();
      await expect(completedToggle).toHaveAttribute("aria-expanded", "true");
      await expect(page.locator("#completed-stickies-list")).toBeVisible();
      const initialCompletedRegion = page.getByRole("region", { name: "Completed tasks", exact: true });
      await expect(initialCompletedRegion.getByRole("button", { name: "Second order sticky", exact: true })).toBeVisible();
      await initialCompletedRegion.getByRole("button", { name: /Restore Second order sticky/ }).click();
      await expect(page.getByRole("region", { name: "Active tasks" }).getByText("Second order sticky")).toBeVisible();
      await expect(page.locator("#completed-stickies-list")).toBeEmpty();
      await expect(page.getByText("Completed tasks land here.", { exact: true })).toHaveCount(0);
      await completedToggle.click();
      await expect(completedToggle).toHaveAttribute("aria-expanded", "false");

      const smartTomorrow = localDateKey(1);
      await page.getByLabel("Quick add task").fill("Smart parsed sticky tomorrow 2pm");
      await expect(page.locator(".quick-schedule-preview")).toContainText("Tomorrow");
      await expect(page.locator(".quick-schedule-preview")).toContainText("2:00 PM");
      await quickAddButton(page, "Verification Prime").click();
      const smartCard = page.locator(".task-card", { hasText: "Smart parsed sticky" });
      await expect(smartCard).toBeVisible();
      await expect(smartCard).toContainText(`${shortDateLabel(smartTomorrow)} at 14:00`);
      await expect(smartCard).not.toContainText("tomorrow 2pm");

      await page.getByText("Write the verification sticky").click();
      const details = page.getByRole("complementary", { name: "Task details", exact: true });
      await details.getByRole("textbox", { name: "Title", exact: true }).fill("Verification sticky polished");
      await details.getByRole("textbox", { name: "Title", exact: true }).blur();
      await details.getByRole("textbox", { name: "Details" }).fill("Covers edits, dates, movement, subtasks, and completion.");
      await details.getByRole("textbox", { name: "Details" }).blur();
      const tomorrow = localDateKey(1);
      await details.getByRole("button", { name: "Tomorrow" }).click();
      await expect(details.locator('input[aria-label="Due date"]')).toHaveValue(tomorrow);
      await expect(details.getByText(shortDateLabel(tomorrow), { exact: true })).toBeVisible();
      await details.getByRole("button", { name: "Afternoon" }).click();
      await expect(details.locator('input[aria-label="Due time"]')).toHaveValue("14:00");
      await expect(details.getByText(`${shortDateLabel(tomorrow)} at 14:00`, { exact: true })).toBeVisible();
      await details.getByRole("button", { name: "No date" }).click();
      const removeDueButton = details.getByRole("button", { name: "Remove due date and time", exact: true });
      await expect(details.locator('input[aria-label="Due date"]')).toHaveValue("");
      await expect(details.locator('input[aria-label="Due time"]')).toBeDisabled();
      await expect(details.locator('input[aria-label="Due time"]')).toHaveAccessibleDescription(
        "Choose a due date before adding a time.",
      );
      await expect(removeDueButton).toBeDisabled();
      await expect(details.getByText(`${shortDateLabel(tomorrow)} at 14:00`)).toHaveCount(0);
      await details.locator('input[aria-label="Due date"]').fill("2026-06-15");
      await expect(details.getByText("Choose a due date before adding a time.")).toHaveCount(0);
      await details.locator('input[aria-label="Due time"]').fill("14:30");
      await expect(details.getByText("Jun 15 at 14:30", { exact: true })).toBeVisible();
      await expect(removeDueButton).toBeEnabled();
      await removeDueButton.click();
      await expect(page.getByText("Jun 15 at 14:30")).toHaveCount(0);
      await expect(removeDueButton).toBeDisabled();
      await details.locator('input[aria-label="Due date"]').fill("2026-06-15");
      await details.locator('input[aria-label="Due time"]').fill("14:30");
      await expect(details.getByText("Jun 15 at 14:30", { exact: true })).toBeVisible();
      const filteredActiveRegion = page.getByRole("region", { name: "Active tasks" });
      const taskViews = page.locator(".task-filter-bar");
      await runCommand(page, "show today tasks");
      await expect(taskViews.getByRole("button", { name: "Current task view: Today, 0 tasks" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(filteredActiveRegion.getByText("Verification sticky polished")).toHaveCount(0);

      await runCommand(page, "show scheduled tasks");
      await expect(taskViews.getByRole("button", { name: "Current task view: Scheduled, 2 tasks" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(filteredActiveRegion.getByText("Verification sticky polished")).toBeVisible();
      await expect(filteredActiveRegion.getByText("Second order sticky")).toHaveCount(0);
      await expect(
        filteredActiveRegion.locator(".task-card", { hasText: "Verification sticky polished" }).getByRole("button", {
          name: /Move Verification sticky polished up/,
        }),
      ).toBeDisabled();
      await expect(page.getByText(/Reordering is locked while filters or due-date sorting are active/)).toBeVisible();
      await runCommand(page, "show all tasks");
      await expect(taskViews.getByRole("button", { name: "Current task view: All, 3 tasks" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(filteredActiveRegion.getByText("Second order sticky")).toBeVisible();
      await runCommand(page, "sort by due date");
      await expect(page.getByRole("button", { name: "Current task sort: Due date" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expectTextBefore(page, ".task-title", "Verification sticky polished", "Smart parsed sticky");
      await expect(
        filteredActiveRegion.locator(".task-card", { hasText: "Verification sticky polished" }).getByRole("button", {
          name: /Move Verification sticky polished up/,
        }),
      ).toBeDisabled();
      await page.keyboard.press("Control+K");
      await page.getByLabel("Search commands").fill("custom order");
      await page.keyboard.press("Enter");
      await expect(page.getByRole("button", { name: "Current task sort: Custom order" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );

      const newSubtaskTitle = details.getByLabel("New subtask title");
      const addSubtaskButton = details.getByRole("button", { name: "Add subtask" });
      await expect(addSubtaskButton).toBeDisabled();
      await newSubtaskTitle.fill("First subtask");
      await expect(addSubtaskButton).toBeEnabled();
      await addSubtaskButton.click();
      const firstSubtaskInput = details.locator(".subtask-row input").first();
      await expect(firstSubtaskInput).toHaveValue("First subtask");
      await firstSubtaskInput.fill("Edited subtask");
      await firstSubtaskInput.blur();
      await expect(firstSubtaskInput).toHaveValue("Edited subtask");
      const editedSubtaskRow = details.locator(".subtask-row").first();
      await expect(
        editedSubtaskRow.getByRole("button", { name: "Complete subtask: Edited subtask" }),
      ).toBeVisible();
      await expect(
        editedSubtaskRow.getByRole("button", { name: "Reorder subtask: Edited subtask" }),
      ).toBeVisible();
      await expect(
        editedSubtaskRow.getByRole("button", { name: "Delete subtask: Edited subtask" }),
      ).toBeVisible();

      await newSubtaskTitle.fill("Second subtask");
      await addSubtaskButton.click();
      const subtaskRows = details.locator(".subtask-row");
      await expect(
        subtaskRows.nth(0).getByRole("button", { name: /Move Edited subtask up/ }),
      ).toBeDisabled();
      await expect(
        subtaskRows.nth(1).getByRole("button", { name: /Move Second subtask down/ }),
      ).toBeDisabled();
      await subtaskRows.nth(1).getByRole("button", { name: /Move Second subtask up/ }).click();
      await expect(details.locator(".subtask-row input").first()).toHaveValue("Second subtask");
      await expect(
        details.locator(".subtask-row").first().getByRole("button", { name: /Move Second subtask up/ }),
      ).toBeDisabled();
      await details.locator(".subtask-row").first().getByRole("button", { name: /Move Second subtask down/ }).click();
      await expect(details.locator(".subtask-row input").nth(1)).toHaveValue("Second subtask");
      await dragBetween(page, details.locator(".subtask-drag").nth(1), details.locator(".subtask-drag").nth(0));
      await expect(details.locator(".subtask-row.dragging")).toHaveCount(0);
      await page.waitForTimeout(100);
      await expect(details.locator(".subtask-row input").first()).toHaveValue("Second subtask");
      await details.getByRole("button", { name: "Complete subtask: Second subtask" }).click();
      await expect(details.getByRole("button", { name: "Restore subtask: Second subtask" })).toBeVisible();
      await details.getByRole("button", { name: "Delete subtask: Second subtask" }).click();
      await expect(details.locator(".subtask-row")).toHaveCount(1);
      const subtaskDeleteToast = page.getByRole("group", { name: /Subtask deleted: Second subtask/ });
      await expect(subtaskDeleteToast).toBeVisible();
      await expect(subtaskDeleteToast.getByRole("button", { name: "Dismiss Subtask deleted" })).toBeVisible();
      await subtaskDeleteToast.getByRole("button", { name: "Undo Subtask deleted" }).click();
      await expect(details.locator(".subtask-row")).toHaveCount(2);
      await expect(details.getByLabel("Not repeating")).toBeDisabled();
      await expect(details.getByLabel("Not repeating")).toHaveAccessibleDescription(
        "Repeating tasks cannot have subtasks. Remove subtasks first.",
      );

      await details.getByLabel("List").selectOption({ label: "Move Target" });
      await page.locator("button.list-tab", { hasText: "Move Target" }).click();
      const previousListRegion = page.getByLabel("List Verification Prime", { exact: true });
      const activeRegion = page.getByLabel("List Move Target", { exact: true });
      await expect(
        previousListRegion.locator(".task-card", { hasText: "Verification sticky polished" }),
      ).toHaveCount(0);
      await expect(activeRegion.getByText("Verification sticky polished")).toBeVisible();

      const twoDaysAgo = localDateKey(-2);
      const today = localDateKey();
      await page.getByLabel("Quick add task").fill("Overdue repeat catch-up");
      await quickAddButton(page, "Move Target").click();
      await activeRegion.getByText("Overdue repeat catch-up").click();
      await details.locator('input[aria-label="Due date"]').fill(twoDaysAgo);
      await details.locator('input[aria-label="Due time"]').fill("08:00");
      await details.getByLabel("Not repeating").check();
      await expect(page.getByText(/1 repeating task behind schedule/)).toBeVisible();
      await expect(details.getByText(/Behind schedule/)).toBeVisible();
      await details.getByRole("button", { name: "Advance repeat" }).click();
      await expect(page.getByText("Repeats caught up")).toBeVisible();
      await expect(page.locator(".task-card", { hasText: "Overdue repeat catch-up" })).toContainText(
        `${shortDateLabel(today)} at 08:00`,
      );
      await expect(page.getByText(/behind schedule/)).toHaveCount(0);

      await page.getByLabel("Quick add task").fill("Repeat without subtasks");
      await quickAddButton(page, "Move Target").click();
      await activeRegion.getByText("Repeat without subtasks").click();
      await details.getByLabel("Not repeating").check();
      const repeatSubtaskTitle = details.getByLabel("New subtask title");
      const repeatAddSubtaskButton = details.getByRole("button", { name: "Add subtask" });
      await expect(repeatSubtaskTitle).toBeDisabled();
      await expect(repeatSubtaskTitle).toHaveAccessibleDescription(
        "Repeating tasks do not support subtasks. Remove repeat to add subtasks.",
      );
      await expect(repeatAddSubtaskButton).toBeDisabled();
      await expect(repeatAddSubtaskButton).toHaveAccessibleDescription(
        "Repeating tasks do not support subtasks. Remove repeat to add subtasks.",
      );
      await details.getByLabel("Starts").fill("2026-06-15");
      await expect(details.getByLabel("Starts")).toHaveValue("2026-06-15");
      await details.getByLabel("Frequency").selectOption("weekly");
      await details.getByLabel("Monday").click();
      await details.getByLabel("Ends").selectOption("after_count");
      await details.getByRole("spinbutton", { name: "Count" }).fill("8");
      await expect(details.getByLabel("Repeating")).toBeChecked();
      await expect(details.getByText("Every week on Mon")).toBeVisible();
      await expect(details.getByText("Starts Jun 15, 2026 - Ends after 8 times")).toBeVisible();
      await details.getByLabel("Pause repeat").check();
      await expect(details.locator(".recurrence-preview strong")).toHaveText("Repeat paused");
      await expect(page.locator(".task-card", { hasText: "Repeat without subtasks" })).toContainText("Repeat paused");
      await details.getByLabel("Pause repeat").uncheck();
      await expect(details.getByText("Every week on Mon")).toBeVisible();

      await details.getByRole("button", { name: "Complete Repeat without subtasks" }).click();
      const repeatToast = page.locator(".toast", { hasText: "Next repeat: Jun 22, 2026" });
      await expect(repeatToast).toBeVisible();
      const completedRegion = page.getByRole("region", { name: "Completed tasks", exact: true });
      await completedRegion.getByRole("button", { name: /Completed/ }).click();
      await expect(completedRegion.getByRole("button", { name: "Repeat without subtasks", exact: true })).toBeVisible();
      const generatedRepeatCard = activeRegion
        .locator(".task-card", { hasText: "Repeat without subtasks" })
        .filter({ hasText: "Jun 22" });
      await expect(generatedRepeatCard).toContainText("Repeat without subtasks");
      await expect(generatedRepeatCard).toContainText("Every week on Mon");
      const repeatTaskButton = generatedRepeatCard.locator("button.task-body-button");

      await repeatTaskButton.click();
      await details.getByRole("button", { name: "Complete Repeat without subtasks" }).click();
      const clearCompletedButton = page.getByRole("button", { name: "Clear completed" });
      await clearCompletedButton.click();
      const clearDialog = page.getByRole("dialog", { name: "Clear completed pile?" });
      await expect(clearDialog).toBeVisible();
      await expect(clearDialog.getByRole("button", { name: "Cancel" })).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(clearDialog.getByRole("button", { name: "Clear completed" })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(clearDialog.getByRole("button", { name: "Cancel" })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(clearDialog).toHaveCount(0);
      await expect(clearCompletedButton).toBeFocused();

      await clearCompletedButton.click();
      await expect(clearDialog).toBeVisible();
      await clearDialog.getByRole("button", { name: "Clear completed" }).click();
      await expect(page.getByRole("group", { name: /Completed pile cleared/ })).toBeVisible();

      const moveTargetListTab = page.locator(".list-tab-wrap").filter({
        has: page.locator("button.list-tab", { hasText: "Move Target" }),
      });
      await moveTargetListTab.hover();
      await moveTargetListTab.getByRole("button", { name: /Delete Move Target/ }).click();
      await page.getByRole("button", { name: "Delete list" }).click();
      await expect(page.locator("button.list-tab", { hasText: "Move Target" })).toHaveCount(0);
      const listDeleteToast = page.getByRole("group", { name: /List deleted: Move Target/ });
      await expect(listDeleteToast).toBeVisible();
      await listDeleteToast.getByRole("button", { name: "Undo List deleted" }).click();
      await expect(page.locator("button.list-tab", { hasText: "Move Target" })).toBeVisible();
      await expect(activeRegion.getByText("Verification sticky polished")).toBeVisible();

      await moveTargetListTab.hover();
      await moveTargetListTab.getByRole("button", { name: /Delete Move Target/ }).click();
      await page.getByRole("button", { name: "Delete list" }).click();
      await expect(page.locator("button.list-tab", { hasText: "Move Target" })).toHaveCount(0);

      await page.reload();
      const persistedVerificationTab = page.locator("button.list-tab", { hasText: "Verification Prime" });
      await persistedVerificationTab.scrollIntoViewIfNeeded();
      await expect(persistedVerificationTab).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });
  });

  test("mobile layout keeps the workspace usable", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "mobile layout check runs in the mobile project");
    test.setTimeout(75_000);

    await expectNoConsoleErrors(page, async () => {
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "reminders", exact: true })).toBeVisible();
      await expectMobileZoomAllowed(page);
      await expectSingleLine(page.locator(".workspace-title h2"));
      await expectNoHorizontalOverflow(page);
      await expect(page.locator(".save-status")).toContainText("Local demo saved");
      await expect
        .poll(() =>
          page.locator(".list-stack").evaluate((node) => node.scrollWidth >= node.clientWidth),
        )
        .toBe(true);
      const launchTab = page.locator(".list-tab-wrap", { hasText: "Next 3" });
      await launchTab.scrollIntoViewIfNeeded();
      await expectNoInlineClip(launchTab.locator(".list-tab-name"));
      await expect(
        launchTab.getByRole("button", { name: /Open list Next 3/ }),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.keyboard.press("Control+K");
      await expect(page.getByRole("dialog", { name: "Command center" })).toBeVisible();
      await page.getByLabel("Search commands").fill("capture");
      await page.keyboard.press("Enter");
      await expect(page.getByLabel("Quick add task")).toBeFocused();
      await page.getByLabel("Quick add task").fill("Mobile capture");
      await quickAddButton(page, "reminders").click();
      await expect(page.getByText("Mobile capture")).toBeVisible();
      for (const label of ["Scheduled", "Repeating", "Subtasks"]) {
        await expectNoInlineClip(page.locator(".task-filter-bar button", { hasText: label }).locator("span"));
      }
      const mobileDetails = page.getByRole("complementary", { name: "Task details", exact: true });
      await expect(mobileDetails).toBeVisible();
      await expect(mobileDetails.locator('input[type="date"]')).toBeVisible();
      const mobileSubtaskTitle = mobileDetails.getByLabel("New subtask title");
      const mobileAddSubtask = mobileDetails.getByRole("button", { name: "Add subtask" });
      await expect(mobileAddSubtask).toBeDisabled();
      await mobileSubtaskTitle.fill("Phone first");
      await expect(mobileAddSubtask).toBeEnabled();
      await mobileAddSubtask.click();
      await mobileSubtaskTitle.fill("Phone second");
      await mobileAddSubtask.click();
      await expect(
        mobileDetails.locator(".subtask-row").nth(1).getByRole("button", { name: /Move Phone second up/ }),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await mobileDetails.getByRole("button", { name: "Complete Mobile capture" }).click();
      const activeRegion = page.getByRole("region", { name: "Active tasks" });
      await expect(activeRegion.locator(".task-card", { hasText: "Mobile capture" })).toHaveCount(0);
      const completionToast = page.getByRole("group", { name: "Task completed: Mobile capture" });
      await expect(completionToast).toBeVisible();
      const closeDetails = mobileDetails.getByRole("button", { name: "Close details" });
      await closeDetails.scrollIntoViewIfNeeded();
      await closeDetails.click();
      await expect(completionToast).toBeHidden({ timeout: 8_000 });
      const completedToggle = page.locator('button[aria-controls="completed-stickies-list"]');
      await expect(completedToggle).toHaveAttribute("aria-expanded", "false");
      await completedToggle.click();
      await expect(completedToggle).toHaveAttribute("aria-expanded", "true");
      const completedRegion = page.getByRole("region", { name: "Completed tasks", exact: true });
      await expect(completedRegion.getByRole("button", { name: "Mobile capture", exact: true })).toBeVisible();
      await completedRegion.getByRole("button", { name: "Restore Mobile capture" }).click();
      await expect(activeRegion.locator(".task-card", { hasText: "Mobile capture" })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.reload();
      await expect(activeRegion.locator(".task-card", { hasText: "Mobile capture" })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });
  });

  test("task view and sort preferences survive reload", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "view preference persistence runs in the desktop project");

    await expectNoConsoleErrors(page, async () => {
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "reminders", exact: true })).toBeVisible();
      const taskViews = page.locator(".task-filter-bar");

      await runCommand(page, "show today tasks");
      await runCommand(page, "sort by due date");
      await expect(taskViews.getByRole("button", { name: "Current task view: Today, 2 tasks" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(page.getByRole("button", { name: "Current task sort: Due date" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(page.getByText(/Reordering is locked while filters or due-date sorting are active/)).toBeVisible();

      await page.reload();
      await expect(page.getByRole("heading", { name: "reminders", exact: true })).toBeVisible();
      await expect(taskViews.getByRole("button", { name: "Current task view: Today, 2 tasks" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(page.getByRole("button", { name: "Current task sort: Due date" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(page.getByText(/Reordering is locked while filters or due-date sorting are active/)).toBeVisible();
    });
  });

  test("completed pile preference survives reload", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "completed pile persistence runs in the desktop project");

    await expectNoConsoleErrors(page, async () => {
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "reminders", exact: true })).toBeVisible();

      const completedToggle = page.locator('button[aria-controls="completed-stickies-list"]');
      await expect(completedToggle).toHaveAttribute("aria-expanded", "false");
      await completedToggle.click();
      await expect(completedToggle).toHaveAttribute("aria-expanded", "true");
      await expect(page.locator("#completed-stickies-list")).toBeVisible();
      await page.waitForFunction(() => {
        const stored = window.localStorage.getItem("sticky.demo.workspace.v2");
        return Boolean(stored && JSON.parse(stored).preferences.completedOpenByList["demo-list-reminders"]);
      });

      await page.reload();
      await expect(page.getByRole("heading", { name: "reminders", exact: true })).toBeVisible();
      await expect(completedToggle).toHaveAttribute("aria-expanded", "true");
      await expect(page.locator("#completed-stickies-list")).toBeVisible();

      await completedToggle.click();
      await expect(completedToggle).toHaveAttribute("aria-expanded", "false");
      await page.waitForFunction(() => {
        const stored = window.localStorage.getItem("sticky.demo.workspace.v2");
        return Boolean(stored && !JSON.parse(stored).preferences.completedOpenByList["demo-list-today"]);
      });
      await page.reload();
      await expect(page.getByRole("heading", { name: "reminders", exact: true })).toBeVisible();
      await expect(completedToggle).toHaveAttribute("aria-expanded", "false");
      await expect(page.locator("#completed-stickies-list")).toHaveCount(0);
    });
  });

  test("selected list and search state survive reload", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "user state persistence runs in the desktop project");

    await expectNoConsoleErrors(page, async () => {
      await page.goto("/");
      await page.locator("button.list-tab", { hasText: "Next 3" }).click();
      await expect(page.getByRole("heading", { name: "Next 3", exact: true })).toBeVisible();

      await page.getByLabel("Open workspace search").click();
      const searchInput = page.getByLabel("Find in workspace");
      await searchInput.fill("domain");
      const activeRegion = page.getByRole("region", { name: "Active tasks" });
      await expect(activeRegion.getByText("Prepare the Vercel domain checklist")).toBeVisible();

      await page.reload();
      await expect(page.getByRole("heading", { name: "Next 3", exact: true })).toBeVisible();
      await expect(searchInput).toHaveValue("domain");
      await expect(activeRegion.getByText("Prepare the Vercel domain checklist")).toBeVisible();
      await expect(page.locator("button.list-tab", { hasText: "Next 3" })).toHaveAccessibleName(
        /current list/,
      );
    });
  });

  test("task view filters cover overdue, repeating, and subtasks without corrupting custom order", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "view filter coverage runs in the desktop project");

    await expectNoConsoleErrors(page, async () => {
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "reminders", exact: true })).toBeVisible();

      const taskViews = page.locator(".task-filter-bar");
      const activeRegion = page.getByRole("region", { name: "Active tasks" });
      const overdueTitle = "Overdue filter proof";
      const overdueDate = localDateKey(-1);

      await page.getByLabel("Quick add task").fill(overdueTitle);
      await quickAddButton(page, "reminders").click();
      await activeRegion.getByText(overdueTitle).click();

      const details = page.getByRole("complementary", { name: "Task details", exact: true });
      await details.locator('input[aria-label="Due date"]').fill(overdueDate);
      await expect(activeRegion.locator(".task-card", { hasText: overdueTitle })).toContainText(
        shortDateLabel(overdueDate),
      );

      await runCommand(page, "show overdue tasks");
      await expect(taskViews.getByRole("button", { name: "Current task view: Overdue, 1 task" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(activeRegion.getByText(overdueTitle)).toBeVisible();
      await expect(activeRegion.getByText("Daily planning pass")).toHaveCount(0);
      await expect(
        activeRegion.locator(".task-card", { hasText: overdueTitle }).getByRole("button", {
          name: /Move Overdue filter proof up/,
        }),
      ).toBeDisabled();
      await expect(page.getByText(/Reordering is locked while filters or due-date sorting are active/)).toBeVisible();

      await runCommand(page, "show repeating tasks");
      await expect(taskViews.getByRole("button", { name: "Current task view: Repeating, 1 task" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(activeRegion.getByText("Daily planning pass")).toBeVisible();
      await expect(activeRegion.getByText(overdueTitle)).toHaveCount(0);

      await runCommand(page, "show subtasks tasks");
      await expect(taskViews.getByRole("button", { name: "Current task view: Subtasks, 2 tasks" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(activeRegion.getByText("Clear the capture tray")).toBeVisible();
      await expect(activeRegion.getByText("Tighten the details panel")).toBeVisible();
      await expect(activeRegion.getByText("Daily planning pass")).toHaveCount(0);
      await expect(activeRegion.getByText(overdueTitle)).toHaveCount(0);

      await runCommand(page, "show all tasks");
      await expect(taskViews.getByRole("button", { name: "Current task view: All, 5 tasks" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(page.getByText(/Reordering is locked while filters or due-date sorting are active/)).toHaveCount(0);
      await expectTextBefore(page, ".task-title", "Clear the capture tray", "Tighten the details panel");
      await expectTextBefore(page, ".task-title", "Daily planning pass", overdueTitle);
    });
  });

  test("quick capture can route a sticky to a list token and reveal it", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "capture routing runs in the desktop project");

    await expectNoConsoleErrors(page, async () => {
      await page.goto("/");
      await page.getByRole("button", { name: "New list" }).click();
      await page.getByRole("textbox", { name: "Name" }).fill("Capture Target");
      await page.getByText("Mint", { exact: true }).click();
      await page.getByRole("button", { name: "Save list" }).click();
      await expect(page.getByRole("heading", { name: "Capture Target" })).toBeVisible();

      await page.locator("button.list-tab", { hasText: "reminders" }).click();
      await expect(page.getByRole("heading", { name: "reminders", exact: true })).toBeVisible();
      await page.getByLabel("Open workspace search").click();
      await page.getByLabel("Find in workspace").fill("nothing matches this");
      await page.getByLabel("Quick add task").fill("Route me #capture-target tomorrow 9am");
      await expect(page.locator(".quick-schedule-preview")).toContainText("Capture Target");
      await expect(page.locator(".quick-schedule-preview")).toContainText("Tomorrow");
      await expect(page.locator(".quick-schedule-preview")).toContainText("9:00 AM");
      await quickAddButton(page, "Capture Target").click();

      await expect(page.getByRole("heading", { name: "Capture Target" })).toBeVisible();
      await expect(page.getByLabel("Find in workspace")).toHaveValue("");
      const routedCard = page.locator(".task-card", { hasText: "Route me" });
      await expect(routedCard).toBeVisible();
      await expect(routedCard).not.toContainText("#capture-target");
      await expect(routedCard).toContainText(`${shortDateLabel(localDateKey(1))} at 09:00`);
      await expect(page.getByRole("complementary", { name: "Task details", exact: true }).getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Route me");
    });
  });

  test("quick capture parses weekday and word time without polluting the title", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "natural language capture runs in the desktop project");

    await expectNoConsoleErrors(page, async () => {
      await page.goto("/");
      const nextFriday = nextWeekdayKey(5);

      await page.getByLabel("Quick add task").fill("Plan review Friday noon");
      await expect(page.locator(".quick-schedule-preview")).toContainText("Friday");
      await expect(page.locator(".quick-schedule-preview")).toContainText("12:00 PM");
      await quickAddButton(page, "reminders").click();

      const capturedCard = page.locator(".task-card", { hasText: "Plan review" });
      await expect(capturedCard).toBeVisible();
      await expect(capturedCard).toContainText(`${shortDateLabel(nextFriday)} at 12:00`);
      await expect(capturedCard).not.toContainText("Friday noon");

      const details = page.getByRole("complementary", { name: "Task details", exact: true });
      await expect(details.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Plan review");
      await expect(details.locator('input[aria-label="Due date"]')).toHaveValue(nextFriday);
      await expect(details.locator('input[aria-label="Due time"]')).toHaveValue("12:00");

      await page.reload();
      const persistedCard = page.locator(".task-card", { hasText: "Plan review" });
      await expect(persistedCard).toBeVisible();
      await expect(persistedCard).toContainText(`${shortDateLabel(nextFriday)} at 12:00`);
      await persistedCard.click();
      await expect(details.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Plan review");
    });
  });

  test("quick due chips cover today, next week, common times, and persistence", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "quick due chip coverage runs in the desktop project");

    await expectNoConsoleErrors(page, async () => {
      await page.goto("/");
      const activeRegion = page.getByRole("region", { name: "Active tasks" });
      const today = localDateKey();
      const nextWeek = localDateKey(7);

      await page.getByLabel("Quick add task").fill("Chip schedule proof");
      await quickAddButton(page, "reminders").click();
      const card = activeRegion.locator(".task-card", { hasText: "Chip schedule proof" });
      await expect(card).toBeVisible();
      await card.click();

      const details = page.getByRole("complementary", { name: "Task details", exact: true });
      const dueDate = details.locator('input[aria-label="Due date"]');
      const dueTime = details.locator('input[aria-label="Due time"]');

      await details.getByRole("button", { name: "Today" }).click();
      await expect(dueDate).toHaveValue(today);
      await expect(details.getByRole("button", { name: "Today" })).toHaveAttribute("aria-pressed", "true");

      await details.getByRole("button", { name: "Morning" }).click();
      await expect(dueTime).toHaveValue("09:00");
      await expect(details.getByRole("button", { name: "Morning" })).toHaveAttribute("aria-pressed", "true");
      await expect(card).toContainText(`${shortDateLabel(today)} at 09:00`);

      await details.getByRole("button", { name: "Next week" }).click();
      await expect(dueDate).toHaveValue(nextWeek);
      await expect(details.getByRole("button", { name: "Next week" })).toHaveAttribute("aria-pressed", "true");
      await expect(card).toContainText(`${shortDateLabel(nextWeek)} at 09:00`);

      await details.getByRole("button", { name: "Evening" }).click();
      await expect(dueTime).toHaveValue("17:00");
      await expect(details.getByRole("button", { name: "Evening" })).toHaveAttribute("aria-pressed", "true");
      await expect(card).toContainText(`${shortDateLabel(nextWeek)} at 17:00`);

      await details.getByRole("button", { name: "Any time" }).click();
      await expect(dueDate).toHaveValue(nextWeek);
      await expect(dueTime).toHaveValue("");
      await expect(details.getByRole("button", { name: "Any time" })).toHaveAttribute("aria-pressed", "true");
      await expect(card).toContainText(shortDateLabel(nextWeek));
      await expect(card).not.toContainText("17:00");

      await details.getByRole("button", { name: "Evening" }).click();
      await expect(card).toContainText(`${shortDateLabel(nextWeek)} at 17:00`);

      await page.reload();
      const persistedCard = activeRegion.locator(".task-card", { hasText: "Chip schedule proof" });
      await expect(persistedCard).toBeVisible();
      await expect(persistedCard).toContainText(`${shortDateLabel(nextWeek)} at 17:00`);
      await persistedCard.click();
      await expect(dueDate).toHaveValue(nextWeek);
      await expect(dueTime).toHaveValue("17:00");
    });
  });

  test("duplicate keeps sticky content while making a fresh active copy", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "duplicate workflow runs in the desktop project");

    await expectNoConsoleErrors(page, async () => {
      await page.goto("/");
      const tomorrow = localDateKey(1);
      await page.getByLabel("Quick add task").fill("Reusable setup tomorrow 9am");
      await quickAddButton(page, "reminders").click();

      const details = page.getByRole("complementary", { name: "Task details", exact: true });
      await details.getByRole("textbox", { name: "Details" }).fill("Keep the checklist and schedule.");
      await details.getByRole("textbox", { name: "Details" }).blur();
      const newSubtaskTitle = details.getByLabel("New subtask title");
      const addSubtaskButton = details.getByRole("button", { name: "Add subtask" });
      await newSubtaskTitle.fill("First copied subtask");
      await addSubtaskButton.click();
      await newSubtaskTitle.fill("Second copied subtask");
      await addSubtaskButton.click();
      await details.locator(".subtask-check").first().click();
      await expect(details.locator(".subtask-check.done")).toHaveCount(1);

      await details.getByRole("button", { name: "Duplicate Reusable setup" }).click();
      await expect(page.locator(".toast", { hasText: "Task duplicated" })).toBeVisible();
      await expect(details.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Reusable setup copy");
      await expect(details.getByRole("textbox", { name: "Details" })).toHaveValue("Keep the checklist and schedule.");
      await expect(details.locator('input[aria-label="Due date"]')).toHaveValue(tomorrow);
      await expect(details.locator('input[aria-label="Due time"]')).toHaveValue("09:00");
      await expect(details.locator(".subtask-row")).toHaveCount(2);
      await expect(details.locator(".subtask-check.done")).toHaveCount(0);
      await expect(details.locator(".subtask-row input").first()).toHaveValue("First copied subtask");

      await page.reload();
      const copiedCard = page.locator(".task-card", { hasText: "Reusable setup copy" });
      await expect(copiedCard).toBeVisible();
      await expect(copiedCard).toContainText(`${shortDateLabel(tomorrow)} at 09:00`);

      await copiedCard.click();
      await details.getByRole("button", { name: "Duplicate Reusable setup copy" }).click();
      await expect(details.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Reusable setup copy copy");
    });
  });

  test("duplicate preserves recurrence settings when the source can repeat", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "recurrence duplicate runs in the desktop project");

    await expectNoConsoleErrors(page, async () => {
      await page.goto("/");
      await page.getByLabel("Quick add task").fill("Weekly template");
      await quickAddButton(page, "reminders").click();

      const details = page.getByRole("complementary", { name: "Task details", exact: true });
      await details.getByLabel("Not repeating").check();
      await details.getByLabel("Starts").fill("2026-06-15");
      await details.getByLabel("Frequency").selectOption("weekly");
      await details.getByLabel("Monday").click();
      await details.getByLabel("Ends").selectOption("on_date");
      await details.getByLabel("End date").fill("2026-07-01");
      await expect(details.getByText("Every week on Mon")).toBeVisible();
      await expect(details.getByText("Starts Jun 15, 2026 - Ends Jul 1, 2026")).toBeVisible();

      await page.keyboard.press("Control+K");
      await page.getByLabel("Search commands").fill("duplicate selected");
      await page.keyboard.press("Enter");
      await expect(page.locator(".toast", { hasText: "Task duplicated" })).toBeVisible();
      await expect(details.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Weekly template copy");
      await expect(details.getByLabel("Repeating")).toBeChecked();
      await expect(details.getByText("Every week on Mon")).toBeVisible();
      await expect(details.getByLabel("End date")).toHaveValue("2026-07-01");
      await expect(details.getByText("Starts Jun 15, 2026 - Ends Jul 1, 2026")).toBeVisible();
      await expect(page.locator(".task-card", { hasText: "Weekly template copy" })).toContainText("Every week on Mon");

      await page.reload();
      const copiedCard = page.locator(".task-card", { hasText: "Weekly template copy" });
      await expect(copiedCard).toBeVisible();
      await copiedCard.click();
      await expect(details.getByLabel("Repeating")).toBeChecked();
      await expect(details.getByLabel("End date")).toHaveValue("2026-07-01");
      await expect(details.getByText("Starts Jun 15, 2026 - Ends Jul 1, 2026")).toBeVisible();
    });
  });

  test("monthly and yearly repeats generate clamped next dates", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "recurrence date math runs in the desktop project");

    await expectNoConsoleErrors(page, async () => {
      await page.goto("/");

      const details = page.getByRole("complementary", { name: "Task details", exact: true });
      const activeRegion = page.getByRole("region", { name: "Active tasks" });

      await page.getByLabel("Quick add task").fill("Monthly closeout");
      await quickAddButton(page, "reminders").click();
      await details.locator('input[aria-label="Due date"]').fill("2026-08-31");
      await details.getByLabel("Not repeating").check();
      await details.getByLabel("Frequency").selectOption("monthly");
      await expect(details.getByLabel("Month day")).toHaveValue("31");
      await expect(details.getByText("Every month on day 31")).toBeVisible();

      await details.getByRole("button", { name: "Complete Monthly closeout" }).click();
      await expect(page.locator(".toast", { hasText: "Next repeat: Sep 30, 2026" })).toBeVisible();
      const monthlyRepeat = activeRegion.locator(".task-card", { hasText: "Sep 30" });
      await expect(monthlyRepeat).toContainText("Sep 30");
      await expect(monthlyRepeat).toContainText("Every month on day 31");
      await monthlyRepeat.click();
      await expect(details.locator('input[aria-label="Due date"]')).toHaveValue("2026-09-30");

      await page.getByLabel("Quick add task").fill("Leap review");
      await quickAddButton(page, "reminders").click();
      const leapCard = activeRegion.locator(".task-card", { hasText: "Leap review" });
      await expect(leapCard).toBeVisible();
      await leapCard.click();
      await details.locator('input[aria-label="Due date"]').fill("2028-02-29");
      await details.getByLabel("Not repeating").check();
      await details.getByLabel("Frequency").selectOption("yearly");
      await expect(details.getByLabel("Month day")).toHaveValue("29");
      await expect(details.getByText("Every year on Feb 29")).toBeVisible();

      await details.getByRole("button", { name: "Complete Leap review" }).click();
      await expect(page.locator(".toast", { hasText: "Next repeat: Feb 28, 2029" })).toBeVisible();
      const yearlyRepeat = activeRegion.locator(".task-card", { hasText: "Feb 28" });
      await expect(yearlyRepeat).toContainText("Feb 28");
      await expect(yearlyRepeat).toContainText("Every year on Feb 29");
      await yearlyRepeat.click();
      await expect(details.locator('input[aria-label="Due date"]')).toHaveValue("2029-02-28");
    });
  });

  test("after-count repeats stop when the series is exhausted", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "finite recurrence runs in the desktop project");

    await expectNoConsoleErrors(page, async () => {
      await page.goto("/");

      const startDate = localDateKey(1);
      const secondDate = localDateKey(2);
      const thirdDate = localDateKey(3);
      const details = page.getByRole("complementary", { name: "Task details", exact: true });
      const activeRegion = page.getByRole("region", { name: "Active tasks" });

      await page.getByLabel("Quick add task").fill("Two-shot repeat");
      await quickAddButton(page, "reminders").click();
      await details.locator('input[aria-label="Due date"]').fill(startDate);
      await details.getByLabel("Not repeating").check();
      await details.getByLabel("Ends").selectOption("after_count");
      await details.getByRole("spinbutton", { name: "Count" }).fill("2");
      await expect(details.getByText("Ends after 2 times")).toBeVisible();

      await details.getByRole("button", { name: "Complete Two-shot repeat" }).click();
      await expect(page.locator(".toast", { hasText: "Next repeat:" })).toContainText(shortDateLabel(secondDate));
      const secondOccurrence = activeRegion.locator(".task-card", { hasText: shortDateLabel(secondDate) });
      await expect(secondOccurrence).toContainText("Two-shot repeat");
      await secondOccurrence.click();
      await expect(details.getByText("Ends after 1 time")).toBeVisible();

      await details.getByRole("button", { name: "Complete Two-shot repeat" }).click();
      await expect(activeRegion.locator(".task-card", { hasText: "Two-shot repeat" })).toHaveCount(0);
      await expect(activeRegion.locator(".task-card", { hasText: shortDateLabel(thirdDate) })).toHaveCount(0);
      await expect(page.locator(".toast", { hasText: `Next repeat: ${shortDateLabel(thirdDate)}` })).toHaveCount(0);
    });
  });

  test("selected sticky commands cover color persistence, completion, restore, delete, and undo", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "selected sticky command workflow runs in the desktop project");

    await expectNoConsoleErrors(page, async () => {
      await page.goto("/");
      await page.getByLabel("Quick add task").fill("Command action sticky");
      await quickAddButton(page, "reminders").click();

      const details = page.getByRole("complementary", { name: "Task details", exact: true });
      const activeRegion = page.getByRole("region", { name: "Active tasks" });
      const commandCard = activeRegion.locator(".task-card", { hasText: "Command action sticky" });

      await expect(commandCard).toBeVisible();
      await details.getByLabel("Color").selectOption("violet");
      await expect(commandCard).toHaveClass(/color-violet/);

      await page.reload();
      const persistedCard = page.getByRole("region", { name: "Active tasks" }).locator(".task-card", {
        hasText: "Command action sticky",
      });
      await expect(persistedCard).toHaveClass(/color-violet/);
      await persistedCard.click();
      await expect(details.getByRole("button", { name: "Duplicate Command action sticky" })).toBeVisible();
      await expect(details.getByRole("button", { name: "Complete Command action sticky" })).toBeVisible();
      await expect(details.getByRole("button", { name: "Delete Command action sticky" })).toBeVisible();

      await page.keyboard.press("Control+K");
      await page.getByLabel("Search commands").fill("complete selected");
      await page.keyboard.press("Enter");
      await expect(page.locator(".toast", { hasText: "Task completed" })).toBeVisible();
      await expect(details.getByRole("heading", { name: "Completed task" })).toBeVisible();
      await expect(details.getByRole("button", { name: "Restore Command action sticky" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Active tasks" }).getByText("Command action sticky")).toHaveCount(0);

      await page.keyboard.press("Control+K");
      await page.getByLabel("Search commands").fill("restore selected");
      await page.keyboard.press("Enter");
      await expect(page.getByRole("region", { name: "Active tasks" }).getByText("Command action sticky")).toBeVisible();

      await page.keyboard.press("Control+K");
      await page.getByLabel("Search commands").fill("delete selected");
      await page.keyboard.press("Enter");
      await expect(page.getByRole("dialog").getByText("Delete Command action sticky?")).toBeVisible();
      await page.getByRole("dialog").getByRole("button", { name: "Delete task" }).click();
      await expect(page.getByRole("region", { name: "Active tasks" }).getByText("Command action sticky")).toHaveCount(0);

      const deleteToast = page.locator(".toast", { hasText: "Task deleted" });
      await expect(deleteToast).toBeVisible();
      await deleteToast.getByRole("button", { name: "Undo Task deleted" }).click();
      await expect(page.getByRole("region", { name: "Active tasks" }).locator(".task-card", {
        hasText: "Command action sticky",
      })).toHaveClass(/color-violet/);
    });
  });

  test("route chrome has a polished not-found state", async ({ page }) => {
    await page.goto("/missing-sticky-route");
    await expect(page.getByRole("heading", { name: "Nothing stuck here." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to Sticky" })).toHaveAttribute("href", "/");
  });

  test("auth callback errors are visible on the sign-in shell", async ({ page }) => {
    await expectNoConsoleErrors(page, async () => {
      await page.goto("/?auth_error=Magic%20link%20expired");
      await expect(page.getByRole("heading", { name: "Sign in to Sticky" })).toBeVisible();
      await expect(page.getByText("Magic link expired")).toBeVisible();
      await expect(page.getByText("Your lists are right where you left them.")).toBeVisible();
      await expect(page.getByText("Only approved accounts can open this workspace.")).toBeVisible();
      await expect(page.getByText("sticky.allowed_emails")).toHaveCount(0);
      await expect(page.getByText("row-level security")).toHaveCount(0);
      await expect(page.getByText("Supabase Auth")).toHaveCount(0);
    });
  });

  test("auth shell replaces technical access errors", async ({ page }) => {
    await expectNoConsoleErrors(page, async () => {
      await page.goto("/?auth_error=permission%20denied%20for%20schema%20sticky");
      await expect(page.getByRole("heading", { name: "Sign in to Sticky" })).toBeVisible();
      await expect(
        page.getByText(
          "Sticky could not open this workspace yet. Please try again, or ask the workspace owner to check access.",
        ),
      ).toBeVisible();
      await expect(page.getByText("permission denied")).toHaveCount(0);
      await expect(page.getByText("schema")).toHaveCount(0);
      await expect(page.getByText("row-level security")).toHaveCount(0);
      await expect(page.getByText("Supabase")).toHaveCount(0);
      await expect(page.getByText("sticky.allowed_emails")).toHaveCount(0);
      await expect(page.getByText("NEXT_PUBLIC_SUPABASE")).toHaveCount(0);
    });
  });

  test("auth callback sanitizes technical errors before redirecting", async ({ page }) => {
    await expectNoConsoleErrors(page, async () => {
      await page.goto("/auth/callback?error_description=permission%20denied%20for%20schema%20sticky");
      const redirectedUrl = new URL(page.url());

      expect(redirectedUrl.pathname).toBe("/");
      expect(redirectedUrl.searchParams.get("auth_error")).toBe(GENERIC_STICKY_ACCESS_MESSAGE);
      expect(page.url()).not.toContain("permission");
      expect(page.url()).not.toContain("schema");
      await expect(page.getByRole("heading", { name: "Sign in to Sticky" })).toBeVisible();
      await expect(page.getByText(GENERIC_STICKY_ACCESS_MESSAGE)).toBeVisible();
    });
  });

  test("auth callback preserves the request origin when reporting provider errors", async ({ page }) => {
    await expectNoConsoleErrors(page, async () => {
      await page.goto("/auth/callback?error_description=Provider%20denied");
      await expect(page).toHaveURL(/\/\?auth_error=Provider\+denied$/);
      await expect(page.getByRole("heading", { name: "Sign in to Sticky" })).toBeVisible();
      await expect(page.getByText("Provider denied")).toBeVisible();
    });
  });

  test("recurrence cron route is not publicly invokable", async ({ request }) => {
    const response = await request.get("/api/recurrence/catch-up");
    expect([401, 503]).toContain(response.status());
  });

  test("route responses include production security headers", async ({ request }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "security header check only needs one browser project");

    for (const route of ["/", "/api/recurrence/catch-up"]) {
      const response = await request.get(route);
      const csp = response.headers()["content-security-policy"];

      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("connect-src 'self'");
      expect(csp).toContain("https://*.supabase.co");
      expect(csp).toContain("wss://*.supabase.co");
      expect(response.headers()["strict-transport-security"]).toContain("max-age=63072000");
      expect(response.headers()["x-frame-options"]).toBe("DENY");
      expect(response.headers()["x-content-type-options"]).toBe("nosniff");
      expect(response.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");
      expect(response.headers()["permissions-policy"]).toContain("camera=()");
      expect(response.headers()["cross-origin-opener-policy"]).toBe("same-origin");
      expect(response.headers()["origin-agent-cluster"]).toBe("?1");
      expect(response.headers()["x-dns-prefetch-control"]).toBe("off");
      expect(response.headers()["x-permitted-cross-domain-policies"]).toBe("none");
    }
  });

  test("recurrence cron route stays disabled without an admin secret", async ({ request }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "cron credential check only needs one browser project");

    const baseURL = String(testInfo.project.use.baseURL ?? "");
    test.skip(
      !/^(http:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?/.test(baseURL),
      "disabled cron check only runs against the local test server",
    );

    const response = await request.get("/api/recurrence/catch-up?limit=1", {
      headers: {
        Authorization: `Bearer ${TEST_CRON_SECRET}`,
      },
    });
    const body = await response.json();

    test.skip(
      response.status() === 503 && body?.error === "CRON_SECRET is not configured.",
      "existing local server does not include the Playwright cron secret",
    );

    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(body).toMatchObject({
      ok: true,
      disabled: true,
      reason: "Supabase server secret is not configured.",
    });
  });

  test("install manifest advertises real shortcuts and screenshots", async ({ request }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "install manifest check only needs one browser project");

    const manifestResponse = await request.get("/manifest.webmanifest");
    expect(manifestResponse.status()).toBe(200);
    expect(manifestResponse.headers()["content-type"]).toContain("application/manifest+json");

    const manifest = (await manifestResponse.json()) as {
      display_override?: string[];
      launch_handler?: { client_mode?: string[] };
      screenshots?: Array<{ src: string; form_factor?: string; sizes?: string }>;
      shortcuts?: Array<{ name: string; url: string }>;
    };

    expect(manifest.display_override).toEqual(["window-controls-overlay", "standalone", "minimal-ui"]);
    expect(manifest.launch_handler?.client_mode).toEqual(["focus-existing", "navigate-existing"]);
    expect(manifest.shortcuts?.map((shortcut) => shortcut.url)).toEqual([
      "/?intent=capture",
      "/?view=today",
      "/?view=scheduled",
      "/?intent=search",
    ]);
    expect(manifest.shortcuts?.map((shortcut) => shortcut.name)).toEqual([
      "Quick Capture",
      "Today View",
      "Scheduled View",
      "Search Sticky",
    ]);
    expect(manifest.screenshots).toEqual([
      expect.objectContaining({
        src: "/install-screenshot-wide",
        sizes: "1280x720",
        form_factor: "wide",
      }),
      expect.objectContaining({
        src: "/install-screenshot-narrow",
        sizes: "390x844",
        form_factor: "narrow",
      }),
    ]);

    for (const route of ["/install-screenshot-wide", "/install-screenshot-narrow"]) {
      const response = await request.get(route);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toContain("image/png");
      expect((await response.body()).length).toBeGreaterThan(10_000);
    }
  });

  test("install shortcuts open useful workspace intents", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "launch intent check only needs one browser project");

    await expectNoConsoleErrors(page, async () => {
      await page.goto("/?intent=capture");
      await expect(page.getByRole("heading", { name: "reminders", exact: true })).toBeVisible();
      await expect(page.getByLabel("Quick add task")).toBeFocused();

      await page.goto("/?intent=search");
      await expect(page.getByRole("heading", { name: "reminders", exact: true })).toBeVisible();
      await expect(page.getByLabel("Find in workspace")).toBeFocused();

      await page.goto("/?view=today");
      await expect(page.getByRole("heading", { name: "reminders", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Current task view: Today, 2 tasks" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );

      await page.goto("/?view=scheduled");
      await expect(page.getByRole("heading", { name: "reminders", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Current task view: Scheduled, 2 tasks" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
  });

  test("generated social preview images are available", async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "metadata route check only needs one browser project");

    for (const route of ["/opengraph-image", "/twitter-image"]) {
      const response = await request.get(route);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toContain("image/png");
      expect((await response.body()).length).toBeGreaterThan(10_000);
    }

    await page.goto("/");
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /opengraph-image/);
    await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute("content", /twitter-image/);
    await expect(page.locator('meta[property="og:image:alt"]')).toHaveAttribute("content", /premium sticky tasks/i);
  });
});
