import { NextResponse, type NextRequest } from "next/server";
import { readAllPages, type DataRow } from "@sticky/data";
import type { ActorContext } from "@sticky/contracts";
import { reconcileTaskReminder } from "../../../../../apps/api/src/services/reminder-policy";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

type WorkerError = {
  taskId: string;
  message: string;
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function parseLimit(value: string | null) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 500;
  }

  return Math.min(1000, Math.max(1, Math.floor(parsed)));
}

function workflowActor(userId: string): ActorContext {
  return {
    userId,
    actorType: "workflow",
    actorId: "recurrence-catch-up",
    credentialId: null,
    scopes: new Set(["tasks:read", "tasks:write"]),
    requestId: crypto.randomUUID(),
    idempotencyKey: null,
    providerUserId: null,
    accessToken: null,
  };
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!cronSecret) {
    return jsonResponse(
      {
        ok: false,
        error: "CRON_SECRET is not configured.",
      },
      503,
    );
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
  }

  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    return jsonResponse(
      {
        ok: true,
        disabled: true,
        reason: "Supabase server secret is not configured.",
      },
    );
  }

  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
  const owners = await supabase.from("users").select("id").order("id").limit(limit);
  if (owners.error) return jsonResponse({ ok: false, error: "Could not load routine owners." }, 500);
  const errors: WorkerError[] = [];
  let generated = 0;
  for (const owner of owners.data ?? []) {
    const reconciled = await supabase.rpc("reconcile_routine_occurrences", { p_request_user_id: String(owner.id) });
    if (reconciled.error) { errors.push({ taskId: String(owner.id), message: reconciled.error.message }); continue; }
    generated += Number(reconciled.data ?? 0);
    const tasks = await readAllPages<DataRow>((from, to) => supabase.from("tasks").select("id").eq("user_id", String(owner.id)).eq("is_completed", false)
      .or("routine_id.is.null,occurrence_status.eq.pending").not("due_date", "is", null).not("due_time", "is", null).order("id").range(from, to));
    if (tasks.error) { errors.push({ taskId: String(owner.id), message: tasks.error.message }); continue; }
    for (const task of tasks.data ?? []) {
      try { await reconcileTaskReminder(workflowActor(String(owner.id)), String(task.id)); }
      catch { errors.push({ taskId: String(task.id), message: "Could not reconcile reminder." }); }
    }
  }
  return jsonResponse({ ok: errors.length === 0, generated, errors }, errors.length ? 207 : 200);
}
