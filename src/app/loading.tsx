const BOOT_LINES = ["Syncing your lists", "Placing tasks", "Opening the workspace"];

/**
 * Boot screen shown while a route's data resolves. Pure CSS choreography so it
 * renders instantly with no client bundle: the mark assembles from three
 * tiles, a ring sweeps around it, and the status line cycles.
 */
export default function Loading() {
  return (
    <main className="boot" aria-live="polite" aria-busy="true" aria-label="Loading Sticky">
      <div className="boot-field" aria-hidden="true">
        <i className="boot-aurora boot-aurora-a" />
        <i className="boot-aurora boot-aurora-b" />
        <i className="boot-grid" />
      </div>

      <section className="boot-stage">
        <div className="boot-mark" aria-hidden="true">
          <span className="boot-ring" />
          <span className="boot-ring boot-ring-2" />
          <span className="boot-tile boot-tile-1" />
          <span className="boot-tile boot-tile-2" />
          <span className="boot-tile boot-tile-3" />
          <span className="boot-core" />
        </div>

        <p className="boot-wordmark" aria-label="Sticky">
          {"STICKY".split("").map((letter, index) => (
            <span key={index} style={{ "--i": index } as React.CSSProperties}>
              {letter}
            </span>
          ))}
        </p>

        <div className="boot-status" role="status">
          {BOOT_LINES.map((line, index) => (
            <span key={line} style={{ "--i": index } as React.CSSProperties}>
              {line}
            </span>
          ))}
          <span className="boot-status-sr">Loading</span>
        </div>

        <div className="boot-progress" aria-hidden="true">
          <i />
        </div>
      </section>
    </main>
  );
}
