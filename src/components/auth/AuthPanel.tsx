"use client";

import { useEffect, useState } from "react";
import { ArrowRight, LoaderCircle, LockKeyhole } from "lucide-react";
import { userFacingStickyMessage } from "@/lib/sticky/messages";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { getAuthCallbackUrl } from "@/lib/supabase/redirect";

type AuthPanelProps = {
  configurationMissing: boolean;
  accessMessage?: string;
};

export function AuthPanel({ configurationMissing, accessMessage }: AuthPanelProps) {
  const safeAccessMessage = userFacingStickyMessage(accessMessage);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [sendingMethod, setSendingMethod] = useState<"email" | "google" | null>(null);
  const [message, setMessage] = useState(safeAccessMessage);

  useEffect(() => {
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const hashError = hashParams.get("error_description") ?? hashParams.get("error");

    if (!hashError) {
      return;
    }

    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    const handle = window.setTimeout(() => {
      setStatus("error");
      setMessage(userFacingStickyMessage(hashError));
    });

    return () => window.clearTimeout(handle);
  }, []);

  async function signInWithEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const supabase = createSupabaseBrowserClient();

    if (!supabase) {
      setStatus("error");
      setMessage(
        "Sticky sign-in is not connected in this environment. Add the required app settings or enable demo mode locally.",
      );
      return;
    }

    setStatus("sending");
    setSendingMethod("email");
    setMessage("");

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: getAuthCallbackUrl(window.location.origin),
      },
    });

    if (error) {
      setStatus("error");
      setMessage(userFacingStickyMessage(error.message, "Sticky could not send a sign-in link. Please try again."));
      return;
    }

    setStatus("sent");
    setMessage("Check your email for the secure Sticky sign-in link.");
  }

  async function signInWithGoogle() {
    const supabase = createSupabaseBrowserClient();

    if (!supabase) {
      setStatus("error");
      setMessage("Sticky sign-in is not connected in this environment.");
      return;
    }

    setStatus("sending");
    setSendingMethod("google");
    setMessage("");

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: getAuthCallbackUrl(window.location.origin),
      },
    });

    if (error) {
      setStatus("error");
      setMessage(userFacingStickyMessage(error.message, "Sticky could not start Google sign-in. Please try again."));
    }
  }

  const isSending = status === "sending";

  return (
    <main className="auth-screen">
      <section className="auth-intake" aria-label="Sign in form">
        <span className="auth-pin" aria-hidden="true" />

        <header className="auth-intake-header">
          <div className="auth-meta-row">
            <div className="auth-brand" translate="no">
              <span className="auth-mark" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              <span>Sticky</span>
            </div>
            <span className="auth-meta-rule" aria-hidden="true" />
            <p className="auth-kicker"><LockKeyhole size={14} aria-hidden="true" /> Private workspace</p>
          </div>

          <h1>Sign in to Sticky</h1>
          <p className="auth-intro">Your lists are right where you left them.</p>
        </header>

        {configurationMissing ? (
          <div className="notice warning">
            Sticky sign-in is not connected in this environment. Add the required app
            settings, or enable demo mode for local UI checks.
          </div>
        ) : null}

        <button
          className="google-action"
          type="button"
          onClick={signInWithGoogle}
          disabled={isSending}
        >
          <span className="google-mark" aria-hidden="true">G</span>
          {sendingMethod === "google" && isSending ? "Opening Google…" : "Continue with Google"}
          {sendingMethod === "google" && isSending ? (
            <LoaderCircle className="auth-spinner" size={17} aria-hidden="true" />
          ) : <span aria-hidden="true" />}
        </button>

        <div className="auth-divider" aria-hidden="true"><span>or</span></div>

        <form className="auth-form" onSubmit={signInWithEmail}>
          <label>
            <span>Email address</span>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              name="email"
              placeholder="you@example.com"
              autoComplete="email"
              spellCheck={false}
              required
            />
          </label>
          <button className="primary-action" type="submit" disabled={isSending}>
            {sendingMethod === "email" && isSending ? "Sending…" : "Send sign-in link"}
            {sendingMethod === "email" && isSending ? (
              <LoaderCircle className="auth-spinner" size={17} aria-hidden="true" />
            ) : (
              <ArrowRight size={18} aria-hidden="true" />
            )}
          </button>
        </form>

        <div className="auth-status" aria-live="polite">
          {message ? (
            <div className={`notice ${status === "error" || safeAccessMessage ? "error" : "success"}`}>
              {message}
            </div>
          ) : null}
        </div>

        <p className="auth-footnote">
          <LockKeyhole size={13} aria-hidden="true" />
          Only approved accounts can open this workspace.
        </p>
      </section>
    </main>
  );
}
