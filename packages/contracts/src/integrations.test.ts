import { describe, expect, it } from "vitest";
import { apiCredentialCreateSchema } from "./integrations";

describe("agent credential contracts", () => {
  it("accepts an independently revocable Codex MCP credential", () => {
    const credential = apiCredentialCreateSchema.parse({
      name: "Codex",
      provider: "codex",
      providerUserId: null,
      scopes: ["tasks:read", "tasks:write", "calendar:read", "calendar:write"],
    });

    expect(credential).toMatchObject({
      name: "Codex",
      provider: "codex",
      providerUserId: null,
    });
  });

  it("accepts an independently revocable Littlebird MCP credential", () => {
    const credential = apiCredentialCreateSchema.parse({
      name: "Littlebird",
      provider: "littlebird",
      providerUserId: null,
      scopes: ["tasks:read", "tasks:write", "calendar:read", "calendar:write"],
    });

    expect(credential).toMatchObject({
      name: "Littlebird",
      provider: "littlebird",
      providerUserId: null,
    });
  });
});
