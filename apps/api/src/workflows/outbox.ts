import { sleep } from "workflow";
import { getRuntime } from "../runtime";
import { pushOutboxEvent } from "../services/google";

export async function outboxWorkflow(userId: string) {
  "use workflow";
  for (let pass = 0; pass < 8; pass += 1) {
    const remaining = await deliverOutboxStep(userId);
    if (remaining === 0) return { delivered: true };
    await sleep(`${Math.min(2 ** pass, 60)}m`);
  }
  return { delivered: false };
}

async function deliverOutboxStep(userId: string) {
  "use step";
  const { db } = getRuntime();
  const { data: events, error } = await db.from("outbox_events").select("*")
    .eq("user_id", userId).in("status", ["pending", "retrying"]).lte("available_at", new Date().toISOString())
    .order("created_at").limit(50);
  if (error) throw error;
  let remaining = 0;
  for (const event of events ?? []) {
    try {
      await pushOutboxEvent(event);
      await db.from("outbox_events").update({ status: "delivered", processed_at: new Date().toISOString(), last_error: null }).eq("id", event.id);
    } catch (error) {
      remaining += 1;
      await db.from("outbox_events").update({
        status: event.attempt_count >= 7 ? "failed" : "retrying",
        attempt_count: event.attempt_count + 1,
        available_at: new Date(Date.now() + Math.min(60, 2 ** event.attempt_count) * 60_000).toISOString(),
        last_error: error instanceof Error ? error.message : "Provider sync failed",
      }).eq("id", event.id);
    }
  }
  return remaining;
}
