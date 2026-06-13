"use client";

import { RotateCcw } from "lucide-react";
import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="route-state-screen">
      <section className="route-state-card error-state" role="alert" aria-label="Sticky error">
        <div className="auth-mark route-state-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p className="eyebrow">Sticky</p>
        <h1>The desk jammed.</h1>
        <p>Sticky hit an unexpected snag while opening the workspace.</p>
        <button className="primary-action compact" type="button" onClick={reset}>
          <RotateCcw size={16} />
          Try again
        </button>
      </section>
    </main>
  );
}
