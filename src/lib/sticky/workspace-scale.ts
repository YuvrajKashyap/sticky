export type WorkspaceScaleMode = "auto" | "manual";

type WorkspaceScaleInput = {
  mode: WorkspaceScaleMode;
  manualPercent: number;
  autoBias: number;
  width: number;
  height: number;
};

export function clampWorkspaceScale(percent: number): number {
  return Math.min(125, Math.max(80, Math.round(percent)));
}

export function resolveWorkspaceScale(input: WorkspaceScaleInput): number {
  if (input.mode === "manual") return clampWorkspaceScale(input.manualPercent);
  if (input.width <= 860) return 100;

  let baseline = 100;
  if (input.width <= 1440 || input.height <= 800) baseline = 90;
  else if (input.width >= 2400 && input.height >= 1200) baseline = 110;
  else if (input.width >= 2000 && input.height >= 1100) baseline = 105;

  return clampWorkspaceScale(baseline + input.autoBias);
}
