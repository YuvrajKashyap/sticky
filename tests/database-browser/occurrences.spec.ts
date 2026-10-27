import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createTestOwner, testEnvironment } from "../database/fixtures";
import { zonedDateKeyAt } from "../../packages/domain/src/daily-agenda";

test("dashboard retires yesterday and history corrects only that occurrence", async ({ page, context }, testInfo) => {
  const owner = await createTestOwner();
  try {
    const { url, key, admin } = testEnvironment();
    const cookies: Array<{ name: string; value: string }> = [];
    const auth = createServerClient(url, key, { cookies: { getAll: () => cookies, setAll: values => { cookies.splice(0, cookies.length, ...values); } } });
    expect((await auth.auth.setSession(owner.session)).error).toBeNull();
    await context.addCookies(cookies.map(({ name, value }) => ({ name, value, domain: "localhost", path: "/" })));
    const today = zonedDateKeyAt(new Date(), "America/Chicago");
    const previous = new Date(`${today}T12:00:00Z`); previous.setUTCDate(previous.getUTCDate() - 1);
    const yesterday = previous.toISOString().slice(0, 10);
    const id = randomUUID(), taskId = randomUUID();
    expect((await admin.from("tasks").insert([
      { id: taskId, user_id: owner.userId, list_id: owner.listId, title: "Morning practice", due_date: yesterday, timezone: "America/Chicago" },
      { id: randomUUID(), user_id: owner.userId, list_id: owner.listId, title: "Submit expense form", due_date: yesterday, timezone: "America/Chicago" },
    ])).error).toBeNull();
    expect((await admin.from("task_recurrence_rules").insert({ id, task_id: taskId, user_id: owner.userId, starts_on: yesterday, frequency: "daily" })).error).toBeNull();
    // Known pre-existing occurrence, rather than uncertain migrated history.
    await admin.from("tasks").update({ occurrence_status: "pending" }).eq("id", taskId);
    await admin.from("routine_templates").update({ tracking_since: yesterday, scan_from: yesterday }).eq("id", id);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/");
    await expect(page.locator(".task-card", { hasText: "Morning practice" })).toHaveCount(1);
    await expect(page.locator(".task-card", { hasText: "Morning practice" })).toContainText("Today");
    await expect(page.locator(".task-card", { hasText: "Submit expense form" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("dashboard.png"), fullPage: true });
    const todayBefore = await owner.client.from("tasks").select("*").eq("routine_id", id).eq("scheduled_date", today).single();
    expect(todayBefore.error).toBeNull();
    await page.getByRole("button", { name: "Show calendar view", exact: true }).click();
    const yesterdayLabel = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).format(previous);
    await page.getByRole("button", { name: `Show ${yesterdayLabel}`, exact: true }).click();
    const calendarOccurrence = page.locator(`.calendar-agenda-task[data-key="tk-${taskId}"]`);
    await expect(calendarOccurrence).toBeVisible();
    await expect(calendarOccurrence).toHaveClass(/overdue/);
    await expect(calendarOccurrence).toContainText("not completed");
    await calendarOccurrence.click();
    await expect(page.getByRole("complementary", { name: "Task details" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Show board view", exact: true }).click();
    await expect(page.locator(".task-card", { hasText: "Morning practice" })).toHaveCount(1);
    await page.getByRole("button", { name: "Routine history", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Routine history", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("not completed", { exact: true })).toBeVisible();
    await dialog.getByLabel(`Status for ${yesterday}`, { exact: true }).selectOption("completed");
    await expect(dialog.getByText("1 completed · 100% completion", { exact: true })).toBeVisible();
    await expect.poll(async () => (await owner.client.from("tasks").select("is_completed").eq("id", taskId).single()).data?.is_completed).toBe(true);
    const todayAfter = await owner.client.from("tasks").select("*").eq("id", todayBefore.data!.id).single();
    expect(todayAfter.data).toEqual(todayBefore.data);
    await page.screenshot({ path: testInfo.outputPath("routine-history.png"), fullPage: true });
    const box = await dialog.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await dialog.getByRole("button", { name: "Close routine history" }).click();
    await page.reload();
    await expect(page.locator(".task-card", { hasText: "Morning practice" })).toHaveCount(1);
    expect(errors).toEqual([]);
  } finally {
    await page.goto("about:blank"); await context.clearCookies(); await owner.cleanup();
  }
});
