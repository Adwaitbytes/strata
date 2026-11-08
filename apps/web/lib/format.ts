/**
 * Number formatting for every data view. All output is locale-fixed (en-US) so server and
 * client render identical strings and hydration never mismatches. Negative numbers use the
 * typographic minus (U+2212) so signed columns align with tabular figures.
 */
const MINUS = "−";
export const NA = "n/a";

const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function compact(value: number, digits: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return NA;
  const abs = Math.abs(value);
  const sign = value < 0 ? MINUS : "";
  if (abs >= 1_000_000) return `${sign}$${compact(abs, 2)}`;
  if (abs >= 10_000) return `${sign}$${compact(abs, 1)}`;
  return `${sign}$${int.format(abs)}`;
}

export function formatUsdSigned(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return NA;
  const abs = Math.abs(value).toFixed(2);
  if (value > 0) return `+$${abs}`;
  if (value < 0) return `${MINUS}$${abs}`;
  return `$${abs}`;
}

export function formatBps(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return NA;
  return `${value < 0 ? MINUS : ""}${Math.abs(value).toFixed(1)} bps`;
}

export function formatUptime(bps: number | null | undefined): string {
  if (bps == null || !Number.isFinite(bps)) return NA;
  return `${(bps / 100).toFixed(2)}%`;
}

export function formatPct(share: number | null | undefined, digits = 1): string {
  if (share == null || !Number.isFinite(share)) return NA;
  return `${(share * 100).toFixed(digits)}%`;
}

export function formatScore(score: number | null | undefined): string {
  if (score == null || !Number.isFinite(score)) return NA;
  return int.format(score);
}

/** Formats a decimal string (human units) without converting through a float. */
export function formatPrice(value: string | null | undefined): string {
  if (value == null) return NA;
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return NA;
  const [, neg, whole = "0", frac] = match;
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? MINUS : ""}${grouped}${frac ? `.${frac}` : ""}`;
}

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const hms = [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
  return days > 0 ? `${days}d ${hms}` : hms;
}

export function shortHex(hex: string, head = 6, tail = 4): string {
  if (hex.length <= head + tail + 1) return hex;
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}

const dateTime = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

/** UTC so the server and client agree; the label says UTC. */
export function formatUtc(ms: number | null | undefined): string {
  if (ms == null) return NA;
  return `${dateTime.format(new Date(ms))} UTC`;
}

export function formatAge(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return NA;
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${Math.round(sec / 3600)}h`;
}
