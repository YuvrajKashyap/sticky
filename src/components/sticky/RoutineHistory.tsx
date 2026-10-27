"use client";

import { useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { History, X } from "lucide-react";
import { occurrenceStatus, routineStatistics } from "@sticky/domain";
import { createStickyPlatformClient } from "@/lib/sticky/api-client";
import { localDateKey } from "@/lib/sticky/recurrence";
import type { StickyTask, StickyWorkspaceData } from "@/types/sticky";
import styles from "./RoutineHistory.module.css";

type Routine = { id: string; template: { title: string }; tracking_since: string; retired: boolean };
type HistoryData = { tasks: StickyTask[]; statistics: ReturnType<typeof routineStatistics> };

export function RoutineHistory({ workspace, demo, onChange }: {
  workspace: StickyWorkspaceData; demo: boolean; onChange: (task?: StickyTask) => void;
}) {
  const client = useMemo(() => demo ? null : createStickyPlatformClient(), [demo]);
  const titleId = useId();
  const queryClient = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("");
  const [through, setThrough] = useState(localDateKey);
  const [from, setFrom] = useState(() => { const day = new Date(); day.setDate(day.getDate() - 29); return localDateKey(day); });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const routines = useQuery({
    queryKey: ["routine-history-list", demo], enabled: open,
    queryFn: async () => demo ? { routines: workspace.recurrenceRules.map(rule => ({ id: rule.id, template: { title: workspace.tasks.find(task => task.id === rule.taskId)?.title ?? "Routine" }, tracking_since: localDateKey(), retired: false })) }
      : client!.request<{ routines: Routine[] }>("/api/v1/routines"),
  });
  const routineId = selected || routines.data?.routines[0]?.id || "";
  const routine = routines.data?.routines.find(item => item.id === routineId);
  const history = useQuery({
    queryKey: ["routine-history", routineId, from, through, demo], enabled: open && Boolean(routineId) && from <= through,
    queryFn: async (): Promise<HistoryData> => {
      if (!demo) return client!.request(`/api/v1/routines/${routineId}/history?from=${from}&through=${through}`);
      const rule = workspace.recurrenceRules.find(item => item.id === routineId);
      const tasks = workspace.tasks.filter(task => task.routineId === routineId || task.id === rule?.taskId).map(task => ({ ...task, routineId, scheduledDate: task.scheduledDate ?? task.dueDate }));
      return { tasks: tasks.filter(task => task.scheduledDate && task.scheduledDate >= from && task.scheduledDate <= through), statistics: routineStatistics(tasks, from, through) };
    },
  });
  async function correct(task: StickyTask, status: "completed" | "not_completed" | "skipped") {
    setBusy(true); setError("");
    try {
      if (demo) {
        onChange({ ...task, occurrenceStatus: status === "not_completed" ? occurrenceStatus({ ...task, isCompleted: false, occurrenceStatus: "pending" }) : status, isCompleted: status === "completed", completedAt: status === "completed" ? new Date().toISOString() : null });
      } else {
        await client!.request(`/api/v1/occurrences/${task.id}/status`, { method: "POST", body: JSON.stringify({ scheduledDate: task.scheduledDate, status, version: task.version }) });
        onChange();
      }
      await history.refetch();
      await queryClient.invalidateQueries({ queryKey: ["sticky-calendar-routines"] });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not update occurrence."); }
    finally { setBusy(false); }
  }
  const stats = history.data?.statistics;
  return <>
    <button type="button" className={styles.trigger} aria-label="Routine history" title="Routine history" onClick={() => setOpen(true)}><History size={18} /></button>
    {open && createPortal(<dialog ref={node => { dialog.current = node; if (node && !node.open) node.showModal(); }} className={styles.dialog} aria-labelledby={titleId} onClose={() => setOpen(false)}>
      <header className={styles.header}><h2 id={titleId}>Routine history</h2><button type="button" aria-label="Close routine history" onClick={() => dialog.current?.close()}><X size={20} /></button></header>
      <p>“Not completed” means not checked off in Sticky. It doesn’t mean the activity never happened.</p>
      {routines.isPending ? <p role="status">Loading routines…</p> : null}
      {routines.error ? <p role="alert">Could not load routines. <button onClick={() => void routines.refetch()}>Retry</button></p> : null}
      {routines.data?.routines.length === 0 ? <p>No routines yet.</p> : null}
      {routine ? <>
        <label>Routine<select value={routineId} onChange={event => setSelected(event.target.value)}>{routines.data?.routines.map(item => <option key={item.id} value={item.id}>{item.template.title}{item.retired ? " (repeat stopped)" : ""}</option>)}</select></label>
        <div className={styles.range}><label>From<input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label><label>Through<input type="date" value={through} onChange={event => setThrough(event.target.value)} /></label></div>
        <p>Reliable tracking began {routine.tracking_since}. Earlier unlinked dates are unknown; existing completions remain in their completed lists.</p>
        {from > through ? <p role="alert">Choose an end date on or after the start date.</p> : null}
        {stats ? <div className={styles.summary}><strong>{stats.completed} completed · {stats.rate === null ? "No rate yet" : `${stats.rate}% completion`}</strong><span>{stats.notCompleted} not completed · {stats.skipped} skipped · {stats.unknown} unknown · {stats.pending} pending</span><small>Rate = completed ÷ (completed + not completed). Skipped, unknown, pending and unscheduled dates are excluded.</small></div> : null}
        {history.isPending ? <p role="status">Loading occurrences…</p> : null}
        {history.error ? <p role="alert">Could not load history. <button onClick={() => void history.refetch()}>Retry</button></p> : null}
        {error ? <p role="alert">{error}</p> : null}
        <ul className={styles.rows}>{history.data?.tasks.map(task => <li key={task.id}>
          <div><strong>{task.scheduledDate}</strong><span>{occurrenceStatus(task).replaceAll("_", " ")}</span>{task.completedAt ? <small>Checked off {new Date(task.completedAt).toLocaleString()}</small> : null}</div>
          <label>Status<select aria-label={`Status for ${task.scheduledDate}`} disabled={busy} value={task.isCompleted ? "completed" : task.occurrenceStatus === "skipped" ? "skipped" : "not_completed"} onChange={event => void correct(task, event.target.value as "completed" | "not_completed" | "skipped")}>
            <option value="not_completed">Unchecked</option><option value="completed">Completed</option><option value="skipped">Skipped</option>
          </select></label>
        </li>)}</ul>
        {history.data?.tasks.length === 0 ? <p>No recorded occurrences in this period. Missing dates are not counted as misses.</p> : null}
      </> : null}
    </dialog>, document.body)}
  </>;
}
