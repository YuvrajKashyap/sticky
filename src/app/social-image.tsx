import { ImageResponse } from "next/og";

export const alt = "Sticky - premium sticky tasks for fast capture and daily planning";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

function StickyMark() {
  const notes = [
    { background: "#ffce3a", left: 0, top: 36, rotate: "-10deg" },
    { background: "#61c7ff", left: 44, top: 0, rotate: "7deg" },
    { background: "#ff7d67", left: 76, top: 56, rotate: "10deg" },
  ];

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        width: 154,
        height: 136,
      }}
    >
      {notes.map((note) => (
        <div
          key={`${note.background}-${note.left}`}
          style={{
            position: "absolute",
            left: note.left,
            top: note.top,
            width: 82,
            height: 82,
            border: "6px solid #1e2538",
            borderRadius: 17,
            background: note.background,
            transform: `rotate(${note.rotate})`,
            boxShadow: "8px 11px 0 rgba(30, 37, 56, 0.14)",
          }}
        />
      ))}
    </div>
  );
}

function FeaturePill({ color, label }: { color: string; label: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        minHeight: 48,
        border: "2px solid rgba(30, 37, 56, 0.13)",
        borderRadius: 999,
        background: "rgba(255, 255, 255, 0.72)",
        padding: "0 22px",
        fontSize: 24,
        fontWeight: 800,
        color: "#30384d",
      }}
    >
      <span
        style={{
          width: 14,
          height: 14,
        borderRadius: 999,
        background: color,
        marginRight: 12,
        }}
      />
      {label}
    </div>
  );
}

export function createStickySocialImage() {
  return new ImageResponse(
    (
      <div
        style={{
          position: "relative",
          display: "flex",
          width: "100%",
          height: "100%",
          overflow: "hidden",
          background:
            "linear-gradient(90deg, rgba(30,37,56,0.055) 1px, transparent 1px), linear-gradient(rgba(30,37,56,0.055) 1px, transparent 1px), linear-gradient(135deg, #fff7dd 0%, #f5f7ff 48%, #edfff7 100%)",
          backgroundSize: "42px 42px, 42px 42px, auto",
          color: "#1e2538",
          fontFamily: "Arial, sans-serif",
          padding: 50,
        }}
      >
        <div
          style={{
            position: "absolute",
            right: -80,
            top: -72,
            width: 420,
            height: 420,
            borderRadius: 999,
            background: "rgba(97, 199, 255, 0.26)",
          }}
        />
        <div
          style={{
            position: "absolute",
            right: 74,
            bottom: -98,
            width: 520,
            height: 280,
            borderRadius: 48,
            background: "rgba(70, 216, 154, 0.22)",
            transform: "rotate(-8deg)",
          }}
        />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            width: "100%",
            height: "100%",
            border: "3px solid rgba(30, 37, 56, 0.12)",
            borderRadius: 34,
            background: "rgba(255, 253, 245, 0.9)",
            boxShadow: "0 26px 70px rgba(30, 37, 56, 0.16)",
            padding: 34,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              <StickyMark />
              <div style={{ display: "flex", flexDirection: "column", marginLeft: 22 }}>
                <div
                  style={{
                    color: "#1787d4",
                    fontSize: 26,
                    fontWeight: 900,
                    letterSpacing: 0,
                    textTransform: "uppercase",
                  }}
                >
                  Sticky
                </div>
                <div style={{ color: "#667085", fontSize: 23, fontWeight: 800 }}>
                  Personal command center
                </div>
              </div>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                minHeight: 52,
                border: "2px solid rgba(30, 37, 56, 0.13)",
                borderRadius: 18,
                background: "#1e2538",
                color: "#fffaf0",
                padding: "0 22px",
                fontSize: 23,
                fontWeight: 900,
              }}
            >
              Built for sticky.yuvrajkashyap.com
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", maxWidth: 880 }}>
            <div style={{ display: "flex", flexDirection: "column", fontSize: 68, fontWeight: 950, lineHeight: 0.95 }}>
              <span>Premium sticky tasks.</span>
              <span>Fast capture, clear focus.</span>
            </div>
            <div
              style={{
                marginTop: 18,
                maxWidth: 820,
                color: "#30384d",
                fontSize: 28,
                fontWeight: 750,
                lineHeight: 1.18,
              }}
            >
              Lists, subtasks, due dates, completed piles, recurrence, and Supabase-backed focus.
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center" }}>
            <FeaturePill color="#ffce3a" label="Quick capture" />
            <div style={{ width: 14 }} />
            <FeaturePill color="#61c7ff" label="Daily pulse" />
            <div style={{ width: 14 }} />
            <FeaturePill color="#46d89a" label="Private by design" />
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    },
  );
}
