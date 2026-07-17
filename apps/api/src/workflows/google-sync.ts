import type { ActorContext, StickyScope } from "@sticky/contracts";
import { sleep } from "workflow";
import { syncGoogle } from "../services/google";

export async function googleSyncWorkflow(userId: string) {
  "use workflow";
  for (;;) {
    await syncGoogleStep(userId);
    await sleep("15m");
  }
}

async function syncGoogleStep(userId: string) {
  "use step";
  const actor: ActorContext = {
    userId,
    actorType: "workflow",
    actorId: "google-sync",
    credentialId: null,
    scopes: new Set<StickyScope>([
      "tasks:read", "tasks:write", "calendar:read", "calendar:write", "integrations:read", "integrations:write",
    ]),
    requestId: crypto.randomUUID(),
    idempotencyKey: `google-sync:${Date.now()}`,
    providerUserId: null,
    accessToken: null,
  };
  try {
    return await syncGoogle(actor);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Google sync failed" };
  }
}
