"use client";

import { monthDaysLabel } from "@sticky/domain";

export function MonthDaysPicker({ value, onChange }: { value: number[]; onChange: (days: number[]) => void }) {
  const selected = [...new Set(value)];
  function toggle(day: number) {
    if (selected.includes(day) && selected.length === 1) return;
    onChange(selected.includes(day) ? selected.filter(item => item !== day) : [...selected, day]);
  }
  return (
    <div className="month-days-picker" role="group" aria-label="Days of the month">
      <div className="month-days-heading"><span>On these dates</span><span>Choose one or more</span></div>
      <div className="month-days-grid">
        {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
          <button key={day} type="button" className={selected.includes(day) ? "selected" : ""}
            aria-label={`Repeat on day ${day}`} aria-pressed={selected.includes(day)} onClick={() => toggle(day)}>{day}</button>
        ))}
        <button type="button" className={`month-days-last${selected.includes(-1) ? " selected" : ""}`}
          aria-label="Repeat on last day" aria-pressed={selected.includes(-1)} onClick={() => toggle(-1)}>Last day</button>
      </div>
      <div className="month-days-presets">
        <button type="button" onClick={() => onChange([1])}>1st</button>
        <button type="button" onClick={() => onChange([1, 15])}>1st &amp; 15th</button>
        <button type="button" onClick={() => onChange([-1])}>Month end</button>
        <button type="button" onClick={() => onChange(Array.from({ length: 31 }, (_, i) => i + 1))}>Every day</button>
      </div>
      <p className="month-days-selection" aria-live="polite">{monthDaysLabel(selected)}</p>
      {selected.some(day => day >= 29) ? <p className="month-days-hint">Shorter months use their last day. Overlapping dates repeat once.</p> : null}
    </div>
  );
}
