import { sleep } from "workflow";
import { deliverReminder } from "../services/notifications";

export async function reminderWorkflow(reminderId: string, remindAt: string) {
  "use workflow";
  await sleep(new Date(remindAt));
  return deliverReminderStep(reminderId, remindAt);
}

async function deliverReminderStep(reminderId: string, remindAt: string) {
  "use step";
  return deliverReminder(reminderId, remindAt);
}
