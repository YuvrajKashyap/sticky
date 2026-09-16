import { expect, test } from "@playwright/test";

test("overdue children are independently counted, actionable, and shown in calendar", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".save-status")).toContainText("Local demo saved");
  await page.evaluate(() => {
    const key = "sticky.demo.workspace.v2";
    const data = JSON.parse(localStorage.getItem(key)!);
    const today = new Date();
    const date = (offset: number) => {
      const d = new Date(today); d.setDate(d.getDate() + offset);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    const parent = { ...data.tasks[0], title: "Project context", dueDate: date(7), isCompleted: false };
    data.tasks = [parent];
    data.lists = data.lists.filter((list: { id: string }) => list.id === parent.listId);
    data.subtasks = [
      ["late-one", "Overdue child one", -2, false],
      ["late-two", "Overdue child two", -1, false],
      ["later", "Future sibling", 5, false],
      ["done", "Finished sibling", -3, true],
    ].map(([id, title, offset, done], i) => ({ id, title, taskId: parent.id, userId: parent.userId, dueDate: date(offset as number), isCompleted: done, completedAt: done ? today.toISOString() : null, sortOrder: i * 1000, createdAt: today.toISOString(), updatedAt: today.toISOString() }));
    data.recurrenceRules = [];
    data.preferences.taskViewFilter = "overdue";
    data.userState = { selectedListId: parent.listId, searchQuery: "" };
    localStorage.setItem(key, JSON.stringify(data));
  });
  await page.reload();
  await expect(page.locator(".save-status")).toContainText("Local demo saved");
  await expect(page.getByRole("button", { name: "Current task view: Overdue, 2 tasks" })).toBeVisible();
  const board = page.getByRole("region", { name: "Active tasks", exact: true });
  await expect(board.getByText("Project context", { exact: true })).toBeVisible();
  await expect(board.getByText("Overdue child one", { exact: true })).toBeVisible();
  await expect(board.getByText("Future sibling", { exact: true })).toHaveCount(0);
  await expect(board.getByText("Finished sibling", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: `test-results/subtask-filter-${test.info().project.name}.png` });
  await board.getByRole("button", { name: "Complete subtask: Overdue child one", exact: true }).click();
  await expect(page.getByRole("button", { name: "Current task view: Overdue, 1 task", exact: true })).toBeVisible();
  await board.getByRole("button", { name: "Edit subtask: Overdue child two", exact: true }).click();
  await expect(page.locator('.subtask-title')).toHaveCount(1);
  await expect(page.locator('.subtask-title')).toHaveValue("Overdue child two");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Show calendar view" }).click();
  await page.getByRole("button", { name: "Week", exact: true }).click();
  if (await page.evaluate(() => new Date().getDay() === 0)) await page.getByRole("button", { name: "Previous week", exact: true }).click();
  await expect(page.locator(".calendar-week-view")).toContainText("Overdue child two");
  await expect(page.locator(".calendar-week-view")).toContainText("Project context");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Show board view", exact: true }).click();
  await page.getByRole("button", { name: /^Show task view: All,/ }).click();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await board.getByRole("button", { name: "Complete Project context", exact: true }).click();
  const context = board.locator(".task-card", { hasText: "Project context" });
  await expect(context).toHaveAttribute("data-context-only", "true");
  await expect(board.getByText("Overdue child two", { exact: true })).toBeVisible();
  await page.locator(".completed-toggle").click();
  await page.getByRole("button", { name: "Restore Project context", exact: true }).click();
  await expect(context).not.toHaveClass(/completing/);
});
