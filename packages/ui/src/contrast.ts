/** WCAG 2.x relative luminance and contrast ratio for #RRGGBB colors. */

const HEX = /^#[0-9a-fA-F]{6}$/;

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  if (!HEX.test(hex)) throw new Error(`expected #RRGGBB, got ${hex}`);
  const r = channel(Number.parseInt(hex.slice(1, 3), 16));
  const g = channel(Number.parseInt(hex.slice(3, 5), 16));
  const b = channel(Number.parseInt(hex.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** AA thresholds: 4.5 for body text, 3 for large text (>= 24px, or >= 18.66px bold) and UI glyphs. */
export const AA_BODY = 4.5;
export const AA_LARGE = 3;
