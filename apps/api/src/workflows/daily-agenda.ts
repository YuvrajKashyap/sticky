import { createHook, sleep } from "workflow";
import { getRuntime } from "../runtime";
import { dailyAgendaScheduleFromRow, deliverDailyAgenda } from "../services/daily-agenda";

export async function dailyAgendaWorkflow(userId: string, scheduleVersion: number) {
  "use workflow";
  console.info("[dailyAgendaWorkflow] START", { userId, scheduleVersion });

  using ownership = createHook<Record<string, never>>({
    token: `sticky:daily-agenda:${userId}:${scheduleVersion}`,
  });
  const conflict = await ownership.getConflict();
  if (conflict) {
    console.info("[dailyAgendaWorkflow] DUPLICATE", { userId, scheduleVersion, ownerRunId: conflict.runId });
    return { scheduled: false, duplicateOf: conflict.runId };
  }

  for (;;) {
    const schedule = await readScheduleStep(userId, scheduleVersion);
    if (!schedule) {
      console.info("[dailyAgendaWorkflow] STOP", { userId, scheduleVersion, reason: "disabled_or_obsolete" });
      return { scheduled: false, reason: "disabled_or_obsolete" };
    }

    console.info("[dailyAgendaWorkflow] SLEEP", { userId, scheduleVersion, nextRunAt: schedule.nextRunAt });
    await sleep(new Date(schedule.nextRunAt));
    const delivery = await deliverAgendaStep(userId, scheduleVersion, schedule.nextRunDate, schedule.timezone);
    if (delivery.continue === false) {
      console.info("[dailyAgendaWorkflow] STOP", { userId, scheduleVersion, reason: delivery.skipped ?? "obsolete" });
      return { scheduled: false, reason: delivery.skipped ?? "obsolete" };
    }
  }
}

async function readScheduleStep(userId: string, scheduleVersion: number) {
  "use step";
  console.info("[readDailyAgendaSchedule] START", { userId, scheduleVersion });
  const { data, error } = await getRuntime().db.from("user_preferences")
    .select("daily_agenda_enabled,daily_agenda_time,daily_agenda_timezone,daily_agenda_schedule_version,daily_agenda_workflow_run_id,daily_agenda_last_sent_on,daily_agenda_last_sent_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("[readDailyAgendaSchedule] FAIL", { userId, scheduleVersion, message: error.message });
    throw error;
  }
  if (!data?.daily_agenda_enabled || Number(data.daily_agenda_schedule_version) !== scheduleVersion) {
    console.info("[readDailyAgendaSchedule] DONE", { userId, scheduleVersion, active: false });
    return null;
  }
  const schedule = dailyAgendaScheduleFromRow(data);
  console.info("[readDailyAgendaSchedule] DONE", { userId, scheduleVersion, active: true, nextRunAt: schedule.nextRunAt });
  return schedule;
}

async function deliverAgendaStep(userId: string, scheduleVersion: number, date: string, timezone: string) {
  "use step";
  console.info("[deliverDailyAgenda] START", { userId, scheduleVersion, date, timezone });
  try {
    const result = await deliverDailyAgenda(userId, { date, timezone, scheduleVersion });
    console.info("[deliverDailyAgenda] DONE", { userId, scheduleVersion, date, result });
    return result;
  } catch (error) {
    console.error("[deliverDailyAgenda] FAIL", {
      userId,
      scheduleVersion,
      date,
      message: error instanceof Error ? error.message : "Unknown daily agenda error",
    });
    throw error;
  }
}
