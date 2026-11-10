"use client";

import { useEffect, useState } from "react";
import { createStickyPlatformClient } from "@/lib/sticky/api-client";

const labels: Record<string, string> = {
  "tasks:read": "Read your lists, tasks, subtasks, deadlines, and recurring tasks",
  "tasks:write": "Create, edit, organize, complete, and reschedule tasks and lists",
  "tasks:destructive": "Delete tasks, subtasks, and lists when you instruct it",
  "calendar:read": "Read your Sticky calendars, events, and recurring events",
  "calendar:write": "Create and update Sticky calendars, events, and time blocks",
  "calendar:destructive": "Delete Sticky events when you instruct it",
};

export default function ConnectChatGPT() {
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
      if (!response.ok) throw new Error("Invalid or expired connection request. Start again from ChatGPT Plugins.");
      if (!cancelled) setScopes(body.data.scopes);
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
  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24 }}>
      <section className="connections-panel" style={{ width: "min(100%, 560px)", padding: 28 }} aria-labelledby="connect-title">
        <header className="connections-head"><div><span>Sticky · account connection</span><h1 id="connect-title">Connect ChatGPT / dot</h1></div></header>
        <p>Allow ChatGPT to use your Sticky workspace with these permissions:</p>
        {scopes ? <ul style={{ paddingLeft: 24, lineHeight: 1.7 }}>{scopes.map(scope => <li key={scope}>{labels[scope] ?? scope}</li>)}</ul> : !error ? <p role="status">Checking connection request…</p> : null}
        <p>Access applies only to your account. Disconnect any time in Sticky → Connections → ChatGPT / dot. Reconnect after 30 days of inactivity or 90 days.</p>
        <p>Existing Poke and Codex connections remain separate. Account administration and credential management stay under your control.</p>
        {error ? <p role="alert">{error}</p> : null}
        {checkingSession ? <p role="status">Checking your Sticky sign-in…</p> : !signedIn && scopes ? <div>
          <p>First sign in to your Sticky account. You’ll return here to approve the permissions. Signing in does not approve access automatically.</p>
          <a className="connection-primary" href={signInUrl}>Sign in with Google to continue</a>
          <p>Prefer an email sign-in link? <a href="/" target="_blank" rel="noopener noreferrer">Open Sticky sign-in</a>, then return here.</p>
        </div> : signedIn ? <p role="status">Signed in. Review the permissions, then allow access to finish connecting.</p> : null}
        <div className="connection-row-actions">
          <button className="connection-secondary" disabled={busy || !scopes || !signedIn} onClick={() => void respond(false)}>Deny</button>
          <button className="connection-primary" disabled={busy || !scopes || !signedIn} onClick={() => void respond(true)}>{busy ? "Connecting…" : "Allow these permissions"}</button>
        </div>
      </section>
    </main>
  );
}
