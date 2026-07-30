"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { BellRing, Bot, CalendarDays, Clock3, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { createStickyPlatformClient } from "@/lib/sticky/api-client";
import type { StickyTask } from "@/types/sticky";
import {
  DatePanel,
  SchedulerChip,
  TimePanel,
  captureDateLabel,
  captureTimeLabel,
} from "./CaptureScheduler";
import { springs } from "./motion";

type Reminder = {
  id: string;
  remindAt: string;
  channels: ["poke"];
  isDefault: boolean;
  status: string;
  version: number;
};

export function TaskReminderControl({ task }: { task: StickyTask }) {
  const client = useMemo(() => createStickyPlatformClient(), []);
  const queryClient = useQueryClient();
  const [customDate, setCustomDate] = useState("");
  const [customTime, setCustomTime] = useState("");
  const [openPanel, setOpenPanel] = useState<"date" | "time" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const reminders = useQuery({
    queryKey: ["reminders", task.id],
    enabled: Boolean(client),
    queryFn: () => client!.request<{ reminders: Reminder[] }>(`/api/v1/reminders?taskId=${task.id}`),
  });
  const createReminder = useMutation({
    mutationFn: (body: object) => client!.request(`/api/v1/tasks/${task.id}/reminders`, {
      method: "POST",
      body: JSON.stringify({ ...body, channels: ["poke"] }),
    }),
    onSuccess: () => {
      setMessage("Reminder scheduled.");
      setCustomDate("");
      setCustomTime("");
      setOpenPanel(null);
      void queryClient.invalidateQueries({ queryKey: ["reminders", task.id] });
    },
    onError: (error) => setMessage(error.message),
  });
  const deleteReminder = useMutation({
    mutationFn: (reminderId: string) =>
      client!.request(`/api/v1/reminders/${reminderId}`, {
        method: "DELETE",
        body: "{}",
      }),
    onSuccess: () => {
      setMessage("Reminder deleted.");
      void queryClient.invalidateQueries({ queryKey: ["reminders", task.id] });
    },
    onError: (error) => setMessage(error.message),
  });
  const canUseRelative = Boolean(task.dueDate && task.dueTime);
  const customReady = Boolean(customDate && customTime);
  const activeReminders = reminders.data?.reminders.filter((reminder) => reminder.status === "scheduled") ?? [];

  function addCustomReminder() {
    if (!customReady) {
      return;
    }
    createReminder.mutate({ kind: "absolute", remindAt: new Date(`${customDate}T${customTime}`).toISOString() });
  }

  return (
    <section className="reminder-card" aria-label="Task reminders">
      <div className="mini-section-title"><BellRing size={16} />Agent reminder{activeReminders.length ? <strong>{activeReminders.length}</strong> : null}</div>
      <p className="helper-copy">
        <Bot size={14} /> Timed tasks automatically message you through Poke 10 minutes before they are due. End-of-day tasks are excluded. Choosing another time replaces that default.
      </p>
      <div className="reminder-presets">
        {[{ label: "10 min", minutes: 10 }, { label: "1 hour", minutes: 60 }, { label: "1 day", minutes: 1440 }].map((preset) => <button key={preset.minutes} type="button" disabled={!canUseRelative} onClick={() => createReminder.mutate({ kind: "relative", relativeMinutes: preset.minutes })}>{preset.label}</button>)}
      </div>
      <div className="reminder-scheduler capture-scheduler">
        <div className="scheduler-chips">
          <SchedulerChip
            icon={<CalendarDays size={15} />}
            label={customDate ? captureDateLabel(customDate) : null}
            open={openPanel === "date"}
            ariaLabel={customDate ? `Reminder date: ${captureDateLabel(customDate)}` : "Pick a reminder date"}
            onClick={() => setOpenPanel((current) => (current === "date" ? null : "date"))}
          />
          <SchedulerChip
            icon={<Clock3 size={15} />}
            label={customTime ? captureTimeLabel(customTime) : null}
            open={openPanel === "time"}
            ariaLabel={customTime ? `Reminder time: ${captureTimeLabel(customTime)}` : "Pick a reminder time"}
            onClick={() => setOpenPanel((current) => (current === "time" ? null : "time"))}
          />
          <button type="button" className="reminder-add" disabled={!customReady} onClick={addCustomReminder}>Add</button>
        </div>
        <AnimatePresence initial={false}>
          {openPanel ? (
            <motion.div key="tray" className="scheduler-tray" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={springs.drawer}>
              <AnimatePresence initial={false} mode="popLayout">
                <motion.div key={openPanel} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={springs.snappy}>
                  {openPanel === "date" ? (
                    <DatePanel value={customDate} onPick={(date) => { setCustomDate(date); setOpenPanel("time"); }} onClear={() => setCustomDate("")} />
                  ) : (
                    <TimePanel value={customTime} onPick={(time, done) => { setCustomTime(time); if (done) { setOpenPanel(null); } }} onClear={() => setCustomTime("")} />
                  )}
                </motion.div>
              </AnimatePresence>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
      {!canUseRelative ? <p className="helper-copy">Add a due time to use reminder presets.</p> : null}
      {activeReminders.map((reminder) => {
        const reminderTime = new Intl.DateTimeFormat(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(reminder.remindAt));

        return (
          <div className="scheduled-reminder" key={reminder.id}>
            <span>{reminderTime}</span>
            <div className="scheduled-reminder-actions">
              <small>{reminder.isDefault ? "Automatic · Poke" : "Custom · Poke"}</small>
              {!reminder.isDefault ? (
                <button
                  type="button"
                  onClick={() => deleteReminder.mutate(reminder.id)}
                  disabled={deleteReminder.isPending && deleteReminder.variables === reminder.id}
                  aria-label={`Delete reminder scheduled for ${reminderTime}`}
                >
                  <Trash2 size={14} />
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
      {message ? <p className="reminder-message" role="status">{message}</p> : null}
    </section>
  );
}
