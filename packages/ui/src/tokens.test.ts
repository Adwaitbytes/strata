import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AA_BODY, AA_LARGE, contrastRatio } from "./contrast";
import { palette, TEXT_BACKGROUNDS, TEXT_ROLES, THEMES, type Palette } from "./tokens";

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
