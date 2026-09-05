import { expect, test } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createTestOwner, testEnvironment } from "../database/fixtures";

test("saved tasks and completed history survive reload and reconnect", async ({ page, context }) => {
  const owner = await createTestOwner();
  try {
    const { url, key, admin } = testEnvironment();
    const cookies: Array<{ name: string; value: string }> = [];
    const auth = createServerClient(url, key, { cookies: { getAll: () => cookies, setAll: (values) => { cookies.splice(0, cookies.length, ...values); } } });
    const session = await auth.auth.setSession(owner.session);
    expect(session.error).toBeNull();
    await context.addCookies(cookies.map(({ name, value }) => ({ name, value, domain: "localhost", path: "/" })));
    const seeded = await admin.from("tasks").insert([
      { user_id: owner.userId, list_id: owner.listId, title: "Active verification task", is_completed: false, completed_at: null },
      { user_id: owner.userId, list_id: owner.listId, title: "Completed verification task", is_completed: true, completed_at: new Date().toISOString() },
    ]);
    expect(seeded.error).toBeNull();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await expect(page.getByText("Active verification task", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Completed verification task", { exact: true })).toHaveCount(0);
    const pile = page.getByRole("button", { name: /^Completed/ }).first();
    await pile.click();
    await expect(page.getByText("Completed verification task", { exact: true }).first()).toBeVisible();
    await page.reload();
    await expect(page.getByText("Completed verification task", { exact: true }).first()).toBeVisible();

    // Simulate a missed broadcast while backgrounded. Focus must reload children,
    // not just parent tasks, using the same authoritative read path as reconnect.
    const task = await owner.client.from("tasks").select("id").eq("title", "Active verification task").single();
    const child = await admin.from("subtasks").insert({ user_id: owner.userId, task_id: task.data!.id, title: "Reconnected step" });
    expect(child.error).toBeNull();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.getByText("Active verification task", { exact: true }).first().click();
    await expect(page.locator('input[value="Reconnected step"]')).toBeVisible();
    const details = page.getByRole("complementary", { name: "Task details", exact: true });
    await details.getByRole("textbox", { name: "Title", exact: true }).fill("Persisted browser edit");
    await details.getByRole("textbox", { name: "Title", exact: true }).blur();
    await expect.poll(async () => {
      const result = await owner.client.from("tasks").select("title").eq("id", task.data!.id).single();
      return result.data?.title;
    }).toBe("Persisted browser edit");
    await details.getByRole("button", { name: "Complete Persisted browser edit", exact: true }).click();
    await expect.poll(async () => {
      const result = await owner.client.from("tasks").select("is_completed").eq("id", task.data!.id).single();
      return result.data?.is_completed;
    }).toBe(true);
    await page.reload();
    await expect(page.getByText("Persisted browser edit", { exact: true }).first()).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await page.goto("about:blank");
    await context.clearCookies();
    await owner.cleanup();
  }
});
