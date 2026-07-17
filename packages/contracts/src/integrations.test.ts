import { describe, expect, it } from "vitest";
import { apiCredentialCreateSchema } from "./integrations";

describe("agent credential contracts", () => {
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
