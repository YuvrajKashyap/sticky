import webpush from "web-push";
import { reminderDeliveryKey } from "@sticky/domain";
import { getRuntime } from "../runtime";

function configureWebPush() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:sticky@yuvrajkashyap.com";
  if (!publicKey || !privateKey) throw new Error("Web push keys are not configured.");
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

export async function deliverReminder(reminderId: string, expectedRemindAt: string) {
  const { db } = getRuntime();
  const { data: reminder } = await db.from("task_reminders").select("*,tasks(*)").eq("id", reminderId).maybeSingle();
  if (!reminder || reminder.status !== "scheduled" || reminder.remind_at !== expectedRemindAt) return { skipped: "obsolete" };
  const task = reminder.tasks as Record<string, unknown>;
  if (task.is_completed) return { skipped: "completed" };
  const results: Record<string, unknown>[] = [];
  const failures: string[] = [];
  for (const channel of reminder.channels as string[]) {
    const deliveryKey = reminderDeliveryKey(reminder.id, reminder.remind_at, channel);
    const { data: existing, error: existingError } = await db.from("notification_deliveries")
      .select("id,status,attempt_count")
      .eq("delivery_key", deliveryKey)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing?.status === "delivered") continue;

    const attemptCount = Number(existing?.attempt_count ?? 0) + 1;
    const deliveryQuery = existing
      ? db.from("notification_deliveries").update({ status: "delivering", attempt_count: attemptCount, error_message: null }).eq("id", existing.id)
      : db.from("notification_deliveries").insert({
          user_id: reminder.user_id,
          reminder_id: reminder.id,
          channel,
          delivery_key: deliveryKey,
          status: "delivering",
          attempt_count: attemptCount,
        });
    const { data: delivery, error } = await deliveryQuery.select("id").maybeSingle();
    if (error || !delivery) throw error ?? new Error("Could not start reminder delivery.");
    try {
      const receipt = channel === "poke"
        ? await sendPokeMessage(
            pokeNotificationInstruction(
              `Reminder: ${String(task.title)}\n\nOpen Sticky: ${process.env.NEXT_PUBLIC_SITE_URL}/?task=${String(task.id)}`,
            ),
            reminder.user_id,
          )
        : await sendPush(reminder.user_id, task);
      await db.from("notification_deliveries").update({ status: "delivered", delivered_at: new Date().toISOString(), provider_receipt: receipt })
        .eq("id", delivery.id);
      results.push({ channel, status: "delivered" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Delivery failed";
      await db.from("notification_deliveries").update({ status: "failed", error_message: message })
        .eq("id", delivery.id);
      failures.push(`${channel}: ${message}`);
      results.push({ channel, status: "failed" });
    }
  }
  if (failures.length) throw new Error(`Reminder delivery failed (${failures.join("; ")}).`);
  await db.from("task_reminders").update({ status: "delivered" }).eq("id", reminder.id).eq("version", reminder.version);
  return { results };
}

export function pokeNotificationInstruction(notification: string) {
  return [
    "Reply in my current Poke conversation now with exactly the Sticky notification below.",
    "This is a notification delivery request. Do not use any tools, modify anything, or ask a follow-up question.",
    "",
    notification,
  ].join("\n");
}

export function pokeApiPayload(message: string) {
  return { message };
}

export function pokeApiRequestInit(token: string, message: string): RequestInit {
  return {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(pokeApiPayload(message)),
  };
}

export async function sendPokeMessage(
  message: string,
  userId: string,
) {
  const token = process.env.POKE_API_KEY;
  if (!token) throw new Error("Poke delivery is not configured.");
  const { data: credential, error } = await getRuntime().db.from("api_credentials")
    .select("provider_user_id")
    .eq("user_id", userId)
    .eq("provider", "poke")
    .is("revoked_at", null)
    .not("provider_user_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!credential?.provider_user_id) throw new Error("Poke is not linked to this Sticky account.");
  const response = await fetch(
    "https://poke.com/api/v1/inbound/api-message",
    pokeApiRequestInit(token, message),
  );
  if (!response.ok) throw new Error(`Poke returned ${response.status}.`);
  const receipt = await response.json() as Record<string, unknown>;
  if (receipt.success !== true) throw new Error("Poke did not accept the message.");
  return receipt;
}

type WebPushMessage = {
  title: string;
  body: string;
  url: string;
  tag?: string;
  taskId?: string;
};

export async function sendWebPushMessage(userId: string, message: WebPushMessage) {
  configureWebPush();
  const { db } = getRuntime();
  const { data: subscriptions } = await db.from("push_subscriptions").select("*").eq("user_id", userId).eq("is_active", true);
  if (!subscriptions?.length) throw new Error("No active web notification device is registered.");
  const receipts = [];
  for (const subscription of subscriptions ?? []) {
    try {
      const result = await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth_secret },
      }, JSON.stringify(message));
      receipts.push({ endpoint: subscription.endpoint, statusCode: result.statusCode });
      await db.from("push_subscriptions").update({ last_success_at: new Date().toISOString(), last_error: null }).eq("id", subscription.id);
    } catch (error) {
      const statusCode = typeof error === "object" && error && "statusCode" in error ? Number(error.statusCode) : 0;
      await db.from("push_subscriptions").update({ is_active: ![404, 410].includes(statusCode), last_error: error instanceof Error ? error.message : "Push failed" }).eq("id", subscription.id);
      if (![404, 410].includes(statusCode)) throw error;
    }
  }
  if (!receipts.length) throw new Error("No registered notification device accepted the message.");
  return { receipts };
}

async function sendPush(userId: string, task: Record<string, unknown>) {
  return sendWebPushMessage(userId, {
    title: "Sticky reminder",
    body: String(task.title),
    url: `/?task=${String(task.id)}`,
    taskId: String(task.id),
  });
}
