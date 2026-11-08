/**
 * Renders the still poster for the survey terrain from the real WebGL scene, so the image a
 * visitor sees before (or instead of) WebGL is the same drawing, not a separate illustration.
 *
 *   pnpm --filter @strata/web exec node scripts/capture-poster.mjs http://localhost:3000
 *
 * Needs a running app (dev or start). Writes public/survey/terrain-{dark,light}.{avif,webp}
 * through ImageMagick (`magick` on PATH). The poster is captioned "Still image, not live data"
 * on the page, so it does not need to match today's depth.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";

const base = process.argv[2];
if (!base) {
  console.error("usage: node scripts/capture-poster.mjs <app origin>");
  process.exit(2);
}
const out = path.join(import.meta.dirname, "..", "public", "survey");
mkdirSync(out, { recursive: true });
const work = mkdtempSync(path.join(tmpdir(), "strata-poster-"));

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  for (const theme of ["dark", "light"]) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    await page.addInitScript((t) => localStorage.setItem("strata-theme", t), theme);
    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    await page.mouse.move(800, 500);
    await page.waitForSelector(".survey-stage[data-live]", { timeout: 60_000 });
    // Let heights ease to their targets, then hide everything but the terrain itself.
    await page.waitForTimeout(6000);
    await page.addStyleTag({
      content: ".survey-stage ~ *, .survey-labels, .survey-stage::after, nextjs-portal { visibility: hidden !important; } .survey-stage::after { display: none !important; }",
    });
    await page.waitForTimeout(300);
    const png = path.join(work, `terrain-${theme}.png`);
    await page.locator(".survey-stage").screenshot({ path: png });
    execFileSync("magick", [png, "-quality", "72", path.join(out, `terrain-${theme}.webp`)]);
    execFileSync("magick", [png, "-quality", "50", path.join(out, `terrain-${theme}.avif`)]);
    await page.close();
    console.log(`poster ${theme} written`);
  }
} finally {
  await browser.close();
  rmSync(work, { recursive: true, force: true });
}
