import { expect, test, type Locator, type Page } from "@playwright/test";

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

async function expectNoPartiallyVisibleListTabs(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const stack = document.querySelector(".list-stack");
        const tabs = Array.from(document.querySelectorAll(".list-tab-wrap"));
        if (!stack) {
          return false;
        }

        const stackBox = stack.getBoundingClientRect();
        return tabs.every((tab) => {
          const tabBox = tab.getBoundingClientRect();
          const visibleWidth =
            Math.min(tabBox.right, stackBox.right) - Math.max(tabBox.left, stackBox.left);

          if (visibleWidth <= 1) {
            return true;
          }

          return visibleWidth >= tabBox.width - 1;
        });
      }),
    )
    .toBe(true);
}

function quickAddButton(page: Page, listName: string) {
  return page.getByRole("button", { name: `Add sticky to ${listName}` });
}

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

  test("desktop workflow covers lists, tasks, subtasks, due dates, recurrence, completed pile, and persistence", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "full workflow runs in the desktop project");
    test.setTimeout(60_000);

    await expectNoConsoleErrors(page, async () => {
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Workspace" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: "Open list Today, 3 active stickies, 1 completed sticky, current list",
        }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Current task view: All, 3 stickies" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Current task sort: Custom order" })).toBeVisible();
      await expectSingleLine(page.locator(".workspace-title h2"));
      await expectNoHorizontalOverflow(page);
      await expect(page.locator(".save-status")).toContainText("Local demo saved");
      await page.waitForFunction(() => document.readyState === "complete");
      await page.keyboard.press("KeyN");
      await expect(page.getByLabel("Quick add sticky")).toBeFocused();
      await page.getByRole("button", { name: "Compact" }).click();
      await page.getByRole("button", { name: "Use dark color mode" }).click();
      await expect(page.locator(".sticky-app")).toHaveClass(/density-compact/);
      await expect(page.locator(".sticky-app")).toHaveClass(/tone-dark/);
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
      await commandSearch.fill("light color");
      await page.keyboard.press("Enter");
      await expect(page.locator(".sticky-app")).toHaveClass(/tone-light/);
      await page.keyboard.press("Control+K");
      await expect(commandSearch).toHaveValue("");
      await commandSearch.fill("dark color");
      await page.keyboard.press("Enter");
      await expect(page.locator(".sticky-app")).toHaveClass(/tone-dark/);
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
          name: "Open list Verification, 0 active stickies, 0 completed stickies, current list",
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
          name: "Open list Verification Prime, 0 active stickies, 0 completed stickies, current list",
        }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Rename current list Verification Prime" })).toBeFocused();

      await page.getByRole("button", { name: "New list" }).click();
      await page.getByRole("textbox", { name: "Name" }).fill("Move Target");
      await page.getByText("Mint", { exact: true }).click();
      await page.getByRole("button", { name: "Save list" }).click();
      await expect(page.getByRole("heading", { name: "Move Target" })).toBeVisible();
      let moveTargetTab = page.locator(".list-tab-wrap", { hasText: "Move Target" });
      await expect(
        moveTargetTab.getByRole("button", { name: /Move list named Move Target down/ }),
      ).toBeDisabled();
      await moveTargetTab.getByRole("button", { name: /Move list named Move Target up/ }).click();
      await expectTextBefore(page, ".list-tab-name", "Move Target", "Verification Prime");
      moveTargetTab = page.locator(".list-tab-wrap", { hasText: "Move Target" });
      await moveTargetTab.getByRole("button", { name: /Move list named Move Target down/ }).click();
      await expectTextBefore(page, ".list-tab-name", "Verification Prime", "Move Target");
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
      await expect(page.getByLabel("Search current list")).toBeFocused();

      await dragBetween(
        page,
        page.locator(".list-tab-wrap", { hasText: "Move Target" }).locator(".drag-handle"),
        page.locator(".list-tab-wrap", { hasText: "Verification Prime" }).locator(".drag-handle"),
      );
      await expectTextBefore(page, ".list-tab-name", "Move Target", "Verification Prime");

      await page.locator("button.list-tab", { hasText: "Verification Prime" }).click();
      await page.getByLabel("Quick add sticky").fill("Write the verification sticky");
      await quickAddButton(page, "Verification Prime").click();
      await expect(page.getByText("Write the verification sticky")).toBeVisible();

      await page.getByLabel("Quick add sticky").fill("Second order sticky");
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
      const completedToggle = page.getByRole("button", { name: /Completed/ });
      await expect(completedToggle).toHaveAttribute("aria-controls", "completed-stickies-list");
      await expect(completedToggle).toHaveAttribute("aria-expanded", "false");
      await completedToggle.click();
      await expect(completedToggle).toHaveAttribute("aria-expanded", "true");
      await expect(page.locator("#completed-stickies-list")).toBeVisible();
      const initialCompletedRegion = page.getByRole("region", { name: "Completed stickies" });
      await expect(initialCompletedRegion.getByRole("button", { name: "Second order sticky", exact: true })).toBeVisible();
      await initialCompletedRegion.getByRole("button", { name: /Restore Second order sticky/ }).click();
      await expect(page.getByRole("region", { name: "Active stickies" }).getByText("Second order sticky")).toBeVisible();
      await completedToggle.click();
      await expect(completedToggle).toHaveAttribute("aria-expanded", "false");

      const smartTomorrow = localDateKey(1);
      await page.getByLabel("Quick add sticky").fill("Smart parsed sticky tomorrow 2pm");
      await expect(page.locator(".quick-schedule-preview")).toContainText("Tomorrow");
      await expect(page.locator(".quick-schedule-preview")).toContainText("2:00 PM");
      await quickAddButton(page, "Verification Prime").click();
      const smartCard = page.locator(".task-card", { hasText: "Smart parsed sticky" });
      await expect(smartCard).toBeVisible();
      await expect(smartCard).toContainText(`${shortDateLabel(smartTomorrow)} at 14:00`);
      await expect(smartCard).not.toContainText("tomorrow 2pm");

      await page.getByText("Write the verification sticky").click();
      const details = page.getByLabel("Sticky details");
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
      const filteredActiveRegion = page.getByRole("region", { name: "Active stickies" });
      const taskViews = page.locator(".task-filter-bar");
      await taskViews.getByRole("button", { name: /Today/ }).click();
      await expect(taskViews.getByRole("button", { name: "Current task view: Today, 0 stickies" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(filteredActiveRegion.getByText("Verification sticky polished")).toHaveCount(0);

      await page.getByRole("button", { name: /Scheduled/ }).click();
      await expect(taskViews.getByRole("button", { name: "Current task view: Scheduled, 2 stickies" })).toHaveAttribute(
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
      await expect(page.getByText(/Reordering is locked while search, filters, or due-date sorting are active/)).toBeVisible();
      await page.getByRole("button", { name: /All/ }).click();
      await expect(taskViews.getByRole("button", { name: "Current task view: All, 3 stickies" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(filteredActiveRegion.getByText("Second order sticky")).toBeVisible();
      await page.getByRole("button", { name: "Sort stickies by due date" }).click();
      await expect(page.getByRole("button", { name: "Current task sort: Due date" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expectTextBefore(page, ".task-title", "Smart parsed sticky", "Verification sticky polished");
      await expect(
        filteredActiveRegion.locator(".task-card", { hasText: "Smart parsed sticky" }).getByRole("button", {
          name: /Move Smart parsed sticky up/,
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
      await expect(details.locator(".subtask-row input").first()).toHaveValue("Second subtask");
      const reorderedSubtaskRow = details.locator(".subtask-row").first();
      await reorderedSubtaskRow.getByRole("button", { name: "Complete subtask: Second subtask" }).click();
      await expect(
        reorderedSubtaskRow.getByRole("button", { name: "Restore subtask: Second subtask" }),
      ).toBeVisible();
      await reorderedSubtaskRow.getByRole("button", { name: "Delete subtask: Second subtask" }).click();
      await expect(details.locator(".subtask-row")).toHaveCount(1);
      const subtaskDeleteToast = page.getByRole("group", { name: /Subtask deleted: Second subtask/ });
      await expect(subtaskDeleteToast).toBeVisible();
      await expect(subtaskDeleteToast.getByRole("button", { name: "Dismiss Subtask deleted" })).toBeVisible();
      await subtaskDeleteToast.getByRole("button", { name: "Undo Subtask deleted" }).click();
      await expect(details.locator(".subtask-row")).toHaveCount(2);
      await expect(details.getByLabel("Not repeating")).toBeDisabled();
      await expect(details.getByLabel("Not repeating")).toHaveAccessibleDescription(
        "Repeating stickies cannot have subtasks. Remove subtasks first.",
      );

      await details.getByLabel("List").selectOption({ label: "Move Target" });
      await page.locator("button.list-tab", { hasText: "Move Target" }).click();
      const activeRegion = page.getByRole("region", { name: "Active stickies" });
      await expect(activeRegion.getByText("Verification sticky polished")).toBeVisible();

      const twoDaysAgo = localDateKey(-2);
      const today = localDateKey();
      await page.getByLabel("Quick add sticky").fill("Overdue repeat catch-up");
      await quickAddButton(page, "Move Target").click();
      await activeRegion.getByText("Overdue repeat catch-up").click();
      await details.locator('input[aria-label="Due date"]').fill(twoDaysAgo);
      await details.locator('input[aria-label="Due time"]').fill("08:00");
      await details.getByLabel("Not repeating").check();
      await expect(page.getByText(/1 repeating sticky behind schedule/)).toBeVisible();
      await expect(details.getByText(/Behind schedule/)).toBeVisible();
      await details.getByRole("button", { name: "Advance repeat" }).click();
      await expect(page.getByText("Repeats caught up")).toBeVisible();
      await expect(page.locator(".task-card", { hasText: "Overdue repeat catch-up" })).toContainText(
        `${shortDateLabel(today)} at 08:00`,
      );
      await expect(page.getByText(/behind schedule/)).toHaveCount(0);

      await page.getByLabel("Quick add sticky").fill("Repeat without subtasks");
      await quickAddButton(page, "Move Target").click();
      await activeRegion.getByText("Repeat without subtasks").click();
      await details.getByLabel("Not repeating").check();
      const repeatSubtaskTitle = details.getByLabel("New subtask title");
      const repeatAddSubtaskButton = details.getByRole("button", { name: "Add subtask" });
      await expect(repeatSubtaskTitle).toBeDisabled();
      await expect(repeatSubtaskTitle).toHaveAccessibleDescription(
        "Repeating stickies do not support subtasks. Remove repeat to add subtasks.",
      );
      await expect(repeatAddSubtaskButton).toBeDisabled();
      await expect(repeatAddSubtaskButton).toHaveAccessibleDescription(
        "Repeating stickies do not support subtasks. Remove repeat to add subtasks.",
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
      await page.getByRole("button", { name: /Completed/ }).click();
      const completedRegion = page.getByRole("region", { name: "Completed stickies" });
      await expect(completedRegion.getByRole("button", { name: "Repeat without subtasks", exact: true })).toBeVisible();
      const generatedRepeatCard = activeRegion.locator(".task-card", { hasText: "Jun 22" });
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

      await page.getByRole("button", { name: /Delete Move Target/ }).click();
      await page.getByRole("button", { name: "Delete list" }).click();
      await expect(page.locator("button.list-tab", { hasText: "Move Target" })).toHaveCount(0);
      const listDeleteToast = page.getByRole("group", { name: /List deleted: Move Target/ });
      await expect(listDeleteToast).toBeVisible();
      await listDeleteToast.getByRole("button", { name: "Undo List deleted" }).click();
      await expect(page.locator("button.list-tab", { hasText: "Move Target" })).toBeVisible();
      await expect(activeRegion.getByText("Verification sticky polished")).toBeVisible();

      await page.getByRole("button", { name: /Delete Move Target/ }).click();
      await page.getByRole("button", { name: "Delete list" }).click();
      await expect(page.locator("button.list-tab", { hasText: "Move Target" })).toHaveCount(0);

      await page.reload();
      await expect(page.locator("button.list-tab", { hasText: "Verification Prime" })).toBeVisible();
      await expect(page.locator(".sticky-app")).toHaveClass(/density-compact/);
      await expect(page.locator(".sticky-app")).toHaveClass(/tone-dark/);
    });
  });

  test("mobile layout keeps the workspace usable", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "mobile layout check runs in the mobile project");

    await expectNoConsoleErrors(page, async () => {
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
      await expectSingleLine(page.locator(".workspace-title h2"));
      await expectNoHorizontalOverflow(page);
      await expect(page.locator(".save-status")).toContainText("Local demo saved");
      await expectNoPartiallyVisibleListTabs(page);
      const launchTab = page.locator(".list-tab-wrap", { hasText: "Launch polish" });
      await launchTab.scrollIntoViewIfNeeded();
      await expectNoInlineClip(launchTab.locator(".list-tab-name"));
      await expect(
        launchTab.getByRole("button", { name: /Move list named Launch polish up/ }),
      ).toBeVisible();
      await expect(
        launchTab.getByRole("button", { name: /Move list named Launch polish down/ }),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.getByRole("button", { name: "Open command center" }).click();
      await expect(page.getByRole("dialog", { name: "Command center" })).toBeVisible();
      await page.getByLabel("Search commands").fill("capture");
      await page.keyboard.press("Enter");
      await expect(page.getByLabel("Quick add sticky")).toBeFocused();
      await page.getByLabel("Quick add sticky").fill("Mobile capture");
      await quickAddButton(page, "Today").click();
      await expect(page.getByText("Mobile capture")).toBeVisible();
      const mobileDetails = page.getByLabel("Sticky details");
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
      await expect(page.getByRole("button", { name: "Compact" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Use dark color mode" })).toBeVisible();
    });
  });

  test("task view and sort preferences survive reload", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "view preference persistence runs in the desktop project");

    await expectNoConsoleErrors(page, async () => {
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
      const taskViews = page.locator(".task-filter-bar");

      await taskViews.getByRole("button", { name: /Today/ }).click();
      await page.getByRole("button", { name: "Sort stickies by due date" }).click();
      await expect(taskViews.getByRole("button", { name: "Current task view: Today, 2 stickies" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(page.getByRole("button", { name: "Current task sort: Due date" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(page.getByText(/Reordering is locked while search, filters, or due-date sorting are active/)).toBeVisible();

      await page.reload();
      await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
      await expect(taskViews.getByRole("button", { name: "Current task view: Today, 2 stickies" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(page.getByRole("button", { name: "Current task sort: Due date" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(page.getByText(/Reordering is locked while search, filters, or due-date sorting are active/)).toBeVisible();
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

      await page.locator("button.list-tab", { hasText: "Today" }).click();
      await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
      await page.getByLabel("Search current list").fill("nothing matches this");
      await page.getByLabel("Quick add sticky").fill("Route me #capture-target tomorrow 9am");
      await expect(page.locator(".quick-schedule-preview")).toContainText("Capture Target");
      await expect(page.locator(".quick-schedule-preview")).toContainText("Tomorrow");
      await expect(page.locator(".quick-schedule-preview")).toContainText("9:00 AM");
      await quickAddButton(page, "Capture Target").click();

      await expect(page.getByRole("heading", { name: "Capture Target" })).toBeVisible();
      await expect(page.getByLabel("Search current list")).toHaveValue("");
      const routedCard = page.locator(".task-card", { hasText: "Route me" });
      await expect(routedCard).toBeVisible();
      await expect(routedCard).not.toContainText("#capture-target");
      await expect(routedCard).toContainText(`${shortDateLabel(localDateKey(1))} at 09:00`);
      await expect(page.getByLabel("Sticky details").getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Route me");
    });
  });

  test("quick capture parses weekday and word time without polluting the title", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "natural language capture runs in the desktop project");

    await expectNoConsoleErrors(page, async () => {
      await page.goto("/");
      const nextFriday = nextWeekdayKey(5);

      await page.getByLabel("Quick add sticky").fill("Plan review Friday noon");
      await expect(page.locator(".quick-schedule-preview")).toContainText("Friday");
      await expect(page.locator(".quick-schedule-preview")).toContainText("12:00 PM");
      await quickAddButton(page, "Today").click();

      const capturedCard = page.locator(".task-card", { hasText: "Plan review" });
      await expect(capturedCard).toBeVisible();
      await expect(capturedCard).toContainText(`${shortDateLabel(nextFriday)} at 12:00`);
      await expect(capturedCard).not.toContainText("Friday noon");

      const details = page.getByLabel("Sticky details");
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

  test("duplicate keeps sticky content while making a fresh active copy", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "duplicate workflow runs in the desktop project");

    await expectNoConsoleErrors(page, async () => {
      await page.goto("/");
      const tomorrow = localDateKey(1);
      await page.getByLabel("Quick add sticky").fill("Reusable setup tomorrow 9am");
      await quickAddButton(page, "Today").click();

      const details = page.getByLabel("Sticky details");
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
      await expect(page.locator(".toast", { hasText: "Sticky duplicated" })).toBeVisible();
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
      await page.getByLabel("Quick add sticky").fill("Weekly template");
      await quickAddButton(page, "Today").click();

      const details = page.getByLabel("Sticky details");
      await details.getByLabel("Not repeating").check();
      await details.getByLabel("Starts").fill("2026-06-15");
      await details.getByLabel("Frequency").selectOption("weekly");
      await details.getByLabel("Monday").click();
      await expect(details.getByText("Every week on Mon")).toBeVisible();

      await page.keyboard.press("Control+K");
      await page.getByLabel("Search commands").fill("duplicate selected");
      await page.keyboard.press("Enter");
      await expect(page.locator(".toast", { hasText: "Sticky duplicated" })).toBeVisible();
      await expect(details.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Weekly template copy");
      await expect(details.getByLabel("Repeating")).toBeChecked();
      await expect(details.getByText("Every week on Mon")).toBeVisible();
      await expect(page.locator(".task-card", { hasText: "Weekly template copy" })).toContainText("Every week on Mon");
    });
  });

  test("selected sticky commands cover color persistence, completion, restore, delete, and undo", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "selected sticky command workflow runs in the desktop project");

    await expectNoConsoleErrors(page, async () => {
      await page.goto("/");
      await page.getByLabel("Quick add sticky").fill("Command action sticky");
      await quickAddButton(page, "Today").click();

      const details = page.getByLabel("Sticky details");
      const activeRegion = page.getByRole("region", { name: "Active stickies" });
      const commandCard = activeRegion.locator(".task-card", { hasText: "Command action sticky" });

      await expect(commandCard).toBeVisible();
      await details.getByLabel("Color").selectOption("violet");
      await expect(commandCard).toHaveClass(/color-violet/);

      await page.reload();
      const persistedCard = page.getByRole("region", { name: "Active stickies" }).locator(".task-card", {
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
      await expect(page.locator(".toast", { hasText: "Sticky completed" })).toBeVisible();
      await expect(details.getByRole("heading", { name: "Completed sticky" })).toBeVisible();
      await expect(details.getByRole("button", { name: "Restore Command action sticky" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Active stickies" }).getByText("Command action sticky")).toHaveCount(0);

      await page.keyboard.press("Control+K");
      await page.getByLabel("Search commands").fill("restore selected");
      await page.keyboard.press("Enter");
      await expect(page.getByRole("region", { name: "Active stickies" }).getByText("Command action sticky")).toBeVisible();

      await page.keyboard.press("Control+K");
      await page.getByLabel("Search commands").fill("delete selected");
      await page.keyboard.press("Enter");
      await expect(page.getByRole("dialog").getByText("Delete Command action sticky?")).toBeVisible();
      await page.getByRole("dialog").getByRole("button", { name: "Delete sticky" }).click();
      await expect(page.getByRole("region", { name: "Active stickies" }).getByText("Command action sticky")).toHaveCount(0);

      const deleteToast = page.locator(".toast", { hasText: "Sticky deleted" });
      await expect(deleteToast).toBeVisible();
      await deleteToast.getByRole("button", { name: "Undo Sticky deleted" }).click();
      await expect(page.getByRole("region", { name: "Active stickies" }).locator(".task-card", {
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
      await expect(page.getByText("Tactile planning")).toBeVisible();
      await expect(page.getByText("Private by default")).toBeVisible();
      await expect(page.getByText("sticky.allowed_emails")).toHaveCount(0);
      await expect(page.getByText("row-level security")).toHaveCount(0);
      await expect(page.getByText("Supabase Auth")).toHaveCount(0);
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
