import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();
const setAuth = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({
    auth: { getSession },
    realtime: { setAuth },
  }),
}));

import { createStickyPlatformClient } from "./api-client";

describe("Sticky platform Realtime authentication", () => {
  beforeEach(() => {
    getSession.mockReset();
    setAuth.mockReset();
  });

  it("authenticates private Realtime channels with the current session token", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "sticky-session-token" } } });
    setAuth.mockResolvedValue(undefined);

    await createStickyPlatformClient()?.authenticateRealtime();

    expect(setAuth).toHaveBeenCalledWith("sticky-session-token");
  });

  it("does not connect Realtime after the Sticky session expires", async () => {
    getSession.mockResolvedValue({ data: { session: null } });

    await expect(createStickyPlatformClient()?.authenticateRealtime()).rejects.toThrow(
      "Your Sticky session has expired. Sign in again.",
    );
    expect(setAuth).not.toHaveBeenCalled();
  });
});
