import { ImageResponse } from "next/og";

type InstallScreenshotVariant = "wide" | "narrow";

const colors = {
  ink: "#1e2538",
  muted: "#647084",
  paper: "#fff8df",
  cream: "#fffdf5",
  sun: "#ffce3a",
  coral: "#ff7d67",
  mint: "#46d89a",
  sky: "#61c7ff",
  violet: "#a78bfa",
};

function BrandMark({ size = 78 }: { size?: number }) {
  const noteSize = Math.round(size * 0.56);
  const border = Math.max(4, Math.round(size * 0.04));

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        width: size,
        height: Math.round(size * 0.9),
      }}
    >
      {[
        { background: colors.sun, left: 0, top: Math.round(size * 0.24), rotate: "-10deg" },
        { background: colors.sky, left: Math.round(size * 0.28), top: 0, rotate: "7deg" },
        { background: colors.coral, left: Math.round(size * 0.5), top: Math.round(size * 0.36), rotate: "10deg" },
      ].map((note) => (
        <div
          key={`${note.background}-${note.left}`}
          style={{
            position: "absolute",
            left: note.left,
            top: note.top,
            width: noteSize,
            height: noteSize,
            border: `${border}px solid ${colors.ink}`,
            borderRadius: Math.round(size * 0.11),
            background: note.background,
            transform: `rotate(${note.rotate})`,
            boxShadow: `${Math.round(size * 0.05)}px ${Math.round(size * 0.08)}px 0 rgba(30,37,56,0.14)`,
          }}
        />
      ))}
    </div>
  );
}

function RailItem({
  active,
  color,
  title,
  count,
}: {
  active?: boolean;
  color: string;
  title: string;
  count: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        minHeight: 64,
        borderRadius: 18,
        border: `2px solid ${active ? "rgba(30,37,56,0.2)" : "rgba(30,37,56,0.1)"}`,
        background: active ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.52)",
        padding: "0 18px",
        boxShadow: active ? "0 16px 34px rgba(30,37,56,0.14)" : "none",
      }}
    >
      <div
        style={{
          width: 18,
          height: 18,
          borderRadius: 999,
          background: color,
          border: "2px solid rgba(30,37,56,0.16)",
          marginRight: 14,
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        <span style={{ color: colors.ink, fontSize: 24, fontWeight: 900 }}>{title}</span>
        <span style={{ color: colors.muted, fontSize: 17, fontWeight: 800 }}>{count}</span>
      </div>
    </div>
  );
}

function StickyCard({
  color,
  title,
  meta,
  selected,
}: {
  color: string;
  title: string;
  meta: string;
  selected?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        minHeight: 118,
        borderRadius: 22,
        border: `3px solid ${selected ? colors.ink : "rgba(30,37,56,0.13)"}`,
        background: color,
        padding: 20,
        boxShadow: selected ? "12px 14px 0 rgba(30,37,56,0.16)" : "0 14px 30px rgba(30,37,56,0.12)",
      }}
    >
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: 999,
          border: `4px solid ${colors.ink}`,
          background: "rgba(255,255,255,0.78)",
          marginRight: 16,
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        <span style={{ color: colors.ink, fontSize: 27, fontWeight: 950, lineHeight: 1.05 }}>{title}</span>
        <span style={{ color: "rgba(30,37,56,0.72)", fontSize: 18, fontWeight: 800, marginTop: 11 }}>
          {meta}
        </span>
      </div>
    </div>
  );
}

function FilterPill({ active, label, count }: { active?: boolean; label: string; count: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        minHeight: 44,
        borderRadius: 999,
        background: active ? colors.ink : "rgba(255,255,255,0.68)",
        color: active ? "#fffdf5" : colors.ink,
        border: "2px solid rgba(30,37,56,0.12)",
        padding: "0 16px",
        marginRight: 10,
        fontSize: 18,
        fontWeight: 900,
      }}
    >
      {label}
      <span
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: 30,
          height: 28,
          borderRadius: 999,
          background: active ? "rgba(255,255,255,0.18)" : "rgba(30,37,56,0.08)",
          marginLeft: 10,
          fontSize: 16,
        }}
      >
        {count}
      </span>
    </div>
  );
}

function WideScreenshot() {
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        background:
          "linear-gradient(90deg, rgba(30,37,56,0.055) 1px, transparent 1px), linear-gradient(rgba(30,37,56,0.055) 1px, transparent 1px), linear-gradient(135deg, #fff7dc 0%, #f1fbff 52%, #edfff7 100%)",
        backgroundSize: "38px 38px, 38px 38px, auto",
        padding: 34,
        color: colors.ink,
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          borderRadius: 36,
          border: "3px solid rgba(30,37,56,0.13)",
          background: "rgba(255,253,245,0.92)",
          boxShadow: "0 28px 80px rgba(30,37,56,0.18)",
          padding: 24,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: 282,
            borderRight: "2px solid rgba(30,37,56,0.1)",
            paddingRight: 20,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", marginBottom: 22 }}>
            <BrandMark size={80} />
            <div style={{ display: "flex", flexDirection: "column", marginLeft: 16 }}>
              <span style={{ fontSize: 34, fontWeight: 950 }}>Sticky</span>
              <span style={{ color: colors.muted, fontSize: 16, fontWeight: 900 }}>Command center</span>
            </div>
          </div>
          <RailItem active color={colors.sun} title="reminders" count="3 active / 1 done" />
          <div style={{ height: 12 }} />
          <RailItem color={colors.sky} title="Next 3" count="4 active / 0 done" />
          <div style={{ height: 12 }} />
          <RailItem color={colors.mint} title="bring" count="2 active / 0 done" />
          <div style={{ flex: 1 }} />
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              borderRadius: 22,
              background: colors.ink,
              color: "#fffdf5",
              padding: 18,
            }}
          >
            <span style={{ fontSize: 17, fontWeight: 900, opacity: 0.74 }}>Live workspace</span>
            <span style={{ fontSize: 28, fontWeight: 950, marginTop: 4 }}>Supabase-backed</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", flex: 1, paddingLeft: 26, paddingRight: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ color: "#1787d4", fontSize: 18, fontWeight: 950, textTransform: "uppercase" }}>
                Current list
              </span>
              <span style={{ fontSize: 52, fontWeight: 950, lineHeight: 0.95 }}>reminders</span>
              <span style={{ color: colors.muted, fontSize: 19, fontWeight: 850, marginTop: 12 }}>
                3 active / 1 completed / 4 open subtasks
              </span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                minHeight: 54,
                borderRadius: 18,
                background: "rgba(255,255,255,0.78)",
                border: "2px solid rgba(30,37,56,0.13)",
                padding: "0 20px",
                color: colors.muted,
                fontSize: 19,
                fontWeight: 900,
              }}
            >
              Search current list
            </div>
          </div>

          <div style={{ display: "flex", marginTop: 24 }}>
            <FilterPill active label="All" count="3" />
            <FilterPill label="Today" count="2" />
            <FilterPill label="Scheduled" count="3" />
            <FilterPill label="Repeating" count="1" />
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              minHeight: 76,
              borderRadius: 24,
              background: "#ffffff",
              border: "3px solid rgba(30,37,56,0.13)",
              boxShadow: "0 18px 44px rgba(30,37,56,0.13)",
              padding: "0 22px",
              marginTop: 20,
            }}
          >
            <span style={{ color: colors.muted, fontSize: 26, fontWeight: 850 }}>Add a task to reminders</span>
            <span
              style={{
                marginLeft: "auto",
                borderRadius: 16,
                background: colors.sun,
                color: colors.ink,
                padding: "12px 22px",
                fontSize: 20,
                fontWeight: 950,
              }}
            >
              Add
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", marginTop: 20 }}>
            <StickyCard selected color="#ffed9a" title="Clear the capture tray" meta="Today at 14:00 / 2 subtasks" />
            <div style={{ height: 14 }} />
            <StickyCard color="#dff8ff" title="Prepare launch checklist" meta="Tomorrow at 09:00 / repeats weekly" />
            <div style={{ height: 14 }} />
            <StickyCard color="#dcfce7" title="Polish mobile install flow" meta="Scheduled / 1 subtask" />
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: 302,
            borderRadius: 30,
            background: colors.ink,
            color: "#fffdf5",
            padding: 24,
          }}
        >
          <span style={{ color: colors.sun, fontSize: 17, fontWeight: 950, textTransform: "uppercase" }}>
            Sticky details
          </span>
          <span style={{ fontSize: 32, fontWeight: 950, lineHeight: 1.02, marginTop: 12 }}>
            Clear the capture tray
          </span>
          <span style={{ color: "rgba(255,253,245,0.74)", fontSize: 18, fontWeight: 800, marginTop: 12 }}>
            Due today at 2:00 PM
          </span>
          <div style={{ height: 22 }} />
          {["Review saved draft", "Confirm recurrence worker", "Ship verified deploy"].map((title, index) => (
            <div
              key={title}
              style={{
                display: "flex",
                alignItems: "center",
                minHeight: 48,
                borderRadius: 16,
                background: index === 0 ? "rgba(70,216,154,0.23)" : "rgba(255,253,245,0.12)",
                padding: "0 14px",
                marginBottom: 10,
                fontSize: 17,
                fontWeight: 850,
              }}
            >
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 999,
                  background: index === 0 ? colors.mint : "transparent",
                  border: "2px solid rgba(255,253,245,0.5)",
                  marginRight: 10,
                }}
              />
              {title}
            </div>
          ))}
          <div style={{ flex: 1 }} />
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              borderRadius: 18,
              background: colors.sun,
              color: colors.ink,
              padding: "16px 0",
              fontSize: 20,
              fontWeight: 950,
            }}
          >
            Complete sticky
          </div>
        </div>
      </div>
    </div>
  );
}

function NarrowScreenshot() {
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        background: "linear-gradient(145deg, #fff5cf 0%, #eaf9ff 54%, #f0fff7 100%)",
        padding: 18,
        color: colors.ink,
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          borderRadius: 34,
          border: "3px solid rgba(30,37,56,0.14)",
          background: "rgba(255,253,245,0.95)",
          boxShadow: "0 22px 58px rgba(30,37,56,0.18)",
          padding: 18,
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <BrandMark size={66} />
          <div style={{ display: "flex", flexDirection: "column", marginLeft: 12 }}>
            <span style={{ color: colors.ink, fontSize: 32, fontWeight: 950 }}>Sticky</span>
            <span style={{ color: colors.muted, fontSize: 15, fontWeight: 900 }}>reminders workspace</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", marginTop: 20 }}>
          <span style={{ color: "#1787d4", fontSize: 14, fontWeight: 950, textTransform: "uppercase" }}>
            Current list
          </span>
          <span style={{ color: colors.ink, fontSize: 44, fontWeight: 950, lineHeight: 0.95 }}>reminders</span>
          <span style={{ color: colors.muted, fontSize: 15, fontWeight: 850, marginTop: 9 }}>
            3 active / 1 completed / 4 subtasks
          </span>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            minHeight: 58,
            borderRadius: 20,
            background: "#ffffff",
            border: "2px solid rgba(30,37,56,0.13)",
            boxShadow: "0 12px 32px rgba(30,37,56,0.12)",
            padding: "0 15px",
            marginTop: 18,
          }}
        >
          <span style={{ color: colors.muted, fontSize: 18, fontWeight: 850 }}>Add a task to reminders</span>
          <span
            style={{
              marginLeft: "auto",
              borderRadius: 14,
              background: colors.sun,
              color: colors.ink,
              padding: "9px 14px",
              fontSize: 16,
              fontWeight: 950,
            }}
          >
            Add
          </span>
        </div>

        <div style={{ display: "flex", marginTop: 16 }}>
          <FilterPill active label="All" count="3" />
          <FilterPill label="Today" count="2" />
        </div>

        <div style={{ display: "flex", flexDirection: "column", marginTop: 16 }}>
          <StickyCard selected color="#ffed9a" title="Clear the capture tray" meta="Today at 14:00" />
          <div style={{ height: 12 }} />
          <StickyCard color="#dff8ff" title="Prepare launch checklist" meta="Tomorrow at 09:00" />
          <div style={{ height: 12 }} />
          <StickyCard color="#dcfce7" title="Polish install flow" meta="Scheduled / 1 subtask" />
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            minHeight: 74,
            borderRadius: 24,
            background: colors.ink,
            color: "#fffdf5",
            padding: "0 18px",
            marginTop: "auto",
          }}
        >
          <span style={{ fontSize: 18, fontWeight: 900, color: colors.sun, marginRight: 12 }}>Live</span>
          <span style={{ fontSize: 18, fontWeight: 850 }}>Capture, filter, and complete from any device.</span>
        </div>
      </div>
    </div>
  );
}

export function createInstallScreenshot(variant: InstallScreenshotVariant) {
  return new ImageResponse(variant === "wide" ? <WideScreenshot /> : <NarrowScreenshot />, {
    width: variant === "wide" ? 1280 : 390,
    height: variant === "wide" ? 720 : 844,
  });
}
