/**
 * STRATA design tokens: the typed source of truth. `theme.css` mirrors these values as CSS
 * custom properties (a test keeps the two in sync), and the 3D scene reads them directly.
 *
 * Concept: the order book as a geological survey (docs/DESIGN.md). Variable names are stable
 * across redesigns so components never reference a hex value.
 */

export const THEMES = ["dark", "light"] as const;
export type ThemeName = (typeof THEMES)[number];

export interface Palette {
  /** Page canvas: basalt in dark, survey paper in light. */
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
  /** The single survey color: STRATA depth, index contours, instrument marks. */
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
  /* Basalt: a warm mineral dark with a faint green-grey bias, chalk text, one ochre survey color. */
  dark: {
    bg: "#0D0F0E",
    bgRaised: "#121513",
    bgSunken: "#090B0A",
    surface: "#161917",
    surfaceHover: "#1C201E",
    border: "#262B28",
    borderStrong: "#373D39",
    fg: "#ECE8DF",
    fgMuted: "#B4AFA3",
    fgSubtle: "#8E897E",
    accent: "#E9A94B",
    accentStrong: "#F4C47A",
    accentFg: "#1C1205",
    bid: "#7CC9A0",
    ask: "#EA8A6A",
    warn: "#E2D25E",
    halt: "#F0656E",
    baseline: "#9AA39C",
    focus: "#F4C47A",
  },
  /* Survey paper: pale celadon map stock, iron-gall ink, burnt ochre for the survey color. */
  light: {
    bg: "#ECEEE7",
    bgRaised: "#F7F8F3",
    bgSunken: "#E3E6DD",
    surface: "#F7F8F3",
    surfaceHover: "#E4E7DF",
    border: "#D2D6CB",
    borderStrong: "#B5BBAE",
    fg: "#141613",
    fgMuted: "#474C45",
    fgSubtle: "#5A5F57",
    accent: "#8A560E",
    accentStrong: "#6F440A",
    accentFg: "#FFFFFF",
    bid: "#1D6A47",
    ask: "#A6432A",
    warn: "#5A5F00",
    halt: "#B0222F",
    baseline: "#535B55",
    focus: "#8A560E",
  },
};

/** Text roles and the backgrounds each must pass AA on. Used by the contrast test and DESIGN.md. */
export const TEXT_ROLES = ["fg", "fgMuted", "fgSubtle", "accent", "bid", "ask", "warn", "halt", "baseline"] as const;
export const TEXT_BACKGROUNDS = ["bg", "bgRaised", "surface", "surfaceHover"] as const;

/** 8px spacing scale. Tailwind's 4px base stays, and layouts use only even steps (p-2 = 8px). */
export const space = [0, 8, 16, 24, 32, 40, 48, 64, 80, 96, 128, 160] as const;

/** Survey instruments are machined, not pillowy: small radii, larger only on touch targets. */
export const radius = { xs: 2, sm: 3, md: 4, lg: 6, xl: 10, pill: 999 } as const;

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
  display: { min: 44, max: 112, leading: 0.92, tracking: -0.032 },
  h1: { min: 34, max: 60, leading: 0.98, tracking: -0.028 },
  h2: { min: 26, max: 38, leading: 1.06, tracking: -0.02 },
  h3: { size: 20, leading: 1.25, tracking: -0.01 },
  body: { size: 16, leading: 1.6, tracking: 0 },
  small: { size: 14, leading: 1.5, tracking: 0 },
  micro: { size: 12, leading: 1.4, tracking: 0.01 },
} as const;

/**
 * Colors the 3D survey terrain uses per theme, kept beside the palette so both modes stay in
 * step. Rock is shaded between `rockLow` and `rockHigh`; contour lines are drawn in `contour`
 * with every fifth (index) line heavier; STRATA depth glows in `strata`.
 */
export interface TerrainColors {
  fog: string;
  rockLow: string;
  rockHigh: string;
  contour: string;
  strata: string;
  bid: string;
  ask: string;
  fault: string;
  /** Opacity of ordinary contour lines; index lines are drawn at roughly twice this. */
  contourAlpha: number;
  /** Rim light strength on ridge silhouettes. */
  rim: number;
}

export const terrainScene: Record<ThemeName, TerrainColors> = {
  dark: {
    fog: "#0D0F0E",
    rockLow: "#101311",
    rockHigh: "#2A2F2B",
    contour: "#ECE8DF",
    strata: "#E9A94B",
    bid: "#7CC9A0",
    ask: "#EA8A6A",
    fault: "#F0656E",
    contourAlpha: 0.3,
    rim: 0.55,
  },
  light: {
    fog: "#ECEEE7",
    rockLow: "#E6E9E1",
    rockHigh: "#BAC0B2",
    contour: "#141613",
    strata: "#8A560E",
    bid: "#1D6A47",
    ask: "#A6432A",
    fault: "#B0222F",
    contourAlpha: 0.5,
    rim: 0.2,
  },
};
