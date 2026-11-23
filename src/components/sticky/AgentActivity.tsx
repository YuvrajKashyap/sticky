"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { StickyPlatformClient } from "@/lib/sticky/api-client";

type Connection = { id: string; name: string; revoked_at: string | null };
type Activity = { id: string; at: string; action: string; credentialId: string | null; subject: string | null };
type Props = { client: StickyPlatformClient | null; credentials: Connection[] };

function ActivityList({ client, credentials }: Props) {
  const [filter, setFilter] = useState("");
  const activity = useQuery({
    queryKey: ["agent-activity", filter],
    enabled: Boolean(client),
    gcTime: 0,
    retry: false,
    queryFn: ({ signal }) => client!.request<{ events: Activity[] }>(
      "/api/v1/agent-activity" + (filter ? "?credential=" + encodeURIComponent(filter) : ""), { signal }),
  });
  function label(connection: Connection) {
    const duplicate = credentials.some(other => other.id !== connection.id && other.name === connection.name);
    return connection.name + (duplicate ? " · " + connection.id.slice(0, 8) : "") + (connection.revoked_at ? " (disconnected)" : "");
  }
  const events = activity.data?.events ?? [];
  return <div className="agent-activity-body">
    <label>Connection
      <select value={filter} onChange={e => setFilter(e.target.value)}>
        <option value="">All connections</option>
        {credentials.map(c => <option key={c.id} value={c.id}>{label(c)}</option>)}
      </select>
    </label>
    {!client ? <p>Sign in to see activity.</p> : activity.isError ?
      <p role="alert">Activity could not be loaded. <button className="connection-secondary" onClick={() => void activity.refetch()}>Retry</button></p> :
      activity.isPending ? <p role="status">Loading activity…</p> : !events.length ? <p>No recorded changes for this selection.</p> :
      <><p>Latest {events.length === 1 ? "change" : events.length + " changes"}</p>
        <ol>{events.map(event => {
          const connection = credentials.find(c => c.id === event.credentialId);
          const actor = connection ? label(connection) : event.credentialId ? "Connection " + event.credentialId.slice(0, 8) : "Unknown connection";
          const action = event.action.replace(/[._]/g, " ");
          return <li key={event.id}><div><strong>{actor}</strong>
            <time dateTime={event.at}>{new Date(event.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</time>
          </div><span>{action.charAt(0).toUpperCase() + action.slice(1)}{event.subject && <> · {event.subject}</>}</span></li>;
        })}</ol></>}
  </div>;
}

export function AgentActivity(props: Props) {
  const [open, setOpen] = useState(false);
  return <details className="agent-activity" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Agent activity</summary>
    {open && <ActivityList {...props} />}
  </details>;
}
