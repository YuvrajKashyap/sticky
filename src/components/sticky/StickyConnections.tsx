"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bird, Bot, CalendarSync, Check, Clock3, Copy, ExternalLink, KeyRound, RefreshCw, Send, Unplug, X } from "lucide-react";
import { useMemo, useState } from "react";
import { createStickyPlatformClient } from "@/lib/sticky/api-client";

type Credential = { id: string; name: string; provider: string; provider_user_id: string | null; token_prefix: string; last_used_at: string | null; revoked_at: string | null };
type McpConnection = { token: string; mcpUrl: string };
type Integration = { id: string; provider: string; provider_email: string | null; status: string };
type DailyAgendaSettings = {
  enabled: boolean;
  time: string;
  timezone: string;
  scheduleVersion: number;
  workflowRunId: string | null;
  lastSentOn: string | null;
  lastSentAt: string | null;
  nextRunDate: string;
  nextRunAt: string;
  pokeLinked: boolean;
  pokeDeliveryConfigured: boolean;
};

const AGENT_SCOPES = ["tasks:read", "tasks:write", "tasks:destructive", "calendar:read", "calendar:write", "calendar:destructive"];

function nextAgendaLabel(settings: DailyAgendaSettings | undefined) {
  if (!settings?.enabled) return "Off";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: settings.timezone,
    timeZoneName: "short",
  }).format(new Date(settings.nextRunAt));
}

export function StickyConnections({ open, onClose }: { open: boolean; onClose: () => void }) {
  const client = useMemo(() => createStickyPlatformClient(), []);
  const queryClient = useQueryClient();
  const [pokeConnection, setPokeConnection] = useState<McpConnection | null>(null);
  const [codexConnection, setCodexConnection] = useState<McpConnection | null>(null);
  const [littlebirdConnection, setLittlebirdConnection] = useState<McpConnection | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [googleSyncStep, setGoogleSyncStep] = useState<0 | 1 | 2>(0);
  const [dailyAgendaDraft, setDailyAgendaDraft] = useState<{ enabled: boolean; time: string; timezone: string } | null>(null);
  const timezoneOptions = useMemo(() => {
    const supported = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
    return [...new Set(["America/Chicago", Intl.DateTimeFormat().resolvedOptions().timeZone, ...supported].filter(Boolean))];
  }, []);

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
  const dailyAgenda = useQuery({
    queryKey: ["daily-agenda"],
    enabled: open && Boolean(client),
    queryFn: () => client!.request<DailyAgendaSettings>("/api/v1/daily-agenda"),
  });
  const dailyAgendaValues = dailyAgendaDraft ?? {
    enabled: dailyAgenda.data?.enabled ?? true,
    time: dailyAgenda.data?.time ?? "06:00",
    timezone: dailyAgenda.data?.timezone ?? "America/Chicago",
  };

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
  const createCodexCredential = useMutation({
    mutationFn: () => client!.request<{ token: string; mcpUrl: string }>("/api/v1/credentials", {
      method: "POST",
      body: JSON.stringify({ name: "Codex", provider: "codex", providerUserId: null, scopes: AGENT_SCOPES }),
    }),
    onSuccess: ({ token, mcpUrl }) => {
      setCodexConnection({ token, mcpUrl });
      setStatusMessage("Your private Codex connection is ready. Copy the key below, then return to Codex and say \"copied.\"");
      void queryClient.invalidateQueries({ queryKey: ["credentials"] });
    },
    onError: (error) => setStatusMessage(error.message),
  });
  const disconnectCodex = useMutation({
    mutationFn: (id: string) => client!.request(`/api/v1/credentials/${id}`, { method: "DELETE", body: "{}" }),
    onSuccess: () => {
      setCodexConnection(null);
      setStatusMessage("Codex disconnected from Sticky.");
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
  const saveDailyAgenda = useMutation({
    mutationFn: () => client!.request<DailyAgendaSettings>("/api/v1/daily-agenda", {
      method: "PUT",
      body: JSON.stringify(dailyAgendaValues),
    }),
    onSuccess: (settings) => {
      queryClient.setQueryData(["daily-agenda"], settings);
      setDailyAgendaDraft(null);
      setStatusMessage(settings.enabled
        ? `Daily agenda scheduled for ${settings.time} in ${settings.timezone}.`
        : "Daily agenda turned off.");
    },
    onError: (error) => setStatusMessage(error.message),
  });
  const testDailyAgenda = useMutation({
    mutationFn: async () =>
      client!.request<{ delivered?: boolean; channels?: { poke: boolean }; counts?: { dueTasks: number; dueSubtasks: number; upcomingItems: number; undatedTasks: number; undatedSubtasks: number } }>("/api/v1/daily-agenda/test", {
        method: "POST",
        body: "{}",
      }),
    onSuccess: (result) => {
      const due = (result.counts?.dueTasks ?? 0) + (result.counts?.dueSubtasks ?? 0);
      const active = (result.counts?.undatedTasks ?? 0) + (result.counts?.undatedSubtasks ?? 0);
      setStatusMessage(result.channels?.poke
        ? `Poke accepted the test agenda with ${due} due, ${result.counts?.upcomingItems ?? 0} upcoming, and ${active} active undated item${active === 1 ? "" : "s"}.`
        : "Poke did not accept the test agenda.");
    },
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
  const syncAllGoogle = useMutation({
    mutationFn: () => client!.request<{ importedLists: number; importedCalendars: number; automaticBackgroundSync: false }>("/api/v1/integrations/google/sync-all", {
      method: "POST",
      body: JSON.stringify({
        acknowledgedSeparationPreference: true,
        confirmedBulkCopy: true,
        confirmationPhrase: "SYNC GOOGLE INTO STICKY",
      }),
    }),
    onSuccess: ({ importedLists, importedCalendars }) => {
      setGoogleSyncStep(0);
      setStatusMessage(`Imported ${importedLists} Google list${importedLists === 1 ? "" : "s"} and ${importedCalendars} calendar${importedCalendars === 1 ? "" : "s"}. Automatic syncing remains off.`);
    },
    onError: (error) => setStatusMessage(error.message),
  });

  if (!open) return null;
  const pokeCredential = credentials.data?.credentials.find((item) => item.provider === "poke" && !item.revoked_at);
  const pokeConnected = Boolean(pokeCredential?.last_used_at);
  const codexCredential = credentials.data?.credentials.find((item) => item.provider === "codex" && !item.revoked_at);
  const codexConnected = Boolean(codexCredential?.last_used_at);
  const littlebirdCredential = credentials.data?.credentials.find((item) => item.provider === "littlebird" && !item.revoked_at);
  const littlebirdConnected = Boolean(littlebirdCredential?.last_used_at);
  const googleAccount = integrations.data?.integrations.find((item) => ["google_workspace", "google_tasks"].includes(item.provider) && item.status !== "revoked");
  const googleConfigured = Boolean(integrations.data?.capabilities.googleTasks && integrations.data?.capabilities.googleCalendar);
  const pokeConnectUrl = pokeConnection
    ? `https://poke.com/integrations/new?name=${encodeURIComponent("Sticky Focused Workspace")}&url=${encodeURIComponent(pokeConnection.mcpUrl)}&apiKey=${encodeURIComponent(pokeConnection.token)}`
    : null;
  const openPokeRefresh = () => {
    window.open("https://poke.com/integrations", "_blank", "noopener,noreferrer");
    setStatusMessage("Poke integrations opened. Choose Sticky Focused Workspace, then click Refresh Connection to resync its tools.");
  };

  return (
    <div className="dialog-backdrop connections-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="connections-panel" role="dialog" aria-modal="true" aria-label="Connections and notifications">
        <header className="connections-head">
          <div><span>Settings</span><h3>Connections</h3></div>
          <button type="button" className="icon-chip" onClick={onClose} aria-label="Close connections"><X size={18} /></button>
        </header>

        <div className="connection-row">
          <span className="connection-icon poke"><Send size={20} /></span>
          <div className="connection-copy"><strong>Poke</strong><small>{pokeConnected ? "Sticky focused tools connected · Google stays direct in Poke" : pokeCredential ? "Connection key created" : "Connect Sticky here and Google directly in Poke"}</small></div>
          {pokeCredential ? (
            <div className="connection-row-actions">
              <button type="button" className="connection-refresh-button" onClick={openPokeRefresh} aria-label="Refresh Poke connection in Poke">
                <RefreshCw size={15} />Refresh
              </button>
              <button type="button" className="connection-icon-button" onClick={() => disconnectPoke.mutate(pokeCredential.id)} aria-label="Disconnect Poke"><Unplug size={16} /></button>
            </div>
          ) : null}
        </div>
        {!pokeCredential ? <div className="connection-inline-form"><button type="button" className="connection-primary" disabled={createPokeCredential.isPending} onClick={() => createPokeCredential.mutate()}><KeyRound size={15} />{createPokeCredential.isPending ? "Creating..." : "Create private connection"}</button></div> : null}
        {pokeConnection ? (
          <div className="connection-setup">
            <p>Use this once to add Sticky Focused Workspace to Poke. Connect Google separately in Poke for normal Google work; this adds Sticky plus the confirmed bulk-transfer bridge. The key will not be shown again.</p>
            <div className="connection-token"><code>{pokeConnection.token}</code><button type="button" onClick={() => void navigator.clipboard.writeText(pokeConnection.token)} aria-label="Copy Poke connection key"><Copy size={15} /></button></div>
            <div className="connection-setup-actions">
              <button type="button" className="connection-secondary" onClick={() => void navigator.clipboard.writeText(pokeConnection.mcpUrl)}><Copy size={15} />Copy server URL</button>
              <button type="button" className="connection-primary" onClick={() => { if (pokeConnectUrl) window.open(pokeConnectUrl, "_blank", "noopener,noreferrer"); }}><ExternalLink size={15} />Connect in Poke</button>
            </div>
          </div>
        ) : null}

        <div className="connection-row">
          <span className="connection-icon codex"><Bot size={20} /></span>
          <div className="connection-copy">
            <strong>Codex</strong>
            <small>{codexConnected ? "Connected to separate Sticky and live Google tools" : codexCredential ? "Connection key created" : "Let Codex read and manage Sticky plus live Google"}</small>
          </div>
          {codexCredential ? <button type="button" className="connection-icon-button" onClick={() => disconnectCodex.mutate(codexCredential.id)} aria-label="Disconnect Codex"><Unplug size={16} /></button> : null}
        </div>
        {!codexCredential ? (
          <div className="connection-inline-form">
            <button type="button" className="connection-primary" disabled={createCodexCredential.isPending} onClick={() => createCodexCredential.mutate()}>
              <KeyRound size={15} />{createCodexCredential.isPending ? "Creating..." : "Create Codex connection"}
            </button>
          </div>
        ) : null}
        {codexConnection ? (
          <div className="connection-setup">
            <p>This key gives Codex separate Sticky and live Google tools without importing either system into the other. Copy it once, return to your Codex task, and say <strong>copied</strong>. Codex will finish the private setup on this computer; the key will not be shown again.</p>
            <div className="connection-token">
              <code>{codexConnection.token}</code>
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(codexConnection.token).then(
                  () => setStatusMessage("Codex key copied. Return to your Codex task and say \"copied.\""),
                  () => setStatusMessage("Sticky could not copy the key. Select it manually before leaving this screen."),
                )}
                aria-label="Copy Codex connection key"
              >
                <Copy size={15} />
              </button>
            </div>
            <div className="connection-setup-actions">
              <button type="button" className="connection-primary" onClick={() => void navigator.clipboard.writeText(codexConnection.token).then(
                () => setStatusMessage("Codex key copied. Return to your Codex task and say \"copied.\""),
                () => setStatusMessage("Sticky could not copy the key. Select it manually before leaving this screen."),
              )}><Copy size={15} />Copy key for Codex</button>
              <button type="button" className="connection-secondary" onClick={() => void navigator.clipboard.writeText(codexConnection.mcpUrl)}><Copy size={15} />Copy server URL</button>
            </div>
          </div>
        ) : null}

        <div className="connection-row daily-agenda-row">
          <span className="connection-icon agenda"><Clock3 size={20} /></span>
          <div className="connection-copy">
            <strong>Daily agenda</strong>
            <small>{dailyAgenda.isLoading ? "Loading schedule…" : nextAgendaLabel(dailyAgenda.data)}</small>
          </div>
          <label className="daily-agenda-toggle">
            <input
              type="checkbox"
              checked={dailyAgendaValues.enabled}
              onChange={(event) => setDailyAgendaDraft({ ...dailyAgendaValues, enabled: event.target.checked })}
              aria-label="Enable daily agenda"
            />
            <span>{dailyAgendaValues.enabled ? "On" : "Off"}</span>
          </label>
        </div>
        <div className="connection-setup daily-agenda-settings" aria-label="Daily agenda settings">
          <p>Sticky sends this agenda directly to your phone, then also hands it to Poke: everything due today, every active task and subtask without a due date, then the top three dated items strictly after today.</p>
          <div className="daily-agenda-fields">
            <label>
              <span>Send at</span>
              <input
                type="time"
                value={dailyAgendaValues.time}
                onChange={(event) => setDailyAgendaDraft({ ...dailyAgendaValues, time: event.target.value })}
                aria-label="Daily agenda time"
              />
            </label>
            <label>
              <span>Time zone</span>
              <select
                value={dailyAgendaValues.timezone}
                onChange={(event) => setDailyAgendaDraft({ ...dailyAgendaValues, timezone: event.target.value })}
                aria-label="Daily agenda timezone"
              >
                {timezoneOptions.map((timezone) => (
                  <option key={timezone} value={timezone}>
                    {timezone === "America/Chicago" ? "Central Time (America/Chicago)" : timezone}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="connection-setup-actions">
            <button
              type="button"
              className="connection-primary"
              disabled={!client || !dailyAgenda.data || saveDailyAgenda.isPending || !dailyAgendaValues.time || !dailyAgendaValues.timezone}
              onClick={() => saveDailyAgenda.mutate()}
            >
              <Clock3 size={15} />{saveDailyAgenda.isPending ? "Saving…" : "Save schedule"}
            </button>
            <button
              type="button"
              className="connection-secondary"
              disabled={!client || testDailyAgenda.isPending}
              onClick={() => testDailyAgenda.mutate()}
            >
              <Send size={15} />{testDailyAgenda.isPending ? "Sending…" : "Send test now"}
            </button>
          </div>
          {dailyAgenda.data && !dailyAgenda.data.pokeLinked ? (
            <p className="daily-agenda-warning"><AlertTriangle size={14} /> Connect Poke above so Sticky has an agent conversation where it can deliver this agenda.</p>
          ) : null}
          {dailyAgenda.data && !dailyAgenda.data.pokeDeliveryConfigured ? (
            <p className="daily-agenda-warning"><AlertTriangle size={14} /> Agent delivery needs a Poke Kitchen API key configured in Sticky.</p>
          ) : null}
          {dailyAgenda.error ? <p className="daily-agenda-warning"><AlertTriangle size={14} /> {dailyAgenda.error.message}</p> : null}
        </div>

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
          <div className="connection-copy"><strong>Google Workspace</strong><small>{googleAccount ? `${googleAccount.provider_email || "Connected"} · guarded transfers and custom agents · never auto-imported` : googleConfigured ? "Connect for guarded transfers and non-Poke agents" : "OAuth keys need to be added in Vercel"}</small></div>
          {googleAccount ? <button type="button" className="connection-icon-button" onClick={() => disconnectGoogle.mutate()} aria-label="Disconnect Google"><Unplug size={16} /></button> : null}
        </div>
        {!googleAccount ? <div className="connection-inline-form"><button type="button" className="connection-primary" disabled={!googleConfigured || connectGoogle.isPending} onClick={() => connectGoogle.mutate()}><ExternalLink size={15} />{connectGoogle.isPending ? "Opening…" : "Connect Google"}</button></div> : null}
        {googleAccount ? (
          <div className="connection-setup">
            {googleSyncStep === 0 ? (
              <>
                <p>Because you said you wanted Google and Sticky kept separate, this action is intentionally guarded. Nothing is copied unless you approve two more warnings.</p>
                <div className="connection-setup-actions">
                  <button type="button" className="connection-secondary" onClick={() => { setStatusMessage(null); setGoogleSyncStep(1); }}>
                    <CalendarSync size={15} />Sync all Google lists + calendars
                  </button>
                </div>
              </>
            ) : googleSyncStep === 1 ? (
              <div role="alert">
                <p><AlertTriangle size={15} aria-hidden="true" /> First confirmation: this will copy every current Google Task list and Google Calendar into Sticky and create integration links. Google will still remain a separate source.</p>
                <div className="connection-setup-actions">
                  <button type="button" className="connection-secondary" onClick={() => setGoogleSyncStep(0)}>Cancel</button>
                  <button type="button" className="connection-primary" onClick={() => setGoogleSyncStep(2)}>Yes, continue</button>
                </div>
              </div>
            ) : (
              <div role="alert">
                <p><AlertTriangle size={15} aria-hidden="true" /> Final confirmation: copy all Google lists and calendars into Sticky now? Automatic background mirroring will remain off.</p>
                <div className="connection-setup-actions">
                  <button type="button" className="connection-secondary" disabled={syncAllGoogle.isPending} onClick={() => setGoogleSyncStep(0)}>Cancel</button>
                  <button type="button" className="connection-primary" disabled={syncAllGoogle.isPending} onClick={() => syncAllGoogle.mutate()}>
                    {syncAllGoogle.isPending ? "Syncing…" : "Yes, sync all now"}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : null}

        {statusMessage ? <div className="connection-status" role="status"><Check size={15} /><span>{statusMessage}</span></div> : null}
      </section>
    </div>
  );
}
