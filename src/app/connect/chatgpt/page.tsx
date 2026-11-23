"use client";

import { Bot, CalendarDays, Check, Clock3, KeyRound, ListChecks, LoaderCircle, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { GateField } from "@/components/auth/GateField";
import { createStickyPlatformClient } from "@/lib/sticky/api-client";

const labels: Record<string, string> = {
  "tasks:read": "Read your lists, tasks, subtasks, deadlines, and recurring tasks",
  "tasks:write": "Create, edit, organize, complete, and reschedule tasks and lists",
  "tasks:destructive": "Delete tasks, subtasks, and lists when you instruct it",
  "calendar:read": "Read your Sticky calendars, events, and recurring events",
  "calendar:write": "Create and update Sticky calendars, events, and time blocks",
  "calendar:destructive": "Delete Sticky events when you instruct it",
};

const SCOPE_GROUPS = [
  { key: "tasks", title: "Tasks", icon: ListChecks },
  { key: "calendar", title: "Calendar", icon: CalendarDays },
] as const;
const LEVEL_LABELS: Record<string, string> = { read: "Read", write: "Write", destructive: "Delete" };

export default function ConnectChatGPT() {
  const [clientName, setClientName] = useState("MCP client");
  const [scopes, setScopes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [signInUrl, setSignInUrl] = useState("/auth/google");
  useEffect(() => {
    let cancelled = false;
    const client = createStickyPlatformClient();
    const query = new URLSearchParams(window.location.search);
    const authError = query.get("auth_error");
    query.delete("auth_error");
    const checkSession = async () => {
      try {
        if (!client) throw new Error("Sticky sign-in is unavailable in this environment.");
        const { data, error } = await client.auth.getSession();
        if (error) throw error;
        if (!cancelled) {
          setSignedIn(Boolean(data.session));
          if (authError) setError(authError);
          setSignInUrl(`/auth/google?${new URLSearchParams({ next: `/connect/chatgpt?${query}` })}`);
        }
      } catch {
        if (!cancelled) setError("Could not check your Sticky session. Reload this page to try again.");
      } finally { if (!cancelled) setCheckingSession(false); }
    };
    void checkSession();
    window.addEventListener("focus", checkSession);
    void fetch(`/api/oauth/request?${query}`, { cache: "no-store" }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error("Invalid, unapproved, or expired connection request. Start again from your MCP client.");
      if (!cancelled) { setScopes(body.data.scopes); setClientName(body.data.client); }
    }).catch(reason => { if (!cancelled) setError(reason.message); });
    const subscription = client?.auth.onAuthStateChange((_event, session) => setSignedIn(Boolean(session)));
    return () => { cancelled = true; window.removeEventListener("focus", checkSession); subscription?.data.subscription.unsubscribe(); };
  }, []);

  async function respond(approve: boolean) {
    setBusy(true); setError(null);
    try {
      const client = createStickyPlatformClient();
      if (!client) throw new Error("Sticky sign-in is unavailable.");
      const query = new URLSearchParams(window.location.search);
      query.delete("auth_error");
      const result = await client.request<{ redirect: string }>("/api/oauth/consent", {
        method: "POST", body: JSON.stringify({ query: query.toString(), approve }),
      });
      // The server validates this exact external OAuth callback before returning it.
      window.location.assign(result.redirect);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Connection failed. Try again."); setBusy(false); }
  }
  const groups = SCOPE_GROUPS.map((group) => ({
    ...group,
    items: (scopes ?? []).filter((scope) => scope.startsWith(`${group.key}:`)),
  })).filter((group) => group.items.length);
  const otherScopes = (scopes ?? []).filter((scope) => !SCOPE_GROUPS.some((group) => scope.startsWith(`${group.key}:`)));
  const step = !signedIn ? 1 : busy ? 3 : 2;
  const ready = Boolean(scopes) && signedIn && !busy;

  return (
    <main className="gate consent">
      <GateField />
      <div className="gate-lines" aria-hidden="true">
        {Array.from({ length: 12 }, (_, index) => (
          <i key={index} />
        ))}
      </div>

      <section className="consent-card" aria-labelledby="connect-title">
        <div className="consent-link" aria-hidden="true">
          <span className="consent-node">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/sticky-192.png" width={34} height={34} alt="" />
          </span>
          <span className={`consent-wire${signedIn ? " is-live" : ""}`}>
            <i />
          </span>
          <span className="consent-node consent-node-client">
            <Bot size={22} />
          </span>
        </div>

        <header className="consent-head">
          <p className="consent-eyebrow">Sticky · account connection</p>
          <h1 id="connect-title">
            Connect <em>{clientName}</em>
          </h1>
          <p className="consent-lead">Allow {clientName} to use your Sticky workspace with these permissions:</p>
        </header>

        <ol className="consent-steps" aria-label="Connection progress">
          {["Sign in", "Review", "Allow"].map((label, index) => (
            <li key={label} className={index + 1 < step ? "done" : index + 1 === step ? "current" : ""}>
              <span>{index + 1 < step ? <Check size={12} /> : index + 1}</span>
              {label}
            </li>
          ))}
        </ol>

        {scopes ? (
          <div className="consent-scopes">
            {groups.map((group) => (
              <section key={group.key} className="consent-group" aria-label={`${group.title} permissions`}>
                <h2>
                  <group.icon size={15} aria-hidden="true" />
                  {group.title}
                </h2>
                <ul>
                  {group.items.map((scope) => {
                    const level = scope.split(":")[1] ?? "";
                    return (
                      <li key={scope} className={`consent-scope level-${level}`}>
                        <span className="consent-level">{LEVEL_LABELS[level] ?? level}</span>
                        <span>{labels[scope] ?? scope}</span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            {otherScopes.length ? (
              <ul className="consent-group">
                {otherScopes.map((scope) => (
                  <li key={scope} className="consent-scope">
                    <span>{labels[scope] ?? scope}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : !error ? (
          <p className="consent-status" role="status">
            <LoaderCircle className="gate-spinner" size={15} aria-hidden="true" />
            Checking connection request…
          </p>
        ) : null}

        <ul className="consent-facts">
          <li>
            <ShieldCheck size={14} aria-hidden="true" />
            Access applies only to your account. Disconnect this client any time in Sticky → Connections.
          </li>
          <li>
            <Clock3 size={14} aria-hidden="true" />
            Reconnect after 30 days of inactivity or 90 days.
          </li>
          <li>
            <KeyRound size={14} aria-hidden="true" />
            Existing Poke and Codex connections remain separate. Account administration and credential management stay under your control.
          </li>
        </ul>

        {error ? (
          <p className="notice error" role="alert">
            {error}
          </p>
        ) : null}

        {checkingSession ? (
          <p className="consent-status" role="status">
            <LoaderCircle className="gate-spinner" size={15} aria-hidden="true" />
            Checking your Sticky sign-in…
          </p>
        ) : !signedIn && scopes ? (
          <div className="consent-signin">
            <p>First sign in to your Sticky account. You’ll return here to approve the permissions. Signing in does not approve access automatically.</p>
            <a className="consent-allow" href={signInUrl}>
              Sign in with Google to continue
            </a>
            <p className="consent-alt">
              Prefer an email sign-in link?{" "}
              <a href="/" target="_blank" rel="noopener noreferrer">
                Open Sticky sign-in
              </a>
              , then return here.
            </p>
          </div>
        ) : signedIn ? (
          <p className="consent-status ok" role="status">
            <Check size={15} aria-hidden="true" />
            Signed in. Review the permissions, then allow access to finish connecting.
          </p>
        ) : null}

        <div className="consent-actions">
          <button className="consent-deny" disabled={!ready} onClick={() => void respond(false)}>
            Deny
          </button>
          <button className="consent-allow" disabled={!scopes || !signedIn || busy} onClick={() => void respond(true)}>
            {busy ? "Connecting…" : "Allow these permissions"}
          </button>
        </div>
      </section>
    </main>
  );
}
