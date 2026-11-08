import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 };

const INK = "#07080B";
const FG = "#ECEEF2";
const MUTED = "#A6AEBC";
const ACCENT = "#3EE6D4";
const WARN = "#F2B544";
const HALT = "#FF5C66";

export interface OgCard {
  kicker: string;
  title: string;
  stats: { label: string; value: string }[];
  labels: string[];
}

/** Shared social card: name, live numbers, and the same network and provenance labels as the page. */
export function ogImage(card: OgCard): ImageResponse {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: INK, color: FG, padding: "64px 72px", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {[0.9, 0.6, 0.35].map((o, i) => (
            <div key={i} style={{ display: "flex", height: 6, width: 220 - i * 50, background: ACCENT, opacity: o, borderRadius: 3 }} />
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", gap: 12, fontSize: 24, color: MUTED }}>
            <span>{card.kicker}</span>
            {card.labels.map((l) => (
              <span key={l} style={{ display: "flex", padding: "2px 12px", borderRadius: 6, fontSize: 20, letterSpacing: 2, color: l === "MOCK" ? HALT : l === "MAINNET" ? ACCENT : WARN, border: `2px solid ${l === "MOCK" ? HALT : l === "MAINNET" ? ACCENT : WARN}` }}>
                {l}
              </span>
            ))}
          </div>
          <div style={{ display: "flex", fontSize: 76, fontWeight: 700, letterSpacing: -2, lineHeight: 1.05 }}>{card.title}</div>
        </div>
        <div style={{ display: "flex", gap: 64, alignItems: "flex-end" }}>
          {card.stats.map((s) => (
            <div key={s.label} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 22, color: MUTED }}>{s.label}</span>
              <span style={{ fontSize: 48, fontWeight: 600 }}>{s.value}</span>
            </div>
          ))}
          <span style={{ display: "flex", marginLeft: "auto", fontSize: 30, fontWeight: 700, letterSpacing: 8 }}>STRATA</span>
        </div>
      </div>
    ),
    OG_SIZE,
  );
}
