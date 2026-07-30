import type { ActorContext } from "@sticky/contracts";
import { describe, expect, it } from "vitest";
import { StickyRepository } from "./repository";

const actor: ActorContext = {
  userId: "9cb0a6f8-f2f7-498a-80a1-bafbd929adf9",
  actorType: "human",
  actorId: "9cb0a6f8-f2f7-498a-80a1-bafbd929adf9",
  credentialId: null,
  scopes: new Set(["tasks:read", "tasks:write", "tasks:destructive"]),
  requestId: "request-1",
  idempotencyKey: "delete-reminder-1",
  providerUserId: null,
  accessToken: "test-access-token",
};

describe("StickyRepository reminders", () => {
  it("deletes a reminder only inside the current owner's scope and records the activity", async () => {
    const reminderId = "0d5792f2-b0cb-40d4-95df-feb93e9c53a8";
    const taskId = "930f4ce0-e06c-4a55-a7df-6e643b461245";
    const filters: Array<[string, unknown]> = [];
    let activityPayload: Record<string, unknown> | undefined;
    const reminderQuery = {
      delete: () => reminderQuery,
      eq: (field: string, value: unknown) => {
        filters.push([field, value]);
        return reminderQuery;
      },
      select: () => reminderQuery,
      maybeSingle: async () => ({ data: { task_id: taskId }, error: null }),
    };
    const activityQuery = {
      insert: async (payload: Record<string, unknown>) => {
        activityPayload = payload;
        return { error: null };
      },
    };
    const db = {
      from: (table: string) => table === "task_reminders" ? reminderQuery : activityQuery,
    };

    const repository = new StickyRepository(db as never);
    await repository.deleteReminder(actor, reminderId);

    expect(filters).toEqual([
      ["id", reminderId],
      ["user_id", actor.userId],
    ]);
    expect(activityPayload).toMatchObject({
      action: "reminder.deleted",
      task_id: taskId,
      actor_type: "human",
      metadata: { deletedReminderId: reminderId },
    });
  });
});
