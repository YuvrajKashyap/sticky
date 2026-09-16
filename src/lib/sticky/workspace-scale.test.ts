import { describe, expect, it } from "vitest";
import {
  WORKSPACE_SCALE_MAX,
  WORKSPACE_SCALE_MIN,
  clampWorkspaceScale,
  describeDisplay,
  detectWorkspaceBaseline,
  resolveWorkspaceScale,
} from "./workspace-scale";

describe("workspace interface sizing", () => {
  it("adapts Auto to the available dashboard viewport", () => {
    expect(resolveWorkspaceScale({ mode: "auto", manualPercent: 100, autoBias: 0, width: 1366, height: 768 })).toBe(85);
    expect(resolveWorkspaceScale({ mode: "auto", manualPercent: 100, autoBias: 0, width: 1920, height: 1080 })).toBe(100);
    expect(resolveWorkspaceScale({ mode: "auto", manualPercent: 100, autoBias: 0, width: 2560, height: 1440 })).toBe(115);
    expect(resolveWorkspaceScale({ mode: "auto", manualPercent: 100, autoBias: 0, width: 3840, height: 2160 })).toBe(140);
  });

  it("keeps phones at their native size in Auto", () => {
    expect(detectWorkspaceBaseline(390, 844, 3)).toBe(100);
  });

  it("does not shrink dense laptop displays below readable", () => {
    expect(detectWorkspaceBaseline(1440, 900, 2)).toBe(95);
    expect(detectWorkspaceBaseline(1440, 900, 1)).toBe(85);
  });

  it("keeps a manual workspace percentage exact on every monitor", () => {
    expect(resolveWorkspaceScale({ mode: "manual", manualPercent: 115, autoBias: 0, width: 1366, height: 768 })).toBe(115);
    expect(resolveWorkspaceScale({ mode: "manual", manualPercent: 115, autoBias: 0, width: 2560, height: 1440 })).toBe(115);
  });

  it("allows Auto to be calibrated without leaving dynamic mode", () => {
    expect(resolveWorkspaceScale({ mode: "auto", manualPercent: 100, autoBias: -5, width: 1920, height: 1080 })).toBe(95);
    expect(resolveWorkspaceScale({ mode: "auto", manualPercent: 100, autoBias: 10, width: 2560, height: 1440 })).toBe(125);
    expect(resolveWorkspaceScale({ mode: "auto", manualPercent: 100, autoBias: 90, width: 1920, height: 1080 })).toBe(130);
  });

  it("clamps manual sizes to the extreme range", () => {
    expect(clampWorkspaceScale(10)).toBe(WORKSPACE_SCALE_MIN);
    expect(clampWorkspaceScale(999)).toBe(WORKSPACE_SCALE_MAX);
    expect(clampWorkspaceScale(Number.NaN)).toBe(100);
  });

  it("names the detected display class", () => {
    expect(describeDisplay(1366, 768)).toBe("Laptop");
    expect(describeDisplay(2560, 1440)).toBe("Ultrawide");
    expect(describeDisplay(1440, 900, 2)).toBe("Laptop Retina");
    expect(describeDisplay(390, 844, 3)).toBe("Phone");
  });
});
