import { describe, expect, it } from "vitest";
import { resolveWorkspaceScale } from "./workspace-scale";

describe("workspace interface sizing", () => {
  it("adapts Auto to the available dashboard viewport", () => {
    expect(resolveWorkspaceScale({ mode: "auto", manualPercent: 100, autoBias: 0, width: 1366, height: 768 })).toBe(90);
    expect(resolveWorkspaceScale({ mode: "auto", manualPercent: 100, autoBias: 0, width: 1920, height: 1080 })).toBe(100);
    expect(resolveWorkspaceScale({ mode: "auto", manualPercent: 100, autoBias: 0, width: 2560, height: 1440 })).toBe(110);
  });

  it("keeps a manual workspace percentage exact on every monitor", () => {
    expect(resolveWorkspaceScale({ mode: "manual", manualPercent: 115, autoBias: 0, width: 1366, height: 768 })).toBe(115);
    expect(resolveWorkspaceScale({ mode: "manual", manualPercent: 115, autoBias: 0, width: 2560, height: 1440 })).toBe(115);
  });

  it("allows Auto to be calibrated without leaving dynamic mode", () => {
    expect(resolveWorkspaceScale({ mode: "auto", manualPercent: 100, autoBias: -5, width: 1920, height: 1080 })).toBe(95);
    expect(resolveWorkspaceScale({ mode: "auto", manualPercent: 100, autoBias: 10, width: 2560, height: 1440 })).toBe(120);
  });
});
