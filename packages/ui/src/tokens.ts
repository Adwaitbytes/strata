/**
 * STRATA design tokens: the typed source of truth. `theme.css` mirrors these values as CSS
 * custom properties (a test keeps the two in sync), and the 3D scene reads them directly.
 *
 * Variable names match the interim W7 theme so swapping the import changes no component.
 */

export const THEMES = ["dark", "light"] as const;
export type ThemeName = (typeof THEMES)[number];

export interface Palette {
  /** Page canvas: deep ink in dark, cool paper in light. */
  bg: string;
  bgRaised: string;
  bgSunken: string;
  surface: string;
  surfaceHover: string;
  border: string;
  borderStrong: string;
  fg: string;
  fgMuted: string;
  fgSubtle: string;
  /** The single signature accent: liquidity. */
  accent: string;
  accentStrong: string;
  /** Text and icons placed on a solid accent fill. */
  accentFg: string;
  bid: string;
  ask: string;
  warn: string;
  halt: string;
  /** Pre-STRATA measurements (BASELINE provenance). */
  baseline: string;
  focus: string;
}

export const palette: Record<ThemeName, Palette> = {
  dark: {
    bg: "#07080B",
    bgRaised: "#0D0F14",
    bgSunken: "#050609",
    surface: "#11141A",
    surfaceHover: "#171B23",
    border: "#1F242D",
    borderStrong: "#2D343F",
    fg: "#ECEEF2",
    fgMuted: "#A6AEBC",
    fgSubtle: "#808A9B",
    accent: "#3EE6D4",
    accentStrong: "#7FF0E3",
    accentFg: "#04201D",
    bid: "#5CD69A",
    ask: "#FF8170",
    warn: "#F2B544",
    halt: "#FF5C66",
    baseline: "#8C95A8",
    focus: "#7FF0E3",
  },
  light: {
    bg: "#F4F6F9",
    bgRaised: "#FFFFFF",
    bgSunken: "#EBEEF3",
    surface: "#FFFFFF",
    surfaceHover: "#F0F2F6",
    border: "#DFE3EA",
    borderStrong: "#C6CDD7",
    fg: "#0A0C10",
    fgMuted: "#434B59",
    fgSubtle: "#5A6373",
    accent: "#006E66",
    accentStrong: "#00574F",
    accentFg: "#FFFFFF",
    bid: "#11713F",
    ask: "#B83525",
    warn: "#875500",
    halt: "#B81D2A",
    baseline: "#576074",
    focus: "#006E66",
  },
};

/** Text roles and the backgrounds each must pass AA on. Used by the contrast test and DESIGN.md. */
export const TEXT_ROLES = ["fg", "fgMuted", "fgSubtle", "accent", "bid", "ask", "warn", "halt", "baseline"] as const;
export const TEXT_BACKGROUNDS = ["bg", "bgRaised", "surface", "surfaceHover"] as const;

/** 8px spacing scale. Tailwind's 4px base stays, and layouts use only even steps (p-2 = 8px). */
export const space = [0, 8, 16, 24, 32, 40, 48, 64, 80, 96, 128, 160] as const;

export const radius = { xs: 4, sm: 6, md: 10, lg: 14, xl: 20, pill: 999 } as const;

export const motion = {
  duration: { instant: 120, fast: 180, base: 240, slow: 320, scene: 640 },
  ease: {
    out: "cubic-bezier(0.22, 1, 0.36, 1)",
    inOut: "cubic-bezier(0.65, 0, 0.35, 1)",
    in: "cubic-bezier(0.5, 0, 0.75, 0)",
  },
  /** Spring for interactive elements (Motion). */
  spring: { type: "spring", stiffness: 420, damping: 38, mass: 0.9 },
} as const;

/** Type scale (px / line-height / tracking em). Display sizes are fluid in CSS between min and max. */
export const typeScale = {
  display: { min: 44, max: 104, leading: 0.94, tracking: -0.035 },
  h1: { min: 34, max: 56, leading: 1.02, tracking: -0.03 },
  h2: { min: 26, max: 36, leading: 1.1, tracking: -0.02 },
  h3: { size: 20, leading: 1.3, tracking: -0.01 },
  body: { size: 16, leading: 1.6, tracking: 0 },
  small: { size: 14, leading: 1.5, tracking: 0 },
  micro: { size: 12, leading: 1.4, tracking: 0.01 },
} as const;

/** Colors the 3D strata scene uses per theme. Kept beside the palette so both modes stay in step. */
export const strataScene: Record<ThemeName, { glass: string; core: string; neutral: string; bloom: number }> = {
  dark: { glass: "#9FE9E1", core: "#3EE6D4", neutral: "#8C95A8", bloom: 0.55 },
  light: { glass: "#7FC9C1", core: "#006E66", neutral: "#576074", bloom: 0 },
};
