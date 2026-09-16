export type WorkspaceScaleMode = "auto" | "manual";

type WorkspaceScaleInput = {
  mode: WorkspaceScaleMode;
  manualPercent: number;
  autoBias: number;
  width: number;
  height: number;
  /** Device pixel ratio; omitted or 1 for a standard-density display. */
  pixelRatio?: number;
};

/** Manual range: 25% is a wall of tiny type, 400% is a kiosk. */
export const WORKSPACE_SCALE_MIN = 25;
export const WORKSPACE_SCALE_MAX = 400;
export const WORKSPACE_SCALE_STEP = 5;
/** Auto calibration range on top of the detected baseline. */
export const WORKSPACE_AUTO_BIAS_MIN = -30;
export const WORKSPACE_AUTO_BIAS_MAX = 30;

/** Quick picks shown in manual mode. */
export const WORKSPACE_SCALE_PRESETS = [50, 75, 100, 125, 150, 200, 300] as const;

export function clampWorkspaceScale(percent: number): number {
  if (!Number.isFinite(percent)) return 100;
  return Math.min(WORKSPACE_SCALE_MAX, Math.max(WORKSPACE_SCALE_MIN, Math.round(percent)));
}

export function clampWorkspaceAutoBias(bias: number): number {
  if (!Number.isFinite(bias)) return 0;
  return Math.min(WORKSPACE_AUTO_BIAS_MAX, Math.max(WORKSPACE_AUTO_BIAS_MIN, Math.round(bias)));
}

function roundToStep(value: number) {
  return Math.round(value / WORKSPACE_SCALE_STEP) * WORKSPACE_SCALE_STEP;
}

/**
 * Detected baseline for Auto mode. Scale follows the square root of the
 * viewport width relative to a 1920px reference, so a 1366px laptop lands
 * near 85% and a 2560px monitor near 115%, with 4K reaching ~140%. High
 * density displays already render sharp at 100%, so they are pulled toward
 * the reference; very short viewports lose a notch so vertical rhythm holds.
 */
export function detectWorkspaceBaseline(width: number, height: number, pixelRatio = 1): number {
  if (width <= 860) return 100;
  const widthFactor = Math.sqrt(Math.max(width, 320) / 1920);
  let baseline = 100 * widthFactor;
  if (pixelRatio >= 1.75 && width <= 1800) baseline = Math.max(baseline, 95);
  if (height > 0 && height <= 720) baseline -= 5;
  return Math.min(170, Math.max(70, roundToStep(baseline)));
}

export function resolveWorkspaceScale(input: WorkspaceScaleInput): number {
  if (input.mode === "manual") return clampWorkspaceScale(input.manualPercent);
  const baseline = detectWorkspaceBaseline(input.width, input.height, input.pixelRatio ?? 1);
  return clampWorkspaceScale(baseline + clampWorkspaceAutoBias(input.autoBias));
}

/** Human label for the detected display class, shown in the Auto readout. */
export function describeDisplay(width: number, height: number, pixelRatio = 1): string {
  if (width <= 860) return "Phone";
  const density = pixelRatio >= 1.75 ? " Retina" : "";
  if (width >= 3400) return `4K${density}`;
  if (width >= 2400) return `Ultrawide${density}`;
  if (width >= 2000) return `QHD${density}`;
  if (width >= 1700) return `Full HD${density}`;
  if (width >= 1300) return `Laptop${density}`;
  return `Compact${density}`;
}
