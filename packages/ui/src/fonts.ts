/**
 * Brand typefaces, all SIL OFL 1.1 via next/font (self-hosted at build time, subset to Latin,
 * font-display: swap, size-adjusted fallbacks so swapping does not shift layout).
 *
 *   Bricolage Grotesque  display; optical size and width axes, so headlines run at opsz 96 and a
 *                        slightly narrowed width, the way a survey sheet title is set
 *   Schibsted Grotesk    text and UI; a sturdy news grotesk that stays legible at 13px
 *   Martian Mono         readouts; its width axis lets dense tables run narrower than headings,
 *                        and the `num` utility switches on tabular figures and slashed zero
 *
 * Consumers apply the variables to <html>. The display face is not preloaded globally: the
 * marketing and app layouts apply `displayFont.variable`, so next/font preloads it per route.
 */
import { Bricolage_Grotesque, Martian_Mono, Schibsted_Grotesk } from "next/font/google";

export const sansFont = Schibsted_Grotesk({ variable: "--font-sans-face", subsets: ["latin"], display: "swap" });

export const monoFont = Martian_Mono({
  variable: "--font-mono-face",
  subsets: ["latin"],
  display: "swap",
  axes: ["wdth"],
  preload: false,
});

export const displayFont = Bricolage_Grotesque({
  variable: "--font-display-face",
  subsets: ["latin"],
  display: "swap",
  axes: ["opsz", "wdth"],
});

export const fontVariables = `${sansFont.variable} ${monoFont.variable} ${displayFont.variable}`;
