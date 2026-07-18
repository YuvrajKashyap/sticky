"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Minus,
  Plus,
  Repeat2,
} from "lucide-react";
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { useState } from "react";
import { AnimatedNumber, springs } from "./motion";

export type CaptureRepeatFrequency = "daily" | "weekly" | "monthly" | "yearly";

export type CaptureRepeat = {
  frequency: CaptureRepeatFrequency;
  interval: number;
  daysOfWeek: number[];
};

export type CaptureSchedule = {
  dueDate: string;
  dueTime: string;
  repeat: CaptureRepeat | null;
};

const DAYS = [
  { value: 0, letter: "S", short: "Sun" },
  { value: 1, letter: "M", short: "Mon" },
  { value: 2, letter: "T", short: "Tue" },
  { value: 3, letter: "W", short: "Wed" },
  { value: 4, letter: "T", short: "Thu" },
  { value: 5, letter: "F", short: "Fri" },
  { value: 6, letter: "S", short: "Sat" },
];

const REPEAT_UNITS: Record<CaptureRepeatFrequency, [string, string]> = {
  daily: ["day", "days"],
  weekly: ["week", "weeks"],
  monthly: ["month", "months"],
  yearly: ["year", "years"],
};

const REPEAT_SIMPLE_LABELS: Record<CaptureRepeatFrequency, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
};

function dateKey(date: Date) {
  return format(date, "yyyy-MM-dd");
}

function sortedDays(days: number[]) {
  return [...new Set(days)].sort((a, b) => a - b);
}

export function captureDateLabel(dueDate: string) {
  const today = new Date();

  if (dueDate === dateKey(today)) {
    return "Today";
  }

  if (dueDate === dateKey(addDays(today, 1))) {
    return "Tomorrow";
  }

  const date = new Date(`${dueDate}T00:00:00`);
  return format(date, date.getFullYear() === today.getFullYear() ? "EEE, MMM d" : "MMM d, yyyy");
}

export function captureTimeLabel(dueTime: string) {
  const parts = timeParts(dueTime);

  if (!parts) {
    return dueTime;
  }

  const date = new Date();
  date.setHours(parts.hour24, parts.minute, 0, 0);
  return format(date, "h:mm a");
}

export function captureRepeatLabel(repeat: CaptureRepeat) {
  const base =
    repeat.interval === 1
      ? REPEAT_SIMPLE_LABELS[repeat.frequency]
      : `Every ${repeat.interval} ${REPEAT_UNITS[repeat.frequency][1]}`;

  if (repeat.frequency === "weekly" && repeat.daysOfWeek.length) {
    const days = sortedDays(repeat.daysOfWeek);
    const set = days.join(",");
    const dayLabel =
      set === "1,2,3,4,5"
        ? "Weekdays"
        : set === "0,6"
          ? "Weekends"
          : set === "0,1,2,3,4,5,6"
            ? "Every day"
            : days.map((day) => DAYS[day].short).join(" ");
    return `${base} · ${dayLabel}`;
  }

  return base;
}

export function captureRepeatSummary(repeat: CaptureRepeat) {
  const unit = REPEAT_UNITS[repeat.frequency][repeat.interval === 1 ? 0 : 1];
  const every = repeat.interval === 1 ? `Repeats every ${unit}` : `Repeats every ${repeat.interval} ${unit}`;

  if (repeat.frequency === "weekly" && repeat.daysOfWeek.length) {
    const names = sortedDays(repeat.daysOfWeek).map((day) => DAYS[day].short);
    const list =
      names.length > 1 ? `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}` : names[0];
    return `${every} on ${list}`;
  }

  return every;
}

function timeParts(value: string) {
  const match = /^(\d{1,2}):(\d{2})/.exec(value);

  if (!match) {
    return null;
  }

  return { hour24: Number(match[1]), minute: Number(match[2]) };
}

function buildTime(hour12: number, minute: number, meridiem: "AM" | "PM") {
  const hour24 = meridiem === "PM" ? (hour12 % 12) + 12 : hour12 % 12;
  return `${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

type PanelKind = "date" | "time" | "repeat";

const panelStagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.035, delayChildren: 0.03 } },
};

const panelRow = {
  hidden: { opacity: 0, y: 7 },
  show: { opacity: 1, y: 0, transition: springs.snappy },
};

export function SchedulerChip({
  icon,
  label,
  open,
  ariaLabel,
  onClick,
}: {
  icon: React.ReactNode;
  label: string | null;
  open: boolean;
  ariaLabel: string;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      layout
      className={`scheduler-chip${label ? " armed" : ""}${open ? " open" : ""}`}
      onClick={onClick}
      aria-expanded={open}
      aria-label={ariaLabel}
      whileTap={{ scale: 0.92 }}
      transition={springs.snappy}
    >
      <motion.span layout className="scheduler-chip-icon">
        {icon}
      </motion.span>
      <AnimatePresence initial={false}>
        {label ? (
          <motion.span
            key="label"
            className="scheduler-chip-label"
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: "auto" }}
            exit={{ opacity: 0, width: 0 }}
            transition={springs.snappy}
          >
            {label}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </motion.button>
  );
}

function PanelHead({
  title,
  showClear,
  onClear,
}: {
  title: string;
  showClear: boolean;
  onClear: () => void;
}) {
  return (
    <motion.div className="scheduler-panel-head" variants={panelRow}>
      <span>{title}</span>
      <AnimatePresence initial={false}>
        {showClear ? (
          <motion.button
            type="button"
            className="scheduler-panel-clear"
            onClick={onClear}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={springs.snappy}
          >
            Clear
          </motion.button>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}

export function DatePanel({
  value,
  onPick,
  onClear,
}: {
  value: string;
  onPick: (date: string) => void;
  onClear: () => void;
}) {
  const today = new Date();
  const todayKey = dateKey(today);
  const [cursor, setCursor] = useState(() =>
    startOfMonth(value ? new Date(`${value}T00:00:00`) : today),
  );
  const [slideDirection, setSlideDirection] = useState(0);
  const gridStart = startOfWeek(startOfMonth(cursor));
  const gridEnd = endOfWeek(endOfMonth(cursor));
  const days: Date[] = [];

  for (let day = gridStart; day <= gridEnd; day = addDays(day, 1)) {
    days.push(day);
  }

  const weekendDelta = (6 - today.getDay() + 7) % 7;
  const quickPicks = [
    { label: "Today", date: todayKey },
    { label: "Tomorrow", date: dateKey(addDays(today, 1)) },
    { label: "Weekend", date: dateKey(addDays(today, weekendDelta === 0 ? 7 : weekendDelta)) },
    { label: "Next week", date: dateKey(addDays(today, 7)) },
  ];

  function shiftMonth(direction: -1 | 1) {
    setSlideDirection(direction);
    setCursor((current) => addMonths(current, direction));
  }

  return (
    <motion.div
      className="scheduler-panel"
      role="group"
      aria-label="Pick a due date"
      variants={panelStagger}
      initial="hidden"
      animate="show"
    >
      <PanelHead title="Due date" showClear={Boolean(value)} onClear={onClear} />
      <motion.div className="scheduler-quick-row" variants={panelRow}>
        {quickPicks.map((pick) => (
          <motion.button
            key={pick.label}
            type="button"
            className={`scheduler-quick-pick${value === pick.date ? " on" : ""}`}
            onClick={() => onPick(pick.date)}
            whileTap={{ scale: 0.92 }}
          >
            {pick.label}
          </motion.button>
        ))}
      </motion.div>
      <motion.div className="scheduler-cal-head" variants={panelRow}>
        <button
          type="button"
          className="scheduler-cal-nav"
          onClick={() => shiftMonth(-1)}
          aria-label="Previous month"
        >
          <ChevronLeft size={14} />
        </button>
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={format(cursor, "yyyy-MM")}
            className="scheduler-cal-month"
            initial={{ opacity: 0, x: slideDirection * 18 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: slideDirection * -18 }}
            transition={springs.snappy}
          >
            {format(cursor, "MMMM yyyy")}
          </motion.span>
        </AnimatePresence>
        <button
          type="button"
          className="scheduler-cal-nav"
          onClick={() => shiftMonth(1)}
          aria-label="Next month"
        >
          <ChevronRight size={14} />
        </button>
      </motion.div>
      <motion.div className="scheduler-cal" variants={panelRow}>
        <div className="scheduler-cal-dows" aria-hidden="true">
          {DAYS.map((day) => (
            <span key={day.value}>{day.letter}</span>
          ))}
        </div>
        <AnimatePresence initial={false} mode="popLayout">
          <motion.div
            key={format(cursor, "yyyy-MM")}
            className="scheduler-cal-grid"
            initial={{ opacity: 0, x: slideDirection * 26 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: slideDirection * -26 }}
            transition={springs.paper}
          >
            {days.map((day) => {
              const key = dateKey(day);
              const outside = day.getMonth() !== cursor.getMonth();
              const selected = key === value;

              return (
                <button
                  key={key}
                  type="button"
                  className={`scheduler-cal-day${outside ? " outside" : ""}${
                    key === todayKey ? " today" : ""
                  }${selected ? " selected" : ""}`}
                  aria-label={`Due ${format(day, "EEEE, MMMM d, yyyy")}`}
                  aria-pressed={selected}
                  onClick={() => onPick(key)}
                >
                  {selected ? (
                    <motion.span
                      className="scheduler-day-halo"
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={springs.bouncy}
                    />
                  ) : null}
                  <span className="scheduler-day-num">{day.getDate()}</span>
                </button>
              );
            })}
          </motion.div>
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}

const TIME_PRESETS = [
  { label: "Morning", value: "09:00" },
  { label: "Noon", value: "12:00" },
  { label: "Afternoon", value: "14:00" },
  { label: "Evening", value: "17:00" },
  { label: "Night", value: "20:00" },
];

const MINUTE_OPTIONS = [0, 15, 30, 45];

export function TimePanel({
  value,
  onPick,
  onClear,
}: {
  value: string;
  onPick: (time: string, done?: boolean) => void;
  onClear: () => void;
}) {
  const parts = timeParts(value);
  const hour12 = parts ? ((parts.hour24 + 11) % 12) + 1 : null;
  const minute = parts ? parts.minute : null;
  const meridiem: "AM" | "PM" | null = parts ? (parts.hour24 >= 12 ? "PM" : "AM") : null;

  function pickHour(nextHour: number) {
    // First touch infers the half of day: 7-11 reads as morning, the rest evening.
    const nextMeridiem = meridiem ?? (nextHour >= 7 && nextHour <= 11 ? "AM" : "PM");
    onPick(buildTime(nextHour, minute ?? 0, nextMeridiem));
  }

  function pickMinute(nextMinute: number) {
    onPick(buildTime(hour12 ?? 9, nextMinute, meridiem ?? "AM"));
  }

  function pickMeridiem(nextMeridiem: "AM" | "PM") {
    onPick(buildTime(hour12 ?? 9, minute ?? 0, nextMeridiem));
  }

  return (
    <motion.div
      className="scheduler-panel"
      role="group"
      aria-label="Pick a due time"
      variants={panelStagger}
      initial="hidden"
      animate="show"
    >
      <PanelHead title="Time" showClear={Boolean(value)} onClear={onClear} />
      <motion.div className="scheduler-quick-row" variants={panelRow}>
        {TIME_PRESETS.map((preset) => (
          <motion.button
            key={preset.value}
            type="button"
            className={`scheduler-quick-pick${value === preset.value ? " on" : ""}`}
            onClick={() => onPick(preset.value, true)}
            whileTap={{ scale: 0.92 }}
          >
            {preset.label}
          </motion.button>
        ))}
      </motion.div>
      <motion.div className="scheduler-hour-grid" variants={panelRow} role="group" aria-label="Hour">
        {Array.from({ length: 12 }, (_, index) => index + 1).map((hour) => (
          <button
            key={hour}
            type="button"
            className={`scheduler-time-cell${hour12 === hour ? " on" : ""}`}
            aria-pressed={hour12 === hour}
            onClick={() => pickHour(hour)}
          >
            {hour}
          </button>
        ))}
      </motion.div>
      <motion.div className="scheduler-time-row" variants={panelRow}>
        <div className="scheduler-minute-row" role="group" aria-label="Minutes">
          {MINUTE_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              className={`scheduler-time-cell${minute === option ? " on" : ""}`}
              aria-pressed={minute === option}
              onClick={() => pickMinute(option)}
            >
              :{String(option).padStart(2, "0")}
            </button>
          ))}
        </div>
        <div className="scheduler-seg" role="group" aria-label="AM or PM">
          {(["AM", "PM"] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={`scheduler-seg-option${meridiem === option ? " on" : ""}`}
              aria-pressed={meridiem === option}
              onClick={() => pickMeridiem(option)}
            >
              {meridiem === option ? (
                <motion.span
                  className="scheduler-seg-pill"
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={springs.snappy}
                />
              ) : null}
              <span className="scheduler-seg-text">{option}</span>
            </button>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}

const FREQUENCY_OPTIONS: Array<{ key: CaptureRepeatFrequency | "off"; label: string }> = [
  { key: "off", label: "Off" },
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
  { key: "yearly", label: "Yearly" },
];

const WEEKDAY_PRESETS = [
  { label: "Weekdays", days: [1, 2, 3, 4, 5] },
  { label: "Weekends", days: [0, 6] },
  { label: "Every day", days: [0, 1, 2, 3, 4, 5, 6] },
];

function RepeatPanel({
  repeat,
  dueDate,
  onChange,
  onClear,
}: {
  repeat: CaptureRepeat | null;
  dueDate: string;
  onChange: (repeat: CaptureRepeat) => void;
  onClear: () => void;
}) {
  const anchorDay = new Date(`${dueDate || dateKey(new Date())}T00:00:00`).getDay();
  const activeKey = repeat?.frequency ?? "off";
  const selectedDays = sortedDays(repeat?.daysOfWeek ?? []);

  function setFrequency(key: CaptureRepeatFrequency | "off") {
    if (key === "off") {
      onClear();
      return;
    }

    onChange({
      frequency: key,
      interval: repeat?.interval ?? 1,
      daysOfWeek: key === "weekly" ? (selectedDays.length ? selectedDays : [anchorDay]) : [],
    });
  }

  function stepInterval(direction: -1 | 1) {
    if (!repeat) {
      return;
    }

    onChange({
      ...repeat,
      interval: Math.min(12, Math.max(1, repeat.interval + direction)),
    });
  }

  function toggleDay(day: number) {
    if (!repeat) {
      return;
    }

    const active = selectedDays.includes(day);

    if (active && selectedDays.length === 1) {
      return;
    }

    onChange({
      ...repeat,
      daysOfWeek: active ? selectedDays.filter((item) => item !== day) : [...selectedDays, day],
    });
  }

  const intervalUnit = repeat
    ? REPEAT_UNITS[repeat.frequency][repeat.interval === 1 ? 0 : 1]
    : "week";

  return (
    <motion.div
      className="scheduler-panel"
      role="group"
      aria-label="Pick a repeat cadence"
      variants={panelStagger}
      initial="hidden"
      animate="show"
    >
      <PanelHead title="Repeat" showClear={Boolean(repeat)} onClear={onClear} />
      <motion.div className="scheduler-seg scheduler-freq-seg" variants={panelRow} role="group" aria-label="Repeat frequency">
        {FREQUENCY_OPTIONS.map((option) => (
          <button
            key={option.key}
            type="button"
            className={`scheduler-seg-option${activeKey === option.key ? " on" : ""}`}
            aria-pressed={activeKey === option.key}
            onClick={() => setFrequency(option.key)}
          >
            {activeKey === option.key ? (
              <motion.span
                className="scheduler-seg-pill"
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={springs.snappy}
              />
            ) : null}
            <span className="scheduler-seg-text">{option.label}</span>
          </button>
        ))}
      </motion.div>
      <AnimatePresence initial={false}>
        {repeat ? (
          <motion.div
            key="repeat-detail"
            className="scheduler-repeat-detail"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={springs.paper}
          >
            <div className="scheduler-interval" role="group" aria-label="Repeat interval">
              <span className="scheduler-interval-copy">every</span>
              <button
                type="button"
                className="scheduler-step"
                onClick={() => stepInterval(-1)}
                disabled={repeat.interval <= 1}
                aria-label="Repeat less often"
              >
                <Minus size={13} />
              </button>
              <span className="scheduler-interval-value">
                <AnimatedNumber value={repeat.interval} />
              </span>
              <button
                type="button"
                className="scheduler-step"
                onClick={() => stepInterval(1)}
                disabled={repeat.interval >= 12}
                aria-label="Repeat more often"
              >
                <Plus size={13} />
              </button>
              <span className="scheduler-interval-copy">{intervalUnit}</span>
            </div>
            <AnimatePresence initial={false}>
              {repeat.frequency === "weekly" ? (
                <motion.div
                  key="weekly-days"
                  className="scheduler-weekly"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={springs.paper}
                >
                  <div className="scheduler-dow-row" role="group" aria-label="Repeat on days">
                    {DAYS.map((day) => {
                      const on = selectedDays.includes(day.value);

                      return (
                        <motion.button
                          key={day.value}
                          type="button"
                          className={`scheduler-dow${on ? " on" : ""}`}
                          aria-pressed={on}
                          aria-label={`Repeat on ${day.short}`}
                          onClick={() => toggleDay(day.value)}
                          whileTap={{ scale: 0.85 }}
                          animate={on ? { scale: [1, 1.18, 1] } : { scale: 1 }}
                          transition={springs.snappy}
                        >
                          {day.letter}
                        </motion.button>
                      );
                    })}
                  </div>
                  <div className="scheduler-quick-row">
                    {WEEKDAY_PRESETS.map((preset) => {
                      const on =
                        preset.days.length === selectedDays.length &&
                        preset.days.every((day) => selectedDays.includes(day));

                      return (
                        <motion.button
                          key={preset.label}
                          type="button"
                          className={`scheduler-quick-pick${on ? " on" : ""}`}
                          onClick={() => onChange({ ...repeat, daysOfWeek: preset.days })}
                          whileTap={{ scale: 0.92 }}
                        >
                          {preset.label}
                        </motion.button>
                      );
                    })}
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
            <div className="scheduler-repeat-summary" aria-live="polite">
              <Repeat2 size={13} />
              <AnimatePresence initial={false} mode="popLayout">
                <motion.span
                  key={captureRepeatSummary(repeat)}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={springs.snappy}
                >
                  {captureRepeatSummary(repeat)}
                </motion.span>
              </AnimatePresence>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}

/**
 * The quick-capture scheduling instrument row: three glass chips (date, time,
 * repeat) that ignite with a live label once armed and open a HUD tray with a
 * full picker. One tray is open at a time; picking a date or a preset time
 * closes it, part-by-part edits keep it open.
 */
export function CaptureScheduler({
  schedule,
  onChange,
}: {
  schedule: CaptureSchedule;
  onChange: (next: Partial<CaptureSchedule>) => void;
}) {
  const [openPanel, setOpenPanel] = useState<PanelKind | null>(null);

  function togglePanel(panel: PanelKind) {
    setOpenPanel((current) => (current === panel ? null : panel));
  }

  return (
    <div className="capture-scheduler">
      <div className="scheduler-chips">
        <SchedulerChip
          icon={<CalendarDays size={15} />}
          label={schedule.dueDate ? captureDateLabel(schedule.dueDate) : null}
          open={openPanel === "date"}
          ariaLabel={
            schedule.dueDate
              ? `Due date: ${captureDateLabel(schedule.dueDate)}`
              : "Set a due date"
          }
          onClick={() => togglePanel("date")}
        />
        <SchedulerChip
          icon={<Clock3 size={15} />}
          label={schedule.dueTime ? captureTimeLabel(schedule.dueTime) : null}
          open={openPanel === "time"}
          ariaLabel={
            schedule.dueTime
              ? `Due time: ${captureTimeLabel(schedule.dueTime)}`
              : "Set a due time"
          }
          onClick={() => togglePanel("time")}
        />
        <SchedulerChip
          icon={<Repeat2 size={15} />}
          label={schedule.repeat ? captureRepeatLabel(schedule.repeat) : null}
          open={openPanel === "repeat"}
          ariaLabel={
            schedule.repeat
              ? `Repeat: ${captureRepeatSummary(schedule.repeat)}`
              : "Set a repeat cadence"
          }
          onClick={() => togglePanel("repeat")}
        />
      </div>
      <AnimatePresence initial={false}>
        {openPanel ? (
          <motion.div
            key="tray"
            className="scheduler-tray"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={springs.drawer}
          >
            <AnimatePresence initial={false} mode="popLayout">
            <motion.div
              key={openPanel}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={springs.snappy}
            >
            {openPanel === "date" ? (
              <DatePanel
                value={schedule.dueDate}
                onPick={(date) => {
                  onChange({ dueDate: date });
                  setOpenPanel(null);
                }}
                onClear={() => onChange({ dueDate: "" })}
              />
            ) : openPanel === "time" ? (
              <TimePanel
                value={schedule.dueTime}
                onPick={(time, done) => {
                  onChange({ dueTime: time });
                  if (done) {
                    setOpenPanel(null);
                  }
                }}
                onClear={() => onChange({ dueTime: "" })}
              />
            ) : (
              <RepeatPanel
                repeat={schedule.repeat}
                dueDate={schedule.dueDate}
                onChange={(repeat) => onChange({ repeat })}
                onClear={() => onChange({ repeat: null })}
              />
            )}
            </motion.div>
            </AnimatePresence>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
