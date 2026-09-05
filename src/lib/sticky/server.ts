import { unstable_noStore as noStore } from "next/cache";
import { createDemoWorkspaceData } from "@/lib/sticky/demo-data";
import {
  GENERIC_STICKY_ACCESS_MESSAGE,
  userFacingStickyMessage,
} from "@/lib/sticky/messages";
import { mapUser, mapWorkspaceRecords } from "@/lib/sticky/mappers";
import { readWorkspaceRecords } from "@sticky/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoModeEnabled } from "@/lib/supabase/env";
import type { DbUser, StickyWorkspaceData } from "@/types/sticky";

export type WorkspaceLoadResult =
  | { status: "demo"; data: StickyWorkspaceData; reason: string }
  | { status: "signed_out"; configurationMissing: boolean }
  | { status: "access_denied"; message: string }
  | { status: "ready"; data: StickyWorkspaceData };

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

  if (isDemoModeEnabled()) {
    return {
      status: "demo",
      data: createDemoWorkspaceData(),
      reason: "Sticky is running in local demo mode while sign-in is not connected.",
    };
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
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
        : userFacingStickyMessage(
            bootstrapError?.message,
            "Sticky could not activate this account. Ask the workspace owner to approve this email.",
          );

    return {
      status: "access_denied",
      message: activationMessage,
    };
  }

  try {
    const records = await readWorkspaceRecords(supabase, userRow.id);
    return { status: "ready", data: { user: mapUser(userRow), ...mapWorkspaceRecords(records) } };
  } catch (error) {
    console.error("Sticky workspace load failed", error);
    return { status: "access_denied", message: GENERIC_STICKY_ACCESS_MESSAGE };
  }
}
