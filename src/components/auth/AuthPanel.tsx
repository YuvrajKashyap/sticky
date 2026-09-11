"use client";

import {
  AnimatePresence,
  motion,
  useMotionTemplate,
  useMotionValue,
  useSpring,
  useTransform,
} from "framer-motion";
import { ArrowRight, LoaderCircle, LockKeyhole, Mail } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DrawnCheck } from "@/components/sticky/motion";
import { userFacingStickyMessage } from "@/lib/sticky/messages";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { getAuthCallbackUrl } from "@/lib/supabase/redirect";
import { GateField, emitAuthSignal } from "./GateField";
import { capturePointerGeometry, pointerBounds, setPointerPercentage } from "./pointer-geometry";

type AuthPanelProps = {
  configurationMissing: boolean;
  accessMessage?: string;
};

type AuthStatus = "idle" | "sending" | "sent" | "error";
type AuthMethod = "email" | "google" | null;

const GATE_EASE = [0.16, 1, 0.3, 1] as const;
const TILT_SPRING = { stiffness: 240, damping: 20, mass: 0.55 };
const MAGNET_SPRING = { stiffness: 260, damping: 22, mass: 0.5 };
const MAGNET_REACH = 120;
const WORDMARK = "STICKY";
const DECRYPT_GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<>/\\|=+*#";
const FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
function readReducedMotion() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}
function useReducedMotion() {
  // Match the server's first frame before applying the device preference.
  return useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => false);
}

function subscribeFinePointer(onChange: () => void) {
  const query = window.matchMedia(FINE_POINTER_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function readFinePointer() {
  return window.matchMedia(FINE_POINTER_QUERY).matches;
}

function greetingForHour(hour: number) {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  if (hour >= 17 && hour < 23) return "Good evening";
  return "Late shift";
}

/** Oversized wordmark: letters flip up like tiles, then ripple on hover. */
function Wordmark() {
  const reduceMotion = useReducedMotion();
  return (
    <p className="gate-wordmark" aria-label={WORDMARK}>
      {WORDMARK.split("").map((letter, index) => (
        <span
          key={`${letter}-${index}`}
          className="gate-letter"
          style={{ "--wave-i": index } as React.CSSProperties}
          aria-hidden="true"
        >
          <motion.span
            className="gate-letter-face"
            initial={reduceMotion ? false : { opacity: 0, rotateX: -95, y: 18 }}
            animate={{ opacity: 1, rotateX: 0, y: 0 }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : { type: "spring", stiffness: 290, damping: 19, mass: 0.7, delay: 0.35 + index * 0.075 }
            }
            style={{ transformOrigin: "50% 100%", transformPerspective: 700 }}
          >
            {letter}
          </motion.span>
        </span>
      ))}
    </p>
  );
}

/** Terminal decrypt: glyphs cycle, then lock to the real text left to right. */
function DecryptText({ text, delay }: { text: string; delay: number }) {
  const reduceMotion = useReducedMotion();
  const [display, setDisplay] = useState("");

  useEffect(() => {
    if (reduceMotion) return;
    const start = performance.now() + delay * 1000;
    const duration = 1500;
    let frame = 0;
    const step = (now: number) => {
      const progress = Math.min(Math.max((now - start) / duration, 0), 1);
      const locked = Math.floor(progress * text.length);
      let out = "";
      for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        if (char === " " || i < locked) {
          out += char;
        } else {
          out += DECRYPT_GLYPHS[Math.floor(Math.random() * DECRYPT_GLYPHS.length)];
        }
      }
      setDisplay(progress >= 1 ? text : out);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [text, delay, reduceMotion]);

  return (
    <span className="gate-decrypt" aria-label={text}>
      <span aria-hidden="true">{reduceMotion ? text : display}</span>
    </span>
  );
}

/** Live readouts: time-of-day greeting and a ticking local clock. */
function Readouts() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    // First tick is deferred so the server-rendered placeholder hydrates cleanly.
    const first = window.setTimeout(() => setNow(new Date()), 0);
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);

  const clock = now
    ? `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
    : "--:--";

  return (
    <ul className="gate-readouts" aria-label="Workspace status">
      <li>{now ? greetingForHour(now.getHours()) : "Standing by"}</li>
      <li>Magic link or Google</li>
      <li>Approved accounts only</li>
      <li className="gate-readout-clock">
        Local {clock}
        <i aria-hidden="true" />
      </li>
    </ul>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

export function AuthPanel({ configurationMissing, accessMessage }: AuthPanelProps) {
  const reduceMotion = useReducedMotion();
  const safeAccessMessage = userFacingStickyMessage(accessMessage);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<AuthStatus>("idle");
  const [sendingMethod, setSendingMethod] = useState<AuthMethod>(null);
  const [message, setMessage] = useState(safeAccessMessage);
  const [shakeTick, setShakeTick] = useState(0);
  const finePointer = useSyncExternalStore(subscribeFinePointer, readFinePointer, () => false);

  const cardRef = useRef<HTMLDivElement | null>(null);
  const submitRef = useRef<HTMLButtonElement | null>(null);

  // Tilt + glare: pointer position across the card, spring-smoothed.
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const rotateX = useSpring(useTransform(py, [0, 1], [5, -5]), TILT_SPRING);
  const rotateY = useSpring(useTransform(px, [0, 1], [-6, 6]), TILT_SPRING);
  const glareX = useTransform(px, (value) => `${(value * 100).toFixed(1)}%`);
  const glareY = useTransform(py, (value) => `${(value * 100).toFixed(1)}%`);
  const glare = useMotionTemplate`radial-gradient(460px circle at ${glareX} ${glareY}, rgba(214, 240, 255, 0.11), transparent 62%)`;

  // Magnetic primary button.
  const magnetX = useSpring(useMotionValue(0), MAGNET_SPRING);
  const magnetY = useSpring(useMotionValue(0), MAGNET_SPRING);

  useEffect(() => {
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const hashError = hashParams.get("error_description") ?? hashParams.get("error");
    if (!hashError) return;

    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    const handle = window.setTimeout(() => {
      setStatus("error");
      setMessage(userFacingStickyMessage(hashError));
    });
    return () => window.clearTimeout(handle);
  }, []);

  function failWith(text: string) {
    setStatus("error");
    setMessage(text);
    setShakeTick((tick) => tick + 1);
    emitAuthSignal("error");
  }

  async function signInWithEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const supabase = createSupabaseBrowserClient();

    if (!supabase) {
      failWith(
        "Sticky sign-in is not connected in this environment. Add the required app settings or enable demo mode locally.",
      );
      return;
    }

    setStatus("sending");
    setSendingMethod("email");
    setMessage("");

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: getAuthCallbackUrl(window.location.origin) },
    });

    if (error) {
      failWith(userFacingStickyMessage(error.message, "Sticky could not send a sign-in link. Please try again."));
      return;
    }

    setStatus("sent");
    setMessage("Check your email for the secure Sticky sign-in link.");
    emitAuthSignal("sent");
  }

  function signInWithGoogle() {
    if (configurationMissing) {
      failWith("Sticky sign-in is not connected in this environment.");
      return;
    }
    setStatus("sending");
    setSendingMethod("google");
    setMessage("");
    emitAuthSignal("google");
    window.location.assign("/auth/google");
  }

  function measureCardPointer(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse") return;
    const door = event.target instanceof Element ? event.target.closest(".gate-door") : null;
    capturePointerGeometry(event.nativeEvent, [
      door,
      ...(!reduceMotion && finePointer ? [cardRef.current, submitRef.current] : []),
    ]);
  }

  function handleCardPointer(event: React.PointerEvent<HTMLDivElement>) {
    if (reduceMotion || !finePointer || event.pointerType !== "mouse") return;
    const card = cardRef.current;
    if (!card) return;
    const bounds = pointerBounds(event.nativeEvent, card);
    px.set((event.clientX - bounds.left) / bounds.width);
    py.set((event.clientY - bounds.top) / bounds.height);

    const button = submitRef.current;
    if (!button) return;
    const rect = pointerBounds(event.nativeEvent, button);
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const distance = Math.hypot(dx, dy);
    if (distance < MAGNET_REACH) {
      const pull = (1 - distance / MAGNET_REACH) * 0.34;
      magnetX.set(dx * pull);
      magnetY.set(dy * pull);
    } else {
      magnetX.set(0);
      magnetY.set(0);
    }
  }

  function resetCardPointer() {
    px.set(0.5);
    py.set(0.5);
    magnetX.set(0);
    magnetY.set(0);
  }

  /** Fill-from-cursor: the CTA's background blooms from the entry point. */
  function markEntryPoint(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.pointerType !== "mouse") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--fx", `${(((event.clientX - bounds.left) / bounds.width) * 100).toFixed(1)}%`);
    event.currentTarget.style.setProperty("--fy", `${(((event.clientY - bounds.top) / bounds.height) * 100).toFixed(1)}%`);
  }

  /** Persistent spotlight that follows the cursor across the Google button. */
  function trackSpotlight(event: React.PointerEvent<HTMLElement>) {
    if (event.pointerType !== "mouse") return;
    const bounds = pointerBounds(event.nativeEvent, event.currentTarget);
    setPointerPercentage(event.currentTarget.style, "--mx", (event.clientX - bounds.left) / bounds.width);
    setPointerPercentage(event.currentTarget.style, "--my", (event.clientY - bounds.top) / bounds.height);
  }

  const isSending = status === "sending";
  const emailSending = isSending && sendingMethod === "email";
  const googleSending = isSending && sendingMethod === "google";
  const submitState = emailSending ? "sending" : status === "sent" ? "sent" : "idle";
  const noticeTone = status === "error" || safeAccessMessage ? "error" : "success";
  const emailArmed = EMAIL_PATTERN.test(email.trim()) && status !== "sending";
  const lamp = status === "error" ? "error" : status === "sent" ? "sent" : status === "sending" ? "sending" : "idle";
  const lampLabel =
    lamp === "error"
      ? "Access denied"
      : lamp === "sent"
        ? "Link dispatched"
        : lamp === "sending"
          ? "Handshaking"
          : "Secure channel";

  return (
    <main className={`gate${finePointer ? " gate-fine" : ""}`}>
      <GateField />
      <div className="gate-aurora" aria-hidden="true">
        <i className="gate-aurora-a" />
        <i className="gate-aurora-b" />
      </div>
      <div className="gate-vignette" aria-hidden="true" />

      <section className="gate-stage">
        <div className="gate-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/sticky-192.png" width={80} height={80} alt="Sticky" style={{ borderRadius: 16 }} />
          <motion.p
            className="gate-eyebrow"
            initial={reduceMotion ? false : { opacity: 0, clipPath: "inset(0 100% 0 0)" }}
            animate={{ opacity: 1, clipPath: "inset(0 0% 0 0)" }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.9, ease: GATE_EASE, delay: 0.15 }}
          >
            <span className="gate-eyebrow-dot" aria-hidden="true" />
            Access gate // Private workspace
          </motion.p>

          <Wordmark />

          <p className="gate-tagline">
            <DecryptText text="Your lists are right where you left them." delay={0.9} />
          </p>

          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.8, ease: GATE_EASE, delay: 1.35 }}
          >
            <Readouts />
          </motion.div>
        </div>

        <motion.div
          ref={cardRef}
          className="gate-card"
          initial={reduceMotion ? false : { opacity: 0, y: 40, scale: 0.96, filter: "blur(14px)" }}
          animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
          transition={reduceMotion ? { duration: 0 } : { duration: 1.05, ease: GATE_EASE, delay: 0.55 }}
          style={{ rotateX, rotateY, transformPerspective: 1300 }}
          onPointerMoveCapture={measureCardPointer}
          onPointerMove={handleCardPointer}
          onPointerLeave={resetCardPointer}
        >
          <span className="gate-card-glow" aria-hidden="true" />
          <div className="gate-card-frame">
            <div className="gate-card-inner">
              <motion.span className="gate-card-glare" style={{ background: glare }} aria-hidden="true" />

              <div className="gate-strip" aria-hidden="true">
                <span className="gate-strip-id">
                  <i />
                  Gate // 01
                </span>
                <span className={`gate-lamp is-${lamp}`}>
                  <i />
                  {lampLabel}
                </span>
              </div>

              <div className="gate-head">
                <h1>Sign in to Sticky</h1>
                <p>Two doors. One workspace.</p>
              </div>

              {configurationMissing ? (
                <div className="notice warning">
                  Sticky sign-in is not connected in this environment. Add the required app settings,
                  or enable demo mode for local UI checks.
                </div>
              ) : null}

              <motion.ol
                key={shakeTick}
                className="gate-doors"
                initial={{ x: 0 }}
                animate={shakeTick && !reduceMotion ? { x: [0, -9, 8, -5, 3, 0] } : { x: 0 }}
                transition={{ duration: 0.42, ease: [0.4, 0, 0.2, 1] }}
              >
                <li className="gate-door-row">
                  <span className="gate-door-index" aria-hidden="true">01</span>
                  <button
                    className="gate-door gate-door-google"
                    type="button"
                    onClick={signInWithGoogle}
                    onPointerMove={trackSpotlight}
                    disabled={isSending}
                  >
                    <span className="gate-door-well" aria-hidden="true">
                      <GoogleMark />
                    </span>
                    <span className="gate-door-text">
                      <strong>Continue with Google</strong>
                      <small>One tap if you are already signed in.</small>
                    </span>
                    <span className="gate-door-meta" aria-hidden="true">
                      {googleSending ? "Opening" : "Fast lane"}
                      {googleSending ? (
                        <LoaderCircle className="gate-spinner" size={14} />
                      ) : (
                        <ArrowRight className="gate-door-arrow" size={14} />
                      )}
                    </span>
                  </button>
                </li>

                <li className="gate-door-row">
                  <span className="gate-door-index" aria-hidden="true">02</span>
                  <form
                    className={`gate-door gate-door-link${emailArmed ? " is-armed" : ""}`}
                    onSubmit={signInWithEmail}
                    onPointerMove={trackSpotlight}
                  >
                    <div className="gate-door-top">
                      <span className="gate-door-well" aria-hidden="true">
                        <Mail size={17} />
                      </span>
                      <span className="gate-door-text">
                        <strong>Magic link</strong>
                        <small>No password. We email you a one-time door.</small>
                      </span>
                      <span className="gate-door-meta" aria-hidden="true">
                        {submitState === "sent" ? "Dispatched" : submitState === "sending" ? "Sending" : emailArmed ? "Armed" : "Standby"}
                      </span>
                    </div>

                    <label className="gate-slot">
                      <span className="sr-only">Email address</span>
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
                      <i className="gate-slot-spine" aria-hidden="true" />
                      <motion.button
                        ref={submitRef}
                        className={`gate-key is-${submitState}`}
                        type="submit"
                        disabled={isSending}
                        onPointerEnter={markEntryPoint}
                        whileTap={reduceMotion ? undefined : { scale: 0.94 }}
                        style={{ x: magnetX, y: magnetY }}
                        aria-label={
                          submitState === "sent"
                            ? "Sign-in link sent"
                            : submitState === "sending"
                              ? "Sending sign-in link"
                              : "Send sign-in link"
                        }
                      >
                        <span className="gate-key-fill" aria-hidden="true" />
                        <AnimatePresence mode="wait" initial={false}>
                          {submitState === "sending" ? (
                            <motion.span
                              key="sending"
                              className="gate-key-glyph"
                              initial={{ opacity: 0, scale: 0.6, rotate: -30 }}
                              animate={{ opacity: 1, scale: 1, rotate: 0 }}
                              exit={{ opacity: 0, scale: 0.6, rotate: 30 }}
                              transition={{ type: "spring", stiffness: 420, damping: 24 }}
                            >
                              <LoaderCircle className="gate-spinner" size={18} aria-hidden="true" />
                            </motion.span>
                          ) : submitState === "sent" ? (
                            <motion.span
                              key="sent"
                              className="gate-key-glyph"
                              initial={{ opacity: 0, scale: 0.6, rotate: -30 }}
                              animate={{ opacity: 1, scale: 1, rotate: 0 }}
                              exit={{ opacity: 0, scale: 0.6, rotate: 30 }}
                              transition={{ type: "spring", stiffness: 420, damping: 24 }}
                            >
                              <DrawnCheck checked size={18} />
                            </motion.span>
                          ) : (
                            <motion.span
                              key="idle"
                              className="gate-key-glyph"
                              initial={{ opacity: 0, scale: 0.6, rotate: -30 }}
                              animate={{ opacity: 1, scale: 1, rotate: 0 }}
                              exit={{ opacity: 0, scale: 0.6, rotate: 30 }}
                              transition={{ type: "spring", stiffness: 420, damping: 24 }}
                            >
                              <ArrowRight size={18} aria-hidden="true" />
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </motion.button>
                    </label>
                  </form>
                </li>
              </motion.ol>

              <div className="gate-status" aria-live="polite">
                <AnimatePresence mode="wait" initial={false}>
                  {message ? (
                    <motion.div
                      key={`${noticeTone}-${message}`}
                      className={`notice ${noticeTone}`}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.22, ease: GATE_EASE }}
                    >
                      {message}
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>

              <footer className="gate-foot">
                <p className="gate-footnote">
                  <LockKeyhole size={12} aria-hidden="true" />
                  Approved accounts only
                </p>
                <nav className="gate-links" aria-label="About Sticky">
                  <a href="/about">About</a>
                  <a href="/privacy">Privacy</a>
                  <a href="/terms">Terms</a>
                </nav>
              </footer>
            </div>
          </div>
        </motion.div>
      </section>
    </main>
  );
}
