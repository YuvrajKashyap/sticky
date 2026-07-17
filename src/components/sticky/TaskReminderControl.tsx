"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Clock3, Send, Smartphone } from "lucide-react";
import { useMemo, useState } from "react";
import { createStickyPlatformClient } from "@/lib/sticky/api-client";
import type { StickyTask } from "@/types/sticky";

type Reminder = { id: string; remindAt: string; channels: Array<"push" | "poke">; status: string; version: number };

export function TaskReminderControl({ task }: { task: StickyTask }) {
  const client = useMemo(() => createStickyPlatformClient(), []);
  const queryClient = useQueryClient();
  const [customAt, setCustomAt] = useState("");
  const [channels, setChannels] = useState<Array<"push" | "poke">>(["push"]);
  const [message, setMessage] = useState<string | null>(null);
  const reminders = useQuery({
    queryKey: ["reminders", task.id],
    enabled: Boolean(client),
    queryFn: () => client!.request<{ reminders: Reminder[] }>(`/api/v1/reminders?taskId=${task.id}`),
  });
  const createReminder = useMutation({
    mutationFn: (body: object) => client!.request(`/api/v1/tasks/${task.id}/reminders`, { method: "POST", body: JSON.stringify({ ...body, channels }) }),
    onSuccess: () => { setMessage("Reminder scheduled."); setCustomAt(""); void queryClient.invalidateQueries({ queryKey: ["reminders", task.id] }); },
    onError: (error) => setMessage(error.message),
  });
  const canUseRelative = Boolean(task.dueDate && task.dueTime);

  function toggleChannel(channel: "push" | "poke") {
    setChannels((current) => current.includes(channel) ? (current.length === 1 ? current : current.filter((item) => item !== channel)) : [...current, channel]);
  }

  return (
    <section className="reminder-card" aria-label="Task reminders">
      <div className="mini-section-title"><BellRing size={16} />Reminder{reminders.data?.reminders.length ? <strong>{reminders.data.reminders.length}</strong> : null}</div>
      <div className="reminder-channel-picker" aria-label="Reminder channels">
        <button type="button" className={channels.includes("push") ? "active" : ""} aria-pressed={channels.includes("push")} onClick={() => toggleChannel("push")}><Smartphone size={14} />Push</button>
        <button type="button" className={channels.includes("poke") ? "active" : ""} aria-pressed={channels.includes("poke")} onClick={() => toggleChannel("poke")}><Send size={14} />Poke</button>
      </div>
      <div className="reminder-presets">
        {[{ label: "10 min", minutes: 10 }, { label: "1 hour", minutes: 60 }, { label: "1 day", minutes: 1440 }].map((preset) => <button key={preset.minutes} type="button" disabled={!canUseRelative} onClick={() => createReminder.mutate({ kind: "relative", relativeMinutes: preset.minutes })}>{preset.label}</button>)}
      </div>
      <div className="reminder-custom"><Clock3 size={15} /><input type="datetime-local" value={customAt} onChange={(event) => setCustomAt(event.target.value)} aria-label="Custom reminder time" /><button type="button" disabled={!customAt} onClick={() => createReminder.mutate({ kind: "absolute", remindAt: new Date(customAt).toISOString() })}>Add</button></div>
      {!canUseRelative ? <p className="helper-copy">Add a due time to use reminder presets.</p> : null}
      {reminders.data?.reminders.map((reminder) => <div className="scheduled-reminder" key={reminder.id}><span>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(reminder.remindAt))}</span><small>{reminder.channels.join(" + ")}</small></div>)}
      {message ? <p className="reminder-message" role="status">{message}</p> : null}
    </section>
  );
}
