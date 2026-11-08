/**
 * Brand typefaces, all SIL OFL 1.1 via next/font (self-hosted at build time, subset to Latin,
 * font-display: swap, size-adjusted fallbacks so swapping does not shift layout).
 *
 *   Geist        UI grotesk
 *   Geist Mono   numbers and code; tabular figures are switched on by the `num` utility
 *   Archivo      display; the variable width axis (wdth 62 to 125) is loaded so headlines
 *                can run expanded, the same cut the wordmark was drawn from
 *
 * Consumers apply `fontVariables` to <html>. The display face is not preloaded globally:
 * pages that lead with it (the Landing) render <link rel="preload"> through `displayFont.className`
 * usage, which next/font handles per route.
 */
import { Archivo, Geist, Geist_Mono } from "next/font/google";

export const sansFont = Geist({ variable: "--font-sans-face", subsets: ["latin"], display: "swap" });

export const monoFont = Geist_Mono({ variable: "--font-mono-face", subsets: ["latin"], display: "swap" });

export const displayFont = Archivo({
  variable: "--font-display-face",
  subsets: ["latin"],
  display: "swap",
  axes: ["wdth"],
});

export const fontVariables = `${sansFont.variable} ${monoFont.variable} ${displayFont.variable}`;
