import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AA_BODY, AA_LARGE, contrastRatio } from "./contrast";
import { palette, terrainScene, TEXT_BACKGROUNDS, TEXT_ROLES, THEMES, type Palette } from "./tokens";

const themeCss = readFileSync(fileURLToPath(new URL("./theme.css", import.meta.url)), "utf8");

function cssVarName(key: keyof Palette): string {
  return `--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/** Returns the declarations of the first rule whose selector list contains `selector`. */
function block(selector: string): string {
  const start = themeCss.indexOf(selector);
  if (start < 0) throw new Error(`selector ${selector} missing from theme.css`);
  const open = themeCss.indexOf("{", start);
  return themeCss.slice(open + 1, themeCss.indexOf("}", open));
}

describe("contrastRatio", () => {
  it("matches known WCAG reference values", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#FFFFFF")).toBeCloseTo(4.48, 2);
  });

  it("rejects malformed colors", () => {
    expect(() => contrastRatio("teal", "#FFFFFF")).toThrow();
  });
});

describe.each(THEMES)("%s palette", (theme) => {
  const p = palette[theme];

  it.each(TEXT_ROLES)("text role %s passes AA body on every surface", (role) => {
    for (const bg of TEXT_BACKGROUNDS) {
      expect(contrastRatio(p[role], p[bg]), `${role} on ${bg}`).toBeGreaterThanOrEqual(AA_BODY);
    }
  });

  it("accent fill keeps its label readable", () => {
    expect(contrastRatio(p.accentFg, p.accent)).toBeGreaterThanOrEqual(AA_BODY);
  });

  it("focus ring is visible against the canvas", () => {
    expect(contrastRatio(p.focus, p.bg)).toBeGreaterThanOrEqual(AA_LARGE);
  });

  it("theme.css declares the same values", () => {
    const selector = theme === "dark" ? ':root[data-theme="dark"]' : ':root[data-theme="light"]';
    const decls = block(selector).toLowerCase();
    for (const key of Object.keys(p) as (keyof Palette)[]) {
      expect(decls, `${cssVarName(key)} in ${theme}`).toContain(`${cssVarName(key)}: ${p[key].toLowerCase()};`);
    }
  });
});

/** Rough perceptual distance in sRGB (redmean). Enough to catch two roles collapsing into one hue. */
function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = [1, 3, 5].map((i) => Number.parseInt(a.slice(i, i + 2), 16)) as [number, number, number];
  const [r2, g2, b2] = [1, 3, 5].map((i) => Number.parseInt(b.slice(i, i + 2), 16)) as [number, number, number];
  const rm = (r1 + r2) / 2;
  return Math.sqrt((2 + rm / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - rm) / 256) * (b1 - b2) ** 2);
}

describe.each(THEMES)("%s semantic roles stay distinct", (theme) => {
  const p = palette[theme];
  const roles = ["accent", "bid", "ask", "warn", "halt"] as const;

  it.each(roles.flatMap((a, i) => roles.slice(i + 1).map((b) => [a, b] as const)))("%s and %s are told apart", (a, b) => {
    expect(colorDistance(p[a], p[b]), `${a} vs ${b}`).toBeGreaterThan(60);
  });
});

describe.each(THEMES)("%s terrain scene", (theme) => {
  const t = terrainScene[theme];

  it("fogs into the page canvas, so the terrain has no visible edge", () => {
    expect(t.fog.toLowerCase()).toBe(palette[theme].bg.toLowerCase());
  });

  it("draws STRATA depth and the book sides in the palette colors", () => {
    expect(t.strata).toBe(palette[theme].accent);
    expect(t.bid).toBe(palette[theme].bid);
    expect(t.ask).toBe(palette[theme].ask);
    expect(t.fault).toBe(palette[theme].halt);
  });

  it("keeps contour lines readable against the fog", () => {
    expect(contrastRatio(t.contour, t.fog)).toBeGreaterThanOrEqual(AA_BODY);
  });
});
