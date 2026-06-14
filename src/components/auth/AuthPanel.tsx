"use client";

import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, KeyRound, LockKeyhole, Sparkles } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { getAuthCallbackUrl } from "@/lib/supabase/redirect";

type AuthPanelProps = {
  configurationMissing: boolean;
  accessMessage?: string;
};

export function AuthPanel({ configurationMissing, accessMessage }: AuthPanelProps) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState(accessMessage ?? "");

  useEffect(() => {
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const hashError = hashParams.get("error_description") ?? hashParams.get("error");

    if (!hashError) {
      return;
    }

    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    const handle = window.setTimeout(() => {
      setStatus("error");
      setMessage(hashError);
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
    setMessage("");

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: getAuthCallbackUrl(window.location.origin),
      },
    });

    if (error) {
      setStatus("error");
      setMessage(error.message);
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
    setMessage("");

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: getAuthCallbackUrl(window.location.origin),
      },
    });

    if (error) {
      setStatus("error");
      setMessage(error.message);
    }
  }

  return (
    <main className="auth-screen">
      <section className="auth-hero" aria-label="Sticky sign in">
        <div className="auth-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p className="eyebrow">Sticky</p>
        <h1>Capture the day before it slips.</h1>
        <p className="auth-copy">
          Fast capture, ordered lists, subtasks, schedules, and repeating routines in a
          tactile workspace built to feel calm under pressure.
        </p>

        <div className="auth-feature-row" aria-label="Sticky capabilities">
          <span><Sparkles size={16} /> Tactile planning</span>
          <span><CheckCircle2 size={16} /> Calm completed piles</span>
          <span><LockKeyhole size={16} /> Private by default</span>
        </div>
      </section>

      <section className="auth-card" aria-label="Sign in form">
        <div className="auth-card-header">
          <div className="auth-card-icon">
            <KeyRound size={22} />
          </div>
          <div>
            <p className="eyebrow">Private workspace</p>
            <h2>Sign in to Sticky</h2>
          </div>
        </div>

        {configurationMissing ? (
          <div className="notice warning">
            Sticky sign-in is not connected in this environment. Add the required app
            settings, or enable demo mode for local UI checks.
          </div>
        ) : null}

        <form className="auth-form" onSubmit={signInWithEmail}>
          <label>
            <span>Email</span>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </label>
          <button className="primary-action" type="submit" disabled={status === "sending"}>
            {status === "sending" ? "Sending link" : "Email me a sign-in link"}
            <ArrowRight size={18} />
          </button>
        </form>

        <button className="secondary-action" type="button" onClick={signInWithGoogle}>
          Continue with Google
        </button>

        {message ? (
          <div className={`notice ${status === "error" || accessMessage ? "error" : "success"}`}>
            {message}
          </div>
        ) : null}

        <p className="auth-footnote">
          Only approved accounts can open this workspace. Your stickies stay private to
          your signed-in account.
        </p>
      </section>
    </main>
  );
}
