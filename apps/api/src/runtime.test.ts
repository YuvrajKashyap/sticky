import { describe, expect, it } from "vitest";
import { parseCredentialToken } from "./runtime";

describe("Sticky credential tokens", () => {
  it("preserves underscores inside the random secret", () => {
    expect(parseCredentialToken("stk_4d1cc3fa-546d-4618-8c6f-2191f29e0fc9_part_one_two")).toEqual({
      tokenPrefix: "stk_4d1cc3fa-546d-4618-8c6f-2191f29e0fc9",
      secret: "part_one_two",
    });
  });

  it("rejects malformed credential prefixes", () => {
    expect(parseCredentialToken("stk_not-a-uuid_secret")).toBeNull();
  });
});
