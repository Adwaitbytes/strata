"use client";

import { useSyncExternalStore } from "react";

const KEYS = ["--fg", "--fg-muted", "--fg-subtle", "--border", "--surface", "--accent", "--bid", "--ask", "--baseline", "--warn", "--font-mono-face"] as const;
export type ThemeTokens = Record<(typeof KEYS)[number], string>;

const cache = new Map<string, ThemeTokens>();

function snapshot(): ThemeTokens {
  const theme = document.documentElement.dataset.theme ?? "dark";
  let tokens = cache.get(theme);
  if (!tokens) {
    const cs = getComputedStyle(document.documentElement);
    tokens = Object.fromEntries(KEYS.map((k) => [k, cs.getPropertyValue(k).trim()])) as ThemeTokens;
    cache.set(theme, tokens);
  }
  return tokens;
}

function subscribe(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => obs.disconnect();
}

/** Resolved theme colors for canvas charts, refreshed when the theme attribute changes. */
export function useThemeTokens(): ThemeTokens | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

/** Hex (#rgb or #rrggbb) to rgba(); canvas libraries do not parse color-mix(). */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = Number.parseInt(full, 16);
  if (Number.isNaN(n) || full.length !== 6) return hex;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
