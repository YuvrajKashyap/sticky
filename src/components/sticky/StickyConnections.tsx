"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, CalendarSync, Check, Copy, ExternalLink, KeyRound, RefreshCw, Send, Smartphone, Unplug, X } from "lucide-react";
import { useMemo, useState } from "react";
import { createStickyPlatformClient } from "@/lib/sticky/api-client";

type Credential = { id: string; name: string; provider: string; provider_user_id: string | null; token_prefix: string; last_used_at: string | null; revoked_at: string | null };
type PokeConnection = { token: string; mcpUrl: string };
type Integration = { id: string; provider: string; provider_email: string | null; status: string };
type GoogleTaskList = { id: string; title: string };
type GoogleCalendar = { id: string; name: string; timezone: string; primary: boolean; accessRole: string | null };

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(window.atob(base64), (character) => character.charCodeAt(0));
}

export function StickyConnections({ open, onClose }: { open: boolean; onClose: () => void }) {
  const client = useMemo(() => createStickyPlatformClient(), []);
  const queryClient = useQueryClient();
  const [pokeConnection, setPokeConnection] = useState<PokeConnection | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const credentials = useQuery({
    queryKey: ["credentials"],
    enabled: open && Boolean(client),
    queryFn: () => client!.request<{ credentials: Credential[] }>("/api/v1/credentials"),
  });
  const integrations = useQuery({
    queryKey: ["integrations"],
    enabled: open && Boolean(client),
    queryFn: () => client!.request<{ integrations: Integration[]; capabilities: { googleTasks: boolean; googleCalendar: boolean } }>("/api/v1/integrations"),
  });

  const createPokeCredential = useMutation({
    mutationFn: () => client!.request<{ token: string; mcpUrl: string }>("/api/v1/credentials", {
      method: "POST",
      body: JSON.stringify({ name: "Poke", provider: "poke", providerUserId: null, scopes: ["tasks:read", "tasks:write", "tasks:destructive", "calendar:read", "calendar:write", "calendar:destructive"] }),
    }),
    onSuccess: ({ token, mcpUrl }) => {
      setPokeConnection({ token, mcpUrl });
      setStatusMessage("Your private Poke connection is ready.");
      void queryClient.invalidateQueries({ queryKey: ["credentials"] });
    },
    onError: (error) => setStatusMessage(error.message),
  });
  const disconnectPoke = useMutation({
    mutationFn: (id: string) => client!.request(`/api/v1/credentials/${id}`, { method: "DELETE", body: "{}" }),
    onSuccess: () => {
      setPokeConnection(null);
      setStatusMessage("Poke disconnected from Sticky.");
      void queryClient.invalidateQueries({ queryKey: ["credentials"] });
    },
    onError: (error) => setStatusMessage(error.message),
  });
  const enablePush = useMutation({
    mutationFn: async () => {
      if (!client || !("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("Push notifications are not available in this browser.");
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!publicKey) throw new Error("Sticky push keys are not configured yet.");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Notification permission was not granted.");
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      const json = subscription.toJSON();
      return client.request("/api/v1/push-subscriptions", {
        method: "POST",
        body: JSON.stringify({ endpoint: subscription.endpoint, keys: json.keys, deviceName: navigator.platform, userAgent: navigator.userAgent }),
      });
    },
    onSuccess: () => setStatusMessage("Notifications enabled on this device."),
    onError: (error) => setStatusMessage(error.message),
  });
  const connectGoogle = useMutation({
    mutationFn: () => client!.request<{ authorizationUrl: string }>("/api/v1/integrations/google/connect", { method: "POST", body: "{}" }),
    onSuccess: ({ authorizationUrl }) => window.location.assign(authorizationUrl),
    onError: (error) => setStatusMessage(error.message),
  });
  const syncGoogle = useMutation({
    mutationFn: async () => {
      if (!client) throw new Error("Sticky is not signed in.");
      const [taskLists, calendars] = await Promise.all([
        client.request<{ lists: GoogleTaskList[] }>("/api/v1/integrations/google/lists"),
        client.request<{ calendars: GoogleCalendar[] }>("/api/v1/integrations/google/calendars"),
      ]);
      await client.request("/api/v1/integrations/google/lists", {
        method: "POST",
        body: JSON.stringify({ externalListIds: taskLists.lists.map((list) => list.id) }),
      });
      await client.request("/api/v1/integrations/google/calendars", {
        method: "POST",
        body: JSON.stringify({ calendars: calendars.calendars.map((calendar) => ({
          externalCalendarId: calendar.id,
          name: calendar.name,
          syncDirection: calendar.accessRole === "reader" || calendar.accessRole === "freeBusyReader" ? "import_only" : "two_way",
          isDefaultTarget: calendar.primary,
        })) }),
      });
      return client.request<{ syncedLists: number; syncedCalendars: number }>("/api/v1/integrations/google/sync", { method: "POST", body: "{}" });
    },
    onSuccess: (result) => setStatusMessage(`Google is synced: ${result.syncedLists} task lists and ${result.syncedCalendars} calendars.`),
    onError: (error) => setStatusMessage(error.message),
  });
  const disconnectGoogle = useMutation({
    mutationFn: () => client!.request("/api/v1/integrations/google", { method: "DELETE", body: "{}" }),
    onSuccess: () => {
      setStatusMessage("Google disconnected. Your Sticky data was preserved.");
      void queryClient.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (error) => setStatusMessage(error.message),
  });

  if (!open) return null;
  const pokeCredential = credentials.data?.credentials.find((item) => item.provider === "poke" && !item.revoked_at);
  const pokeConnected = Boolean(pokeCredential?.last_used_at);
  const googleAccount = integrations.data?.integrations.find((item) => ["google_workspace", "google_tasks"].includes(item.provider) && item.status !== "revoked");
  const googleConfigured = Boolean(integrations.data?.capabilities.googleTasks && integrations.data?.capabilities.googleCalendar);
  const pokeConnectUrl = pokeConnection
    ? `https://poke.com/integrations/new?name=Sticky&url=${encodeURIComponent(pokeConnection.mcpUrl)}&apiKey=${encodeURIComponent(pokeConnection.token)}`
    : null;

  return (
    <div className="dialog-backdrop connections-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="connections-panel" role="dialog" aria-modal="true" aria-label="Connections and notifications">
        <header className="connections-head">
          <div><span>Settings</span><h3>Connections</h3></div>
          <button type="button" className="icon-chip" onClick={onClose} aria-label="Close connections"><X size={18} /></button>
        </header>

        <div className="connection-row">
          <span className="connection-icon poke"><Send size={20} /></span>
          <div className="connection-copy"><strong>Poke</strong><small>{pokeConnected ? "Connected and ready" : pokeCredential ? "Connection key created" : "Add and manage tasks by message"}</small></div>
          {pokeCredential ? <button type="button" className="connection-icon-button" onClick={() => disconnectPoke.mutate(pokeCredential.id)} aria-label="Disconnect Poke"><Unplug size={16} /></button> : null}
        </div>
        {!pokeCredential ? <div className="connection-inline-form"><button type="button" className="connection-primary" disabled={createPokeCredential.isPending} onClick={() => createPokeCredential.mutate()}><KeyRound size={15} />{createPokeCredential.isPending ? "Creating..." : "Create private connection"}</button></div> : null}
        {pokeConnection ? (
          <div className="connection-setup">
            <p>Use this once to add Sticky to Poke. The key will not be shown again.</p>
            <div className="connection-token"><code>{pokeConnection.token}</code><button type="button" onClick={() => void navigator.clipboard.writeText(pokeConnection.token)} aria-label="Copy Poke connection key"><Copy size={15} /></button></div>
            <div className="connection-setup-actions">
              <button type="button" className="connection-secondary" onClick={() => void navigator.clipboard.writeText(pokeConnection.mcpUrl)}><Copy size={15} />Copy server URL</button>
              <button type="button" className="connection-primary" onClick={() => { if (pokeConnectUrl) window.open(pokeConnectUrl, "_blank", "noopener,noreferrer"); }}><ExternalLink size={15} />Connect in Poke</button>
            </div>
          </div>
        ) : null}

        <div className="connection-row">
          <span className="connection-icon push"><CalendarSync size={20} /></span>
          <div className="connection-copy"><strong>Google Workspace</strong><small>{googleAccount ? `${googleAccount.provider_email || "Connected"} · Tasks + Calendar` : googleConfigured ? "Mirror Google Tasks and Calendar" : "OAuth keys need to be added in Vercel"}</small></div>
          {googleAccount ? <button type="button" className="connection-icon-button" onClick={() => disconnectGoogle.mutate()} aria-label="Disconnect Google"><Unplug size={16} /></button> : null}
        </div>
        <div className="connection-inline-form">
          {googleAccount ? <button type="button" className="connection-primary" disabled={syncGoogle.isPending} onClick={() => syncGoogle.mutate()}><RefreshCw size={15} />{syncGoogle.isPending ? "Syncing…" : "Sync all Google lists + calendars"}</button> : <button type="button" className="connection-primary" disabled={!googleConfigured || connectGoogle.isPending} onClick={() => connectGoogle.mutate()}><ExternalLink size={15} />{connectGoogle.isPending ? "Opening…" : "Connect Google"}</button>}
        </div>

        <div className="connection-row">
          <span className="connection-icon push"><Smartphone size={20} /></span>
          <div className="connection-copy"><strong>Web notifications</strong><small>{typeof Notification !== "undefined" && Notification.permission === "granted" ? "Enabled" : "This device"}</small></div>
          <button type="button" className="connection-primary" onClick={() => enablePush.mutate()}><BellRing size={15} />Enable</button>
        </div>

        {statusMessage ? <div className="connection-status" role="status"><Check size={15} /><span>{statusMessage}</span></div> : null}
      </section>
    </div>
  );
}
