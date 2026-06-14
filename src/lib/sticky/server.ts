import { unstable_noStore as noStore } from "next/cache";
import { createDemoWorkspaceData } from "@/lib/sticky/demo-data";
import {
  mapList,
  mapPreferences,
  mapRecurrenceRule,
  mapSubtask,
  mapTask,
  mapUser,
  mapUserState,
} from "@/lib/sticky/mappers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoModeEnabled } from "@/lib/supabase/env";
import type {
  DbList,
  DbRecurrenceRule,
  DbSubtask,
  DbTask,
  DbUser,
  DbUserPreferences,
  DbUserState,
  StickyWorkspaceData,
} from "@/types/sticky";

export type WorkspaceLoadResult =
  | {
      status: "demo";
      data: StickyWorkspaceData;
      reason: string;
    }
  | {
      status: "signed_out";
      configurationMissing: boolean;
    }
  | {
      status: "access_denied";
      message: string;
    }
  | {
      status: "ready";
      data: StickyWorkspaceData;
    };

type ClaimsData = {
  claims?: {
    sub?: string;
    email?: string;
    name?: string;
    full_name?: string;
    user_metadata?: {
      name?: string;
      full_name?: string;
    };
  };
};

function displayNameFromClaims(claims: ClaimsData["claims"]) {
  return (
    claims?.name ??
    claims?.full_name ??
    claims?.user_metadata?.full_name ??
    claims?.user_metadata?.name ??
    null
  );
}

export async function loadWorkspace(): Promise<WorkspaceLoadResult> {
  noStore();

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    if (isDemoModeEnabled()) {
      return {
        status: "demo",
        data: createDemoWorkspaceData(),
        reason: "Sticky is running in local demo mode while sign-in is not connected.",
      };
    }

    return {
      status: "signed_out",
      configurationMissing: true,
    };
  }

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const claims = (claimsData as ClaimsData | null)?.claims;

  if (claimsError || !claims?.sub) {
    return {
      status: "signed_out",
      configurationMissing: false,
    };
  }

  const { data: userRow, error: bootstrapError } = await supabase
    .rpc("bootstrap_current_user", {
      display_name: displayNameFromClaims(claims),
    })
    .single<DbUser>();

  if (bootstrapError || !userRow) {
    const activationMessage =
      bootstrapError?.code === "42501"
        ? "This email is not approved for Sticky yet. Ask the workspace owner to grant access."
        : bootstrapError?.message ??
          "Sticky could not activate this account. Ask the workspace owner to approve this email.";

    return {
      status: "access_denied",
      message: activationMessage,
    };
  }

  const [listsResult, tasksResult, subtasksResult, recurrenceResult, stateResult, prefsResult] =
    await Promise.all([
      supabase.from("lists").select("*").order("sort_order", { ascending: true }),
      supabase
        .from("tasks")
        .select("*")
        .order("is_completed", { ascending: true })
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase
        .from("subtasks")
        .select("*")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase.from("task_recurrence_rules").select("*"),
      supabase.from("user_state").select("selected_list_id, search_query").maybeSingle<DbUserState>(),
      supabase
        .from("user_preferences")
        .select("completed_open_by_list, density, color_mode, task_view_filter, task_sort_mode")
        .maybeSingle<DbUserPreferences>(),
    ]);

  const firstError =
    listsResult.error ??
    tasksResult.error ??
    subtasksResult.error ??
    recurrenceResult.error ??
    stateResult.error ??
    prefsResult.error;

  if (firstError) {
    return {
      status: "access_denied",
      message: firstError.message,
    };
  }

  const workspace: StickyWorkspaceData = {
    user: mapUser(userRow),
    lists: ((listsResult.data ?? []) as DbList[]).map(mapList),
    tasks: ((tasksResult.data ?? []) as DbTask[]).map(mapTask),
    subtasks: ((subtasksResult.data ?? []) as DbSubtask[]).map(mapSubtask),
    recurrenceRules: ((recurrenceResult.data ?? []) as DbRecurrenceRule[]).map(mapRecurrenceRule),
    preferences: mapPreferences(prefsResult.data as DbUserPreferences | null),
    userState: mapUserState(stateResult.data as DbUserState | null),
  };

  return { status: "ready", data: workspace };
}
