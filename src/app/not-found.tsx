import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <main className="route-state-screen">
      <section className="route-state-card" aria-label="Page not found">
        <div className="auth-mark route-state-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p className="eyebrow">Sticky</p>
        <h1>Nothing stuck here.</h1>
        <p>This address does not point to a Sticky workspace.</p>
        <Link className="primary-action compact state-link" href="/">
          <ArrowLeft size={16} />
          Back to Sticky
        </Link>
      </section>
    </main>
  );
}
