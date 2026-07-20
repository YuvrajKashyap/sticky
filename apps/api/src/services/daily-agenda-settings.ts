import type { ActorContext } from "@sticky/contracts";
import { isValidTimeZone, StickyDomainError, zonedDateKeyAt } from "@sticky/domain";
import { start } from "workflow/api";
import { z } from "zod";
import { getRuntime } from "../runtime";
import { dailyAgendaWorkflow } from "../workflows/daily-agenda";
import { dailyAgendaScheduleFromRow, deliverDailyAgenda } from "./daily-agenda";

export const dailyAgendaSettingsSchema = z.object({
  enabled: z.boolean(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timezone: z.string().trim().min(1).max(100).refine(isValidTimeZone, "Use a valid IANA timezone."),
});

export type DailyAgendaSettingsInput = z.infer<typeof dailyAgendaSettingsSchema>;

export const dailyAgendaPreferenceColumns = "daily_agenda_enabled,daily_agenda_time,daily_agenda_timezone,daily_agenda_schedule_version,daily_agenda_workflow_run_id,daily_agenda_last_sent_on,daily_agenda_last_sent_at";

async function pokeDailyAgendaState(userId: string) {
  const { data, error } = await getRuntime().db.from("api_credentials")
    .select("provider_user_id")
    .eq("user_id", userId)
    .eq("provider", "poke")
    .is("revoked_at", null)
    .not("provider_user_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return {
    pokeLinked: Boolean(data?.provider_user_id),
    pokeDeliveryConfigured: Boolean(process.env.POKE_API_KEY),
  };
}

async function ensureDailyAgendaWorkflow(userId: string, row: Record<string, unknown>) {
  if (!row.daily_agenda_enabled || row.daily_agenda_workflow_run_id || process.env.WORKFLOW_ENABLED === "false") return row;
  const scheduleVersion = Number(row.daily_agenda_schedule_version ?? 1);
  const run = await start(dailyAgendaWorkflow, [userId, scheduleVersion]);
  const { data, error } = await getRuntime().db.from("user_preferences")
    .update({ daily_agenda_workflow_run_id: run.runId })
    .eq("user_id", userId)
    .eq("daily_agenda_schedule_version", scheduleVersion)
    .is("daily_agenda_workflow_run_id", null)
    .select(dailyAgendaPreferenceColumns)
    .maybeSingle();
  if (error) throw error;
  return (data ?? row) as Record<string, unknown>;
}

async function response(userId: string, row: Record<string, unknown>) {
  const [connection, schedule] = await Promise.all([
    pokeDailyAgendaState(userId),
    Promise.resolve(dailyAgendaScheduleFromRow(row)),
  ]);
  return { ...schedule, ...connection };
}

export async function getDailyAgendaSettings(userId: string) {
  const { data, error } = await getRuntime().db.from("user_preferences")
    .select(dailyAgendaPreferenceColumns)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new StickyDomainError("not_found", "Sticky could not find your daily agenda settings.", 404);
  return response(userId, await ensureDailyAgendaWorkflow(userId, data as Record<string, unknown>));
}

export async function updateDailyAgendaSettings(userId: string, input: DailyAgendaSettingsInput) {
  const current = await getRuntime().db.from("user_preferences")
    .select("daily_agenda_schedule_version")
    .eq("user_id", userId)
    .maybeSingle();
  if (current.error) throw current.error;
  if (!current.data) throw new StickyDomainError("not_found", "Sticky could not find your daily agenda settings.", 404);
  const scheduleVersion = Number(current.data.daily_agenda_schedule_version ?? 1) + 1;
  const updated = await getRuntime().db.from("user_preferences").update({
    daily_agenda_enabled: input.enabled,
    daily_agenda_time: `${input.time}:00`,
    daily_agenda_timezone: input.timezone,
    daily_agenda_schedule_version: scheduleVersion,
    daily_agenda_workflow_run_id: null,
  }).eq("user_id", userId).select(dailyAgendaPreferenceColumns).single();
  if (updated.error) throw updated.error;
  return response(userId, await ensureDailyAgendaWorkflow(userId, updated.data as Record<string, unknown>));
}

export async function sendDailyAgendaTest(actor: ActorContext) {
  const settings = await getDailyAgendaSettings(actor.userId);
  const date = zonedDateKeyAt(new Date(), settings.timezone);
  return deliverDailyAgenda(actor.userId, {
    date,
    timezone: settings.timezone,
    test: true,
    deliveryKey: `daily-agenda-test:${actor.userId}:${actor.idempotencyKey ?? actor.requestId}:push`,
  });
}
