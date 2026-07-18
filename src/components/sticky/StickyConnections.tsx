"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Bird, CalendarSync, Check, Copy, ExternalLink, KeyRound, Send, Smartphone, Unplug, X } from "lucide-react";
import { useMemo, useState } from "react";
import { createStickyPlatformClient } from "@/lib/sticky/api-client";

type Credential = { id: string; name: string; provider: string; provider_user_id: string | null; token_prefix: string; last_used_at: string | null; revoked_at: string | null };
type McpConnection = { token: string; mcpUrl: string };
type Integration = { id: string; provider: string; provider_email: string | null; status: string };

const AGENT_SCOPES = ["tasks:read", "tasks:write", "tasks:destructive", "calendar:read", "calendar:write", "calendar:destructive"];

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(window.atob(base64), (character) => character.charCodeAt(0));
}

export function StickyConnections({ open, onClose }: { open: boolean; onClose: () => void }) {
  const client = useMemo(() => createStickyPlatformClient(), []);
  const queryClient = useQueryClient();
  const [pokeConnection, setPokeConnection] = useState<McpConnection | null>(null);
  const [littlebirdConnection, setLittlebirdConnection] = useState<McpConnection | null>(null);
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
      body: JSON.stringify({ name: "Poke", provider: "poke", providerUserId: null, scopes: AGENT_SCOPES }),
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
  const createLittlebirdCredential = useMutation({
    mutationFn: () => client!.request<{ token: string; mcpUrl: string }>("/api/v1/credentials", {
      method: "POST",
      body: JSON.stringify({ name: "Littlebird", provider: "littlebird", providerUserId: null, scopes: AGENT_SCOPES }),
    }),
    onSuccess: ({ token, mcpUrl }) => {
      setLittlebirdConnection({ token, mcpUrl });
      setStatusMessage("Your private Littlebird connection is ready.");
      void queryClient.invalidateQueries({ queryKey: ["credentials"] });
    },
    onError: (error) => setStatusMessage(error.message),
  });
  const disconnectLittlebird = useMutation({
    mutationFn: (id: string) => client!.request(`/api/v1/credentials/${id}`, { method: "DELETE", body: "{}" }),
    onSuccess: () => {
      setLittlebirdConnection(null);
      setStatusMessage("Littlebird disconnected from Sticky.");
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
  const disconnectGoogle = useMutation({
    mutationFn: () => client!.request("/api/v1/integrations/google", { method: "DELETE", body: "{}" }),
    onSuccess: () => {
      setStatusMessage("Google disconnected. Sticky remained unchanged.");
      void queryClient.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (error) => setStatusMessage(error.message),
  });

  if (!open) return null;
  const pokeCredential = credentials.data?.credentials.find((item) => item.provider === "poke" && !item.revoked_at);
  const pokeConnected = Boolean(pokeCredential?.last_used_at);
  const littlebirdCredential = credentials.data?.credentials.find((item) => item.provider === "littlebird" && !item.revoked_at);
  const littlebirdConnected = Boolean(littlebirdCredential?.last_used_at);
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
          <div className="connection-copy"><strong>Poke</strong><small>{pokeConnected ? "Connected to separate Sticky and Google tools" : pokeCredential ? "Connection key created" : "Use Sticky and Google independently by message"}</small></div>
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
          <span className="connection-icon push"><Bird size={20} /></span>
          <div className="connection-copy"><strong>Littlebird</strong><small>{littlebirdConnected ? "Connected to separate Sticky and Google tools" : littlebirdCredential ? "Connection key created" : "Give your memory assistant separate access to both"}</small></div>
          {littlebirdCredential ? <button type="button" className="connection-icon-button" onClick={() => disconnectLittlebird.mutate(littlebirdCredential.id)} aria-label="Disconnect Littlebird"><Unplug size={16} /></button> : null}
        </div>
        {!littlebirdCredential ? <div className="connection-inline-form"><button type="button" className="connection-primary" disabled={createLittlebirdCredential.isPending} onClick={() => createLittlebirdCredential.mutate()}><KeyRound size={15} />{createLittlebirdCredential.isPending ? "Creating..." : "Create Littlebird connection"}</button></div> : null}
        {littlebirdConnection ? (
          <div className="connection-setup">
            <p>In Littlebird, open Settings → Integrations → Add custom MCP server. Use this URL and bearer token once; the token will not be shown again.</p>
            <div className="connection-token"><code>{littlebirdConnection.token}</code><button type="button" onClick={() => void navigator.clipboard.writeText(littlebirdConnection.token)} aria-label="Copy Littlebird connection key"><Copy size={15} /></button></div>
            <div className="connection-setup-actions">
              <button type="button" className="connection-secondary" onClick={() => void navigator.clipboard.writeText(littlebirdConnection.mcpUrl)}><Copy size={15} />Copy server URL</button>
              <button type="button" className="connection-primary" onClick={() => void navigator.clipboard.writeText(`Name: Sticky\nServer URL: ${littlebirdConnection.mcpUrl}\nAuthorization: Bearer ${littlebirdConnection.token}`)}><Copy size={15} />Copy complete setup</button>
              <button type="button" className="connection-secondary" onClick={() => window.open("https://littlebird.ai/all-integrations", "_blank", "noopener,noreferrer")}><ExternalLink size={15} />Littlebird integrations</button>
            </div>
          </div>
        ) : null}

        <div className="connection-row">
          <span className="connection-icon push"><CalendarSync size={20} /></span>
          <div className="connection-copy"><strong>Google Workspace</strong><small>{googleAccount ? `${googleAccount.provider_email || "Connected"} · live assistant access · never imported` : googleConfigured ? "Connect as a separate Tasks and Calendar source" : "OAuth keys need to be added in Vercel"}</small></div>
          {googleAccount ? <button type="button" className="connection-icon-button" onClick={() => disconnectGoogle.mutate()} aria-label="Disconnect Google"><Unplug size={16} /></button> : null}
        </div>
        {!googleAccount ? <div className="connection-inline-form"><button type="button" className="connection-primary" disabled={!googleConfigured || connectGoogle.isPending} onClick={() => connectGoogle.mutate()}><ExternalLink size={15} />{connectGoogle.isPending ? "Opening…" : "Connect Google"}</button></div> : null}

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
