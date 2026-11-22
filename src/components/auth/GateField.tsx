"use client";

import { useReducedMotion } from "framer-motion";
import { useEffect, useRef } from "react";

/** Fired by the auth form so the field can react: "sent" | "error" | "google". */
export const AUTH_SIGNAL_EVENT = "sticky-auth-signal";

export type AuthSignal = "sent" | "error" | "google";

export function emitAuthSignal(signal: AuthSignal) {
  window.dispatchEvent(new CustomEvent<AuthSignal>(AUTH_SIGNAL_EVENT, { detail: signal }));
}

type Mode = {
  /** How far the noise may rotate the base direction, in radians. */
  amp: number;
  scale: number;
  speed: number;
  /** Blend toward a slow rotation around the centre. */
  orbit: number;
  alpha: number;
};

const MODES: Record<"calm" | "rush" | "gather", Mode> = {
  calm: { amp: 0.38, scale: 0.0016, speed: 1.15, orbit: 0, alpha: 1 },
  rush: { amp: 0.16, scale: 0.0012, speed: 2.6, orbit: 0, alpha: 0.85 },
  gather: { amp: 1.5, scale: 0.0021, speed: 0.75, orbit: 0.2, alpha: 0.7 },
};

const BASE_STROKE = "rgba(206, 216, 255, 0.4)";
const ACCENT_STROKE = "#63e6ff";
const ERROR_STROKE = "#ff7a90";

type Vortex = { x: number; y: number; vx: number; vy: number; power: number };

/**
 * The living background of the access gate: a few thousand particles tracing
 * a flow field onto a transparent canvas. Lines part around the pointer, curl
 * behind it, and get carried along its path; accent lines are born in slowly
 * drifting bands so colour reads as currents. A sent link throws every line
 * outward from the centre; an error flushes the field red for a beat.
 */
export function GateField() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const ctx = context;
    const node = canvas;

    let width = 1;
    let height = 1;
    let count = 0;
    let px = new Float32Array(0);
    let py = new Float32Array(0);
    let vx = new Float32Array(0);
    let vy = new Float32Array(0);
    let life = new Int16Array(0);
    let accent = new Uint8Array(0);

    let time = Math.random() * 100;
    let running = false;
    let raf = 0;
    let burstGlow = 0;
    let errorGlow = 0;
    let target: Mode = MODES.calm;
    let modeTimer = 0;
    const now: Mode = { ...MODES.calm };

    const pointer = { x: 0, y: 0, lastX: 0, lastY: 0, inside: false };
    const wake: Vortex[] = [];
    let pointerBounds: DOMRect | null = null;

    function spawn(i: number) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      px[i] = x;
      py[i] = y;
      vx[i] = 0;
      vy[i] = 0;
      life[i] = 70 + Math.random() * 210;
      accent[i] = Math.sin(y * 0.011 + x * 0.003 + time * 1.6) > 0.8 ? 1 : 0;
    }

    function resize() {
      const rect = node.getBoundingClientRect();
      pointerBounds = rect;
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      let ratio = Math.min(window.devicePixelRatio || 1, 2);
      if (width * ratio > 2600) ratio = 1.5;
      node.width = Math.round(width * ratio);
      node.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.lineWidth = 1;
      ctx.lineCap = "round";

      const wanted = Math.round(Math.min(width < 760 ? 1500 : 4600, (width * height) / 330));
      if (wanted !== count) {
        count = wanted;
        px = new Float32Array(count);
        py = new Float32Array(count);
        vx = new Float32Array(count);
        vy = new Float32Array(count);
        life = new Int16Array(count);
        accent = new Uint8Array(count);
        for (let i = 0; i < count; i += 1) spawn(i);
      }
      if (reduceMotion) drawStill();
    }

    function step(fade: boolean) {
      time += 0.0035;

      now.amp += (target.amp - now.amp) * 0.03;
      now.scale += (target.scale - now.scale) * 0.03;
      now.speed += (target.speed - now.speed) * 0.03;
      now.orbit += (target.orbit - now.orbit) * 0.03;
      now.alpha += (target.alpha - now.alpha) * 0.04;
      burstGlow *= 0.965;
      errorGlow *= 0.95;

      for (let i = wake.length - 1; i >= 0; i -= 1) {
        wake[i].power *= 0.955;
        if (wake[i].power < 0.03) wake.splice(i, 1);
      }
      const hover: Vortex | null = pointer.inside ? { x: pointer.x, y: pointer.y, vx: 0, vy: 0, power: 0.7 } : null;
      const forceCount = wake.length + (hover ? 1 : 0);

      const basePath = new Path2D();
      const accentPath = new Path2D();

      if (fade) {
        ctx.globalCompositeOperation = "destination-out";
        ctx.globalAlpha = 1;
        ctx.fillStyle = "rgba(0,0,0,0.085)";
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = "source-over";
      }

      const { amp, scale, speed, orbit } = now;
      const cx = width / 2;
      const cy = height / 2;
      const reach = width < 760 ? 130 : 190;
      const reach2 = reach * reach;
      const t = time * 60 * 0.02;
      const allAccent = burstGlow > 0.35;

      for (let i = 0; i < count; i += 1) {
        const x = px[i];
        const y = py[i];

        const noise =
          (Math.sin(x * scale + t * 1.3) +
            Math.sin(y * scale * 1.7 - t) +
            Math.sin((x + y) * scale * 0.6 + t * 0.7) +
            Math.sin((x - y) * scale * 1.3 - t * 0.4)) *
          0.33;
        const angle = noise * amp;
        const pace = speed * (accent[i] ? 1.55 : 1);
        let tx = Math.cos(angle) * pace;
        let ty = Math.sin(angle) * pace;

        if (orbit > 0.01) {
          const ox = x - cx;
          const oy = y - cy;
          const radius = Math.sqrt(ox * ox + oy * oy) + 1;
          tx = tx * (1 - orbit) + (-oy / radius) * pace * 1.5 * orbit;
          ty = ty * (1 - orbit) + (ox / radius) * pace * 1.5 * orbit;
        }

        let velX = vx[i] + (tx - vx[i]) * 0.07;
        let velY = vy[i] + (ty - vy[i]) * 0.07;

        for (let f = 0; f < forceCount; f += 1) {
          const force = f < wake.length ? wake[f] : hover!;
          const ox = x - force.x;
          const oy = y - force.y;
          const d2 = ox * ox + oy * oy;
          if (d2 > reach2 || d2 < 0.01) continue;
          const d = Math.sqrt(d2);
          const fall = 1 - d / reach;
          const push = fall * fall * force.power;
          // Part around the pointer, curl behind it, and ride along its path.
          velX += (ox / d) * push * 0.9 + (-oy / d) * push * 1.5 + force.vx * push * 0.07;
          velY += (oy / d) * push * 0.9 + (ox / d) * push * 1.5 + force.vy * push * 0.07;
        }

        const nx = x + velX;
        const ny = y + velY;
        const path = accent[i] || allAccent ? accentPath : basePath;
        path.moveTo(x, y);
        path.lineTo(nx, ny);

        px[i] = nx;
        py[i] = ny;
        vx[i] = velX;
        vy[i] = velY;
        life[i] -= 1;
        if (life[i] <= 0 || nx < -30 || nx > width + 30 || ny < -30 || ny > height + 30) spawn(i);
      }

      ctx.globalAlpha = Math.min(1, now.alpha + burstGlow);
      ctx.strokeStyle = errorGlow > 0.2 ? ERROR_STROKE : BASE_STROKE;
      ctx.stroke(basePath);
      ctx.strokeStyle = errorGlow > 0.2 ? ERROR_STROKE : ACCENT_STROKE;
      ctx.stroke(accentPath);
    }

    /** Reduced motion: a still drawing of the streamlines, no animation loop. */
    function drawStill() {
      ctx.clearRect(0, 0, width, height);
      Object.assign(now, target);
      const keep = now.alpha;
      now.alpha = keep * 0.55;
      for (let i = 0; i < count; i += 1) spawn(i);
      for (let i = 0; i < 60; i += 1) step(false);
      now.alpha = keep;
    }

    function loop() {
      if (!running) return;
      step(true);
      raf = requestAnimationFrame(loop);
    }
    function start() {
      if (running || reduceMotion || document.hidden) return;
      running = true;
      raf = requestAnimationFrame(loop);
    }
    function stop() {
      running = false;
      cancelAnimationFrame(raf);
    }

    function burst(x: number, y: number, strength: number) {
      burstGlow = strength;
      const range = Math.max(width, height);
      for (let i = 0; i < count; i += 1) {
        const ox = px[i] - x;
        const oy = py[i] - y;
        const d = Math.sqrt(ox * ox + oy * oy) + 1;
        const kick = (1 - Math.min(1, d / range)) * (10 + Math.random() * 16) * strength;
        vx[i] += (ox / d) * kick + (-oy / d) * kick * 0.35;
        vy[i] += (oy / d) * kick + (ox / d) * kick * 0.35;
        life[i] = 90 + Math.random() * 120;
      }
    }

    function onPointerMove(event: PointerEvent) {
      // A burst of mouse events shares geometry until the canvas resizes or scrolls.
      const rect = pointerBounds ?? (pointerBounds = node.getBoundingClientRect());
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (!pointer.inside) {
        pointer.lastX = x;
        pointer.lastY = y;
      }
      pointer.inside = true;
      pointer.x = x;
      pointer.y = y;
      const mx = x - pointer.lastX;
      const my = y - pointer.lastY;
      if (mx * mx + my * my > 90) {
        wake.push({ x, y, vx: mx, vy: my, power: Math.min(1.6, 0.5 + Math.hypot(mx, my) * 0.03) });
        if (wake.length > 10) wake.shift();
        pointer.lastX = x;
        pointer.lastY = y;
      }
    }

    function onPointerGone() {
      pointer.inside = false;
    }

    function invalidatePointerBounds() {
      pointerBounds = null;
    }

    function onSignal(event: Event) {
      const signal = (event as CustomEvent<AuthSignal>).detail;
      window.clearTimeout(modeTimer);
      if (signal === "sent") {
        burst(width / 2, height / 2, 1);
        target = MODES.gather;
        modeTimer = window.setTimeout(() => (target = MODES.calm), 4200);
      } else if (signal === "error") {
        errorGlow = 1;
        burst(width / 2, height / 2, 0.35);
      } else {
        target = MODES.rush;
        modeTimer = window.setTimeout(() => (target = MODES.calm), 6000);
      }
    }

    function onVisibility() {
      if (document.hidden) stop();
      else start();
    }

    resize();
    const observer = new ResizeObserver(() => resize());
    observer.observe(node);

    if (!reduceMotion) {
      // Read the canvas before React's bubbling spotlight handlers write styles.
      window.addEventListener("pointermove", onPointerMove, { passive: true, capture: true });
      window.addEventListener("pointerdown", onPointerMove, { passive: true });
      window.addEventListener("scroll", invalidatePointerBounds, { passive: true, capture: true });
      window.addEventListener("resize", invalidatePointerBounds, { passive: true });
      window.visualViewport?.addEventListener("resize", invalidatePointerBounds, { passive: true });
      window.visualViewport?.addEventListener("scroll", invalidatePointerBounds, { passive: true });
      document.documentElement.addEventListener("pointerleave", onPointerGone);
      window.addEventListener("blur", onPointerGone);
      document.addEventListener("visibilitychange", onVisibility);
      window.addEventListener(AUTH_SIGNAL_EVENT, onSignal);
      start();
    }

    return () => {
      stop();
      window.clearTimeout(modeTimer);
      observer.disconnect();
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerdown", onPointerMove);
      window.removeEventListener("scroll", invalidatePointerBounds, true);
      window.removeEventListener("resize", invalidatePointerBounds);
      window.visualViewport?.removeEventListener("resize", invalidatePointerBounds);
      window.visualViewport?.removeEventListener("scroll", invalidatePointerBounds);
      document.documentElement.removeEventListener("pointerleave", onPointerGone);
      window.removeEventListener("blur", onPointerGone);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener(AUTH_SIGNAL_EVENT, onSignal);
    };
  }, [reduceMotion]);

  return <canvas ref={canvasRef} className="gate-canvas" aria-hidden="true" />;
}
