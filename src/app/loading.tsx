export default function Loading() {
  return (
    <main className="route-state-screen" aria-live="polite" aria-busy="true">
      <section className="route-state-card loading-state" aria-label="Loading Sticky">
        <div className="auth-mark route-state-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p className="eyebrow">Sticky</p>
        <h1>Setting the desk.</h1>
        <p>Your workspace is opening.</p>
        <div className="state-skeleton-grid" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </section>
    </main>
  );
}
