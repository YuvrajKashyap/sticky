"use client";

import { useReducedMotion } from "framer-motion";
import { useEffect, useRef } from "react";

/** Fired by the auth form so the field can react: "sent" | "error" | "google". */
export const AUTH_SIGNAL_EVENT = "sticky-auth-signal";

export type AuthSignal = "sent" | "error" | "google";

export function emitAuthSignal(signal: AuthSignal) {
  window.dispatchEvent(new CustomEvent<AuthSignal>(AUTH_SIGNAL_EVENT, { detail: signal }));
}

const CURSOR_RADIUS = 130;
const CENTER_PULL = 0.085;

/**
 * Flow-field particle canvas behind the access gate. Particles ride a slow
 * curl field, part around the pointer, and converge on the gate when a
 * sign-in link is sent. Single rAF loop, DPR capped at 2, paused when the
 * tab is hidden, no per-frame allocations beyond two Path2D buckets.
 */
export function GateField() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width = 0;
    let height = 0;
    let count = 0;
    let xs = new Float32Array(0);
    let ys = new Float32Array(0);
    let vxs = new Float32Array(0);
    let vys = new Float32Array(0);
    let tones = new Uint8Array(0);

    const pointer = { x: -9999, y: -9999, lastX: -9999, lastY: -9999, active: false };
    let energy = 0;
    let converge = 0;
    let scatter = 0;
    let frame = 0;
    let lastTime = 0;
    let running = true;
    let pointerBounds: DOMRect | null = null;

    function seed() {
      count = width < 720 ? 130 : width < 1200 ? 220 : 320;
      xs = new Float32Array(count);
      ys = new Float32Array(count);
      vxs = new Float32Array(count);
      vys = new Float32Array(count);
      tones = new Uint8Array(count);
      for (let i = 0; i < count; i += 1) {
        xs[i] = Math.random() * width;
        ys[i] = Math.random() * height;
        vxs[i] = (Math.random() - 0.5) * 0.4;
        vys[i] = (Math.random() - 0.5) * 0.4;
        tones[i] = Math.random() < 0.72 ? 0 : 1;
      }
    }

    function resize() {
      const rect = canvas!.getBoundingClientRect();
      pointerBounds = rect;
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      canvas!.width = Math.round(width * dpr);
      canvas!.height = Math.round(height * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.fillStyle = "#05070f";
      ctx!.fillRect(0, 0, width, height);
      seed();
    }

    function field(x: number, y: number, t: number) {
      return (
        Math.sin(x * 0.0021 + t * 0.00035) * 1.6 +
        Math.cos(y * 0.0019 - t * 0.00042) * 1.6 +
        Math.sin((x + y) * 0.0009 + t * 0.0002)
      );
    }

    function drawStatic() {
      ctx!.fillStyle = "#05070f";
      ctx!.fillRect(0, 0, width, height);
      for (let i = 0; i < count; i += 1) {
        ctx!.fillStyle = tones[i] ? "rgba(143, 123, 255, 0.55)" : "rgba(94, 224, 255, 0.5)";
        ctx!.fillRect(xs[i], ys[i], 1.5, 1.5);
      }
    }

    function tick(now: number) {
      if (!running) return;
      const dt = Math.min(Math.max(now - lastTime, 1), 40);
      lastTime = now;
      const step = dt / 16.67;

      // Trails: fade the previous frame instead of clearing it.
      ctx!.globalCompositeOperation = "source-over";
      ctx!.fillStyle = "rgba(5, 7, 15, 0.16)";
      ctx!.fillRect(0, 0, width, height);
      ctx!.globalCompositeOperation = "lighter";

      const cyan = new Path2D();
      const violet = new Path2D();
      const cx = width / 2;
      const cy = height / 2;
      const speedBoost = 1 + energy * 1.6;

      for (let i = 0; i < count; i += 1) {
        let x = xs[i];
        let y = ys[i];
        let vx = vxs[i];
        let vy = vys[i];

        const angle = field(x, y, now);
        vx += Math.cos(angle) * 0.055 * step;
        vy += Math.sin(angle) * 0.055 * step;

        if (pointer.active) {
          const dx = x - pointer.x;
          const dy = y - pointer.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < CURSOR_RADIUS * CURSOR_RADIUS && d2 > 0.01) {
            const d = Math.sqrt(d2);
            const force = (1 - d / CURSOR_RADIUS) * 0.95 * step;
            vx += (dx / d) * force;
            vy += (dy / d) * force;
          }
        }

        if (converge > 0.01) {
          vx += (cx - x) * CENTER_PULL * converge * 0.02 * step;
          vy += (cy - y) * CENTER_PULL * converge * 0.02 * step;
        }

        if (scatter > 0.01) {
          vx += (Math.random() - 0.5) * scatter * 1.4;
          vy += (Math.random() - 0.5) * scatter * 1.4;
        }

        vx *= 0.965;
        vy *= 0.965;
        x += vx * step * speedBoost;
        y += vy * step * speedBoost;

        if (x < -4) x = width + 4;
        else if (x > width + 4) x = -4;
        if (y < -4) y = height + 4;
        else if (y > height + 4) y = -4;

        xs[i] = x;
        ys[i] = y;
        vxs[i] = vx;
        vys[i] = vy;

        const path = tones[i] ? violet : cyan;
        path.moveTo(x - vx * 3.4, y - vy * 3.4);
        path.lineTo(x, y);
      }

      const glow = 0.62 + energy * 0.35;
      ctx!.lineWidth = 1.5 + energy * 0.7;
      ctx!.lineCap = "round";
      ctx!.strokeStyle = `rgba(94, 224, 255, ${Math.min(glow, 0.95)})`;
      ctx!.stroke(cyan);
      ctx!.strokeStyle = `rgba(143, 123, 255, ${Math.min(glow * 0.9, 0.9)})`;
      ctx!.stroke(violet);

      energy *= 0.965;
      converge *= 0.955;
      scatter *= 0.86;
      frame = requestAnimationFrame(tick);
    }

    function onPointerMove(event: PointerEvent) {
      // Every input still contributes to particle velocity, but a burst of
      // mouse events shares geometry until the canvas resizes or scrolls.
      const rect = pointerBounds ?? (pointerBounds = canvas!.getBoundingClientRect());
      pointer.x = event.clientX - rect.left;
      pointer.y = event.clientY - rect.top;
      pointer.active = true;
      if (pointer.lastX > -9000) {
        const speed = Math.hypot(pointer.x - pointer.lastX, pointer.y - pointer.lastY);
        energy = Math.min(1, energy + speed * 0.004);
      }
      pointer.lastX = pointer.x;
      pointer.lastY = pointer.y;
    }

    function onPointerLeave() {
      pointer.active = false;
      pointer.lastX = -9999;
      pointer.lastY = -9999;
    }

    function invalidatePointerBounds() {
      pointerBounds = null;
    }

    function onSignal(event: Event) {
      const signal = (event as CustomEvent<AuthSignal>).detail;
      if (signal === "sent") {
        converge = 1;
        energy = 1;
      } else if (signal === "error") {
        scatter = 1;
        energy = 0.8;
      } else {
        energy = 0.7;
      }
    }

    function onVisibility() {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(frame);
      } else if (!running && !reduceMotion) {
        running = true;
        lastTime = performance.now();
        frame = requestAnimationFrame(tick);
      }
    }

    resize();
    const observer = new ResizeObserver(() => resize());
    observer.observe(canvas);

    if (reduceMotion) {
      drawStatic();
      running = false;
    } else {
      lastTime = performance.now();
      frame = requestAnimationFrame(tick);
      // Read the canvas before React's bubbling spotlight handlers write styles.
      // Keep every event (including its velocity contribution), without a delay.
      window.addEventListener("pointermove", onPointerMove, { passive: true, capture: true });
      window.addEventListener("pointerdown", onPointerMove, { passive: true });
      window.addEventListener("scroll", invalidatePointerBounds, { passive: true, capture: true });
      window.addEventListener("resize", invalidatePointerBounds, { passive: true });
      window.visualViewport?.addEventListener("resize", invalidatePointerBounds, { passive: true });
      window.visualViewport?.addEventListener("scroll", invalidatePointerBounds, { passive: true });
      document.addEventListener("pointerleave", onPointerLeave);
      window.addEventListener("blur", onPointerLeave);
      document.addEventListener("visibilitychange", onVisibility);
      window.addEventListener(AUTH_SIGNAL_EVENT, onSignal);
    }

    return () => {
      running = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerdown", onPointerMove);
      window.removeEventListener("scroll", invalidatePointerBounds, true);
      window.removeEventListener("resize", invalidatePointerBounds);
      window.visualViewport?.removeEventListener("resize", invalidatePointerBounds);
      window.visualViewport?.removeEventListener("scroll", invalidatePointerBounds);
      document.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("blur", onPointerLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener(AUTH_SIGNAL_EVENT, onSignal);
    };
  }, [reduceMotion]);

  return <canvas ref={canvasRef} className="gate-canvas" aria-hidden="true" />;
}
