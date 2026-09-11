"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const clamp = (value: number) => Math.max(0.6, Math.min(1.4, Math.round(value * 100) / 100));

export function useMobileWorkspaceZoom(landscape: boolean) {
  const ref = useRef<HTMLElement>(null);
  const [enabled, setEnabled] = useState(false);
  const [scale, setScale] = useState(1);
  const suppressClickUntil = useRef(0);
  const key = `sticky:mobile-zoom:${landscape ? "landscape" : "portrait"}`;
  const defaultScale = landscape ? 0.7 : 1;

  useEffect(() => {
    const query = matchMedia("(pointer: coarse) and (max-width: 1024px)");
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setEnabled(query.matches);
        let stored = defaultScale;
        try {
          const value = Number(localStorage.getItem(key));
          if (Number.isFinite(value) && value >= 0.6 && value <= 1.4) stored = value;
        } catch { /* Private browsing can disable preference storage. */ }
        setScale(stored);
      });
    };
    update();
    query.addEventListener("change", update);
    return () => { cancelAnimationFrame(frame); query.removeEventListener("change", update); };
  }, [key, defaultScale]);

  const resize = useCallback((value: number) => {
    const next = clamp(value);
    setScale(next);
    try { localStorage.setItem(key, String(next)); } catch { /* Session-only fallback. */ }
  }, [key]);

  useEffect(() => {
    const root = ref.current;
    if (!root || !enabled) return;
    let startDistance = 0;
    let next = scale;
    let frame = 0;
    const distance = (touches: TouchList) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    const start = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      // A second finger changes the gesture from a possible drag to a resize.
      // Cancel pending dnd-kit sensors before they can activate their delay.
      event.touches[0].target.dispatchEvent(new Event("touchcancel", { bubbles: true }));
      root.dispatchEvent(new Event("pointercancel", { bubbles: true }));
      startDistance = distance(event.touches);
      event.preventDefault();
      event.stopPropagation();
    };
    const move = (event: TouchEvent) => {
      if (!startDistance || event.touches.length !== 2) return;
      event.preventDefault();
      event.stopPropagation();
      next = clamp(scale * distance(event.touches) / startDistance);
      cancelAnimationFrame(frame);
      // Paint once per frame without re-rendering the task tree during a pinch.
      frame = requestAnimationFrame(() => root.style.setProperty("--mobile-zoom", String(next)));
    };
    const end = (event: TouchEvent) => {
      if (!startDistance || event.touches.length >= 2) return;
      startDistance = 0;
      cancelAnimationFrame(frame);
      root.style.setProperty("--mobile-zoom", String(next));
      suppressClickUntil.current = performance.now() + 400;
      event.preventDefault();
      event.stopPropagation();
      resize(next);
    };
    const click = (event: MouseEvent) => {
      if (performance.now() < suppressClickUntil.current) { event.preventDefault(); event.stopPropagation(); }
    };
    const gesture = (event: Event) => event.preventDefault();
    const options = { passive: false, capture: true };
    root.addEventListener("touchstart", start, options);
    root.addEventListener("touchmove", move, options);
    root.addEventListener("touchend", end, options);
    root.addEventListener("touchcancel", end, options);
    root.addEventListener("click", click, true);
    root.addEventListener("gesturestart", gesture, options);
    root.addEventListener("gesturechange", gesture, options);
    return () => {
      cancelAnimationFrame(frame);
      root.removeEventListener("touchstart", start, true);
      root.removeEventListener("touchmove", move, true);
      root.removeEventListener("touchend", end, true);
      root.removeEventListener("touchcancel", end, true);
      root.removeEventListener("click", click, true);
      root.removeEventListener("gesturestart", gesture, true);
      root.removeEventListener("gesturechange", gesture, true);
    };
  }, [enabled, scale, resize]);

  return { ref, enabled, scale, resize, reset: () => resize(defaultScale) };
}
