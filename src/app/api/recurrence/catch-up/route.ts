import { NextResponse, type NextRequest } from "next/server";
import { mapRecurrenceRule, mapTask } from "@/lib/sticky/mappers";
import { localDateKey, recurrenceCatchUpTarget, zonedDateKey } from "@/lib/sticky/recurrence";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { DbRecurrenceRule, DbTask } from "@/types/sticky";

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

function parseTodayOverride(value: string | null) {
  if (!value) {
    return null;
  }

  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "invalid";
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
  const todayOverride = parseTodayOverride(request.nextUrl.searchParams.get("today"));

  if (todayOverride === "invalid") {
    return jsonResponse(
      {
        ok: false,
        error: "today must use YYYY-MM-DD format.",
      },
      400,
    );
  }

  const runDate = new Date();
  const maxLookupDate = localDateKey(new Date(runDate.getTime() + 86_400_000));
  const recurrenceResult = await supabase
    .from("task_recurrence_rules")
    .select("*")
    .eq("paused", false)
    .order("updated_at", { ascending: true })
    .limit(limit);

  if (recurrenceResult.error) {
    return jsonResponse(
      {
        ok: false,
        error: recurrenceResult.error.message,
      },
      500,
    );
  }

  const recurrenceRows = (recurrenceResult.data ?? []) as DbRecurrenceRule[];
  const taskIds = recurrenceRows.map((rule) => rule.task_id);

  if (!taskIds.length) {
    return jsonResponse({
      ok: true,
      checked: 0,
      eligible: 0,
      advanced: 0,
      skipped: 0,
      errors: [],
    });
  }

  const tasksResult = await supabase
    .from("tasks")
    .select("*")
    .in("id", taskIds)
    .eq("is_completed", false)
    .not("due_date", "is", null)
    .lte("due_date", maxLookupDate)
    .limit(limit);

  if (tasksResult.error) {
    return jsonResponse(
      {
        ok: false,
        error: tasksResult.error.message,
      },
      500,
    );
  }

  const tasks = ((tasksResult.data ?? []) as DbTask[]).map(mapTask);
  const rulesByTask = new Map(
    recurrenceRows.map((rule) => [rule.task_id, mapRecurrenceRule(rule)]),
  );
  const errors: WorkerError[] = [];
  let eligible = 0;
  let advanced = 0;
  let skipped = 0;
  let missedRepeats = 0;

  for (const task of tasks) {
    const rule = rulesByTask.get(task.id);

    if (!rule) {
      continue;
    }

    const targetDate =
      todayOverride ?? zonedDateKey(rule.timezone || task.timezone, runDate);
    const catchUpTarget = recurrenceCatchUpTarget(rule, task, targetDate);

    if (!catchUpTarget) {
      skipped += 1;
      continue;
    }

    eligible += 1;
    missedRepeats += catchUpTarget.skippedCount;

    const { data, error } = await supabase.rpc("advance_recurring_task_for_worker", {
      p_next_due_date: catchUpTarget.dueDate,
      p_next_occurrence_count: catchUpTarget.occurrenceCount,
      p_reason: "vercel_cron",
      p_skipped_count: catchUpTarget.skippedCount,
      p_task_id: task.id,
    });

    if (error) {
      errors.push({ taskId: task.id, message: error.message });
      continue;
    }

    if (data === true) {
      advanced += 1;
    } else {
      skipped += 1;
    }
  }

  return jsonResponse(
    {
      ok: errors.length === 0,
      checked: tasks.length,
      eligible,
      advanced,
      skipped,
      missedRepeats,
      errors,
    },
    errors.length ? 207 : 200,
  );
}
