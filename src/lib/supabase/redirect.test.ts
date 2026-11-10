import { describe, expect, it } from "vitest";
import { getAuthCallbackUrl, getAuthReturnPath } from "./redirect";

describe("connection sign-in return", () => {
  it("preserves the pending consent request through sign-in", () => {
    const next = "/connect/chatgpt?state=abc&scope=tasks%3Aread";
    expect(new URL(getAuthCallbackUrl("http://localhost:3000", next)).searchParams.get("next")).toBe(next);
    expect(getAuthReturnPath(next)).toBe(next);
  });
  it.each(["https://evil.test", "//evil.test", "/\\evil.test", "/connect/chatgpt/../../evil", "/other", null])("rejects unsafe or unrelated returns: %s", next => {
    expect(getAuthReturnPath(next)).toBe("/");
  });
});
