"use client";

import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type Transition,
} from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";

/** Shared spring vocabulary so every surface moves with the same physics. */
export const springs = {
  /** Cards, panels, anything with mass. */
  paper: { type: "spring", stiffness: 420, damping: 34, mass: 0.8 } satisfies Transition,
  /** Chips, toggles, small UI. */
  snappy: { type: "spring", stiffness: 640, damping: 38, mass: 0.6 } satisfies Transition,
  /** Large panels sliding in. */
  drawer: { type: "spring", stiffness: 340, damping: 36, mass: 0.9 } satisfies Transition,
  /** Playful settle used by pins and celebration moments. */
  bouncy: { type: "spring", stiffness: 520, damping: 22, mass: 0.7 } satisfies Transition,
};

/** Orchestrated entrance for board columns: settle in with a light paper drift. */
export function columnEntrance(index: number) {
  return {
    initial: { opacity: 0, y: 26, rotate: index % 2 ? 0.6 : -0.6 },
    animate: { opacity: 1, y: 0, rotate: 0 },
    transition: { ...springs.paper, delay: Math.min(index * 0.055, 0.5) },
  };
}

/**
 * A number that rolls to its next value on a spring instead of snapping.
 * Falls back to plain text under reduced motion.
 */
export function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const reduceMotion = useReducedMotion();
  const motionValue = useMotionValue(value);
  const rounded = useTransform(motionValue, (latest) => Math.round(latest).toLocaleString());
  const previous = useRef(value);

  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    const controls = animate(motionValue, value, { type: "spring", stiffness: 180, damping: 26 });
    return () => controls.stop();
  }, [motionValue, value]);

  if (reduceMotion) {
    return <span className={className}>{value.toLocaleString()}</span>;
  }

  return <motion.span className={className}>{rounded}</motion.span>;
}

/** SVG checkmark whose stroke draws itself when `checked` flips on. */
export function DrawnCheck({ checked, size = 18 }: { checked: boolean; size?: number }) {
  const reduceMotion = useReducedMotion();

  return (
    <svg
      className="drawn-check"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <motion.path
        d="M4.5 12.6 9.6 17.6 19.5 6.8"
        initial={false}
        animate={{ pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }}
        transition={
          reduceMotion
            ? { duration: 0 }
            : { pathLength: { duration: 0.28, ease: [0.3, 0, 0.2, 1] }, opacity: { duration: 0.08 } }
        }
      />
    </svg>
  );
}

/**
 * Arc-reactor progress ring: a ticked outer ring with a glowing arc that
 * springs to the current percentage. The number sits in the core.
 */
export function ArcRing({ value, size = 92, label }: { value: number; size?: number; label?: string }) {
  const reduceMotion = useReducedMotion();
  const clamped = Math.max(0, Math.min(100, value));
  const stroke = 5;
  const r = (size - stroke * 2 - 6) / 2;
  const circumference = 2 * Math.PI * r;
  const center = size / 2;

  return (
    <span className="arc-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        {/* tick ring */}
        <circle
          className="arc-ring-ticks"
          cx={center}
          cy={center}
          r={r + stroke + 2}
          fill="none"
          strokeWidth={2.5}
          strokeDasharray="1.5 5.5"
        />
        {/* track */}
        <circle
          className="arc-ring-track"
          cx={center}
          cy={center}
          r={r}
          fill="none"
          strokeWidth={stroke}
        />
        {/* progress arc */}
        <motion.circle
          className="arc-ring-arc"
          cx={center}
          cy={center}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          transform={`rotate(-90 ${center} ${center})`}
          initial={false}
          animate={{ strokeDashoffset: circumference * (1 - clamped / 100) }}
          transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 60, damping: 18 }}
        />
      </svg>
      <span className="arc-ring-core">
        <AnimatedNumber value={Math.round(clamped)} className="arc-ring-value" />
        <span className="arc-ring-unit">%</span>
        {label ? <span className="arc-ring-label">{label}</span> : null}
      </span>
    </span>
  );
}

type BurstParticle = {
  id: number;
  x: number;
  y: number;
  rotate: number;
  scale: number;
  shape: "square" | "circle" | "strip";
  delay: number;
};

function makeParticles(count: number): BurstParticle[] {
  return Array.from({ length: count }, (_, id) => {
    const angle = (Math.PI * 2 * id) / count + Math.random() * 0.9;
    const distance = 26 + Math.random() * 34;
    return {
      id,
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance - 14,
      rotate: Math.random() * 260 - 130,
      scale: 0.55 + Math.random() * 0.75,
      shape: (["square", "circle", "strip"] as const)[id % 3],
      delay: Math.random() * 0.05,
    };
  });
}

/**
 * A small paper-confetti burst anchored to wherever it is rendered.
 * Fire-and-forget: mounts, plays once, then calls onDone.
 */
export function ConfettiBurst({ onDone }: { onDone?: () => void }) {
  const reduceMotion = useReducedMotion();
  const particles = useMemo(() => makeParticles(14), []);
  const [live, setLive] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLive(false);
      onDone?.();
    }, reduceMotion ? 0 : 700);
    return () => window.clearTimeout(timer);
  }, [onDone, reduceMotion]);

  if (!live || reduceMotion) return null;

  return (
    <span className="confetti-burst" aria-hidden="true">
      {particles.map((particle) => (
        <motion.i
          key={particle.id}
          className={`confetti-piece confetti-${particle.shape}`}
          initial={{ x: 0, y: 0, scale: 0, rotate: 0, opacity: 1 }}
          animate={{
            x: particle.x,
            y: particle.y + 26,
            scale: particle.scale,
            rotate: particle.rotate,
            opacity: 0,
          }}
          transition={{ duration: 0.62, delay: particle.delay, ease: [0.16, 0.6, 0.4, 1] }}
        />
      ))}
    </span>
  );
}
