"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useCallback, useRef, useState } from "react";

export const DEFAULT_ACCENT_HUE = 191;

const PRESETS: Array<{ hue: number; name: string }> = [
  { hue: 191, name: "Arc cyan" },
  { hue: 258, name: "Ultraviolet" },
  { hue: 322, name: "Fusion magenta" },
  { hue: 38, name: "Reactor amber" },
  { hue: 152, name: "Aurora green" },
];

const WHEEL_SIZE = 152;
const RING_THICKNESS = 16;

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function toHex(rgb: [number, number, number]) {
  return "#" + rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("");
}

/** Re-light the whole console from a single hue. */
export function applyAccentHue(hue: number) {
  const root = document.documentElement;
  const normalized = ((hue % 360) + 360) % 360;
  const rgb = hslToRgb(normalized, 1, 0.68);
  const rgbTriplet = rgb.join(", ");

  root.style.setProperty("--accent", `hsl(${normalized} 100% 68%)`);
  root.style.setProperty("--accent-bright", `hsl(${normalized} 100% 81%)`);
  root.style.setProperty("--accent-deep", `hsl(${(normalized + 332) % 360} 88% 62%)`);
  root.style.setProperty("--accent-rgb", rgbTriplet);
  root.style.setProperty("--accent-soft", `rgba(${rgbTriplet}, 0.1)`);
  root.style.setProperty("--accent-soft-2", `rgba(${rgbTriplet}, 0.22)`);
  root.style.setProperty("--accent-ink", `hsl(${normalized} 100% 86%)`);
  root.style.setProperty("--hud-line", `rgba(${rgbTriplet}, 0.32)`);
  root.style.setProperty("--neon-cyan", `hsl(${normalized} 100% 68%)`);
  root.style.setProperty("--neon-cyan-rgb", rgbTriplet);
}

export function accentHex(hue: number) {
  return toHex(hslToRgb(((hue % 360) + 360) % 360, 1, 0.68));
}

/* List color channels laid out around the hue ring (ink lives in the grid only). */
export const LIST_CHANNEL_HUES: Array<{ color: string; hue: number }> = [
  { color: "ember", hue: 24 },
  { color: "sun", hue: 42 },
  { color: "lime", hue: 84 },
  { color: "mint", hue: 152 },
  { color: "teal", hue: 174 },
  { color: "sky", hue: 191 },
  { color: "azure", hue: 220 },
  { color: "violet", hue: 252 },
  { color: "magenta", hue: 290 },
  { color: "rose", hue: 325 },
  { color: "coral", hue: 350 },
];

function nearestChannel(hue: number) {
  let best = LIST_CHANNEL_HUES[0];
  let bestDistance = 361;
  for (const channel of LIST_CHANNEL_HUES) {
    const raw = Math.abs(channel.hue - hue);
    const distance = Math.min(raw, 360 - raw);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = channel;
    }
  }
  return best;
}

/**
 * Channel picker for lists: same ring, but the knob snaps to the nearest
 * named channel so every choice stays tuned to the console's glow tokens.
 */
export function ListColorWheel({
  value,
  onChange,
  size = 128,
}: {
  value: string;
  onChange: (color: string) => void;
  size?: number;
}) {
  const reduceMotion = useReducedMotion();
  const ringRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const selected = LIST_CHANNEL_HUES.find((channel) => channel.color === value) ?? null;

  const pick = useCallback(
    (event: React.PointerEvent) => {
      const node = ringRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const dx = event.clientX - (rect.left + rect.width / 2);
      const dy = event.clientY - (rect.top + rect.height / 2);
      const hue = Math.round((Math.atan2(dy, dx) * 180) / Math.PI + 90 + 360) % 360;
      const channel = nearestChannel(hue);
      if (channel.color !== value) onChange(channel.color);
    },
    [onChange, value],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      pick(event);
    },
    [pick],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (dragging) pick(event);
    },
    [dragging, pick],
  );

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const radius = size / 2 - RING_THICKNESS / 2 - 2;
  const angle = selected ? ((selected.hue - 90) * Math.PI) / 180 : 0;

  return (
    <div
      ref={ringRef}
      className={`accent-wheel channel-wheel${dragging ? " dragging" : ""}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <span className="accent-wheel-ring" aria-hidden="true" />
      {LIST_CHANNEL_HUES.map((channel) => {
        const dotAngle = ((channel.hue - 90) * Math.PI) / 180;
        return (
          <span
            key={channel.color}
            className="channel-wheel-notch"
            style={{
              left: size / 2 + radius * Math.cos(dotAngle),
              top: size / 2 + radius * Math.sin(dotAngle),
            }}
          />
        );
      })}
      {selected ? (
        <motion.span
          className="accent-wheel-knob"
          aria-hidden="true"
          style={{ background: `var(--${selected.color}-edge)` }}
          animate={{
            left: size / 2 + radius * Math.cos(angle),
            top: size / 2 + radius * Math.sin(angle),
            scale: dragging ? 1.3 : 1,
          }}
          transition={
            reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 460, damping: 26 }
          }
        />
      ) : null}
      <span className="accent-wheel-core channel-wheel-core" aria-hidden="true">
        <span
          className="accent-wheel-swatch"
          style={selected ? { background: `var(--${selected.color}-edge)`, boxShadow: `0 0 14px var(--${selected.color}-edge)` } : { background: "var(--ink-edge)", boxShadow: "0 0 10px var(--ink-edge)" }}
        />
      </span>
    </div>
  );
}

/**
 * Interactive hue ring: drag the knob (or press arrow keys) and the entire
 * interface re-lights live. Presets below jump straight to tuned channels.
 */
export function AccentWheel({ hue, onChange }: { hue: number; onChange: (hue: number) => void }) {
  const reduceMotion = useReducedMotion();
  const ringRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const hueFromPointer = useCallback((event: React.PointerEvent) => {
    const node = ringRef.current;
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    return Math.round((Math.atan2(dy, dx) * 180) / Math.PI + 90 + 360) % 360;
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const next = hueFromPointer(event);
      if (next === null) return;
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      onChange(next);
    },
    [hueFromPointer, onChange],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      const next = hueFromPointer(event);
      if (next !== null) onChange(next);
    },
    [dragging, hueFromPointer, onChange],
  );

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 15 : 4;
      if (event.key === "ArrowRight" || event.key === "ArrowUp") {
        event.preventDefault();
        onChange((hue + step) % 360);
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
        event.preventDefault();
        onChange((hue - step + 360) % 360);
      }
    },
    [hue, onChange],
  );

  const radius = WHEEL_SIZE / 2 - RING_THICKNESS / 2 - 2;
  const angle = ((hue - 90) * Math.PI) / 180;
  const knobX = WHEEL_SIZE / 2 + radius * Math.cos(angle);
  const knobY = WHEEL_SIZE / 2 + radius * Math.sin(angle);
  const hex = accentHex(hue);

  return (
    <div className="accent-wheel-block">
      <div
        ref={ringRef}
        className={`accent-wheel${dragging ? " dragging" : ""}`}
        style={{ width: WHEEL_SIZE, height: WHEEL_SIZE }}
        role="slider"
        aria-label="Accent hue"
        aria-valuemin={0}
        aria-valuemax={359}
        aria-valuenow={Math.round(hue)}
        aria-valuetext={`Hue ${Math.round(hue)} degrees`}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
      >
        <span className="accent-wheel-ring" aria-hidden="true" />
        <span className="accent-wheel-ticks" aria-hidden="true" />
        <motion.span
          className="accent-wheel-knob"
          aria-hidden="true"
          animate={{ left: knobX, top: knobY, scale: dragging ? 1.35 : 1 }}
          transition={
            reduceMotion || dragging
              ? { duration: 0 }
              : { type: "spring", stiffness: 500, damping: 30 }
          }
        />
        <span className="accent-wheel-core" aria-hidden="true">
          <span className="accent-wheel-swatch" />
          <span className="accent-wheel-hex">{hex}</span>
          <span className="accent-wheel-deg">{Math.round(hue)}°</span>
        </span>
      </div>

      <div className="accent-presets" aria-label="Accent presets">
        {PRESETS.map((preset) => (
          <button
            key={preset.hue}
            type="button"
            className={`accent-preset${Math.round(hue) === preset.hue ? " active" : ""}`}
            style={{ ["--preset" as string]: `hsl(${preset.hue} 100% 66%)` }}
            aria-label={`Accent preset: ${preset.name}`}
            aria-pressed={Math.round(hue) === preset.hue}
            onClick={() => onChange(preset.hue)}
          />
        ))}
      </div>
    </div>
  );
}
