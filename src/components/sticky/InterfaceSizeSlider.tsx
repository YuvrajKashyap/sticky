"use client";

import { useRef } from "react";

/** Relative screen-pixel dragging avoids feedback from resizing the slider itself. */
export function InterfaceSizeSlider({ value, min, max, step, label, onChange, className = "interface-scale-slider" }: {
  value: number; min: number; max: number; step: number; label: string;
  className?: string;
  onChange: (value: number) => void;
}) {
  const drag = useRef<{ x: number; value: number; pointerId: number } | null>(null);
  return <input
    type="range" className={className}
    min={min} max={max} step={step} value={value} aria-label={label}
    style={{ touchAction: "none" }}
    onChange={event => onChange(Number(event.target.value))}
    onPointerDown={event => {
      if (!event.isPrimary || event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { x: event.clientX, value, pointerId: event.pointerId };
    }}
    onPointerMove={event => {
      const start = drag.current;
      if (!start || start.pointerId !== event.pointerId) return;
      const next = start.value + Math.round((event.clientX - start.x) / (80 * step)) * step;
      onChange(Math.max(min, Math.min(max, next)));
    }}
    onPointerUp={event => {
      if (drag.current?.pointerId === event.pointerId) {
        drag.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }}
    onPointerCancel={() => { drag.current = null; }}
    onLostPointerCapture={() => { drag.current = null; }}
  />;
}
