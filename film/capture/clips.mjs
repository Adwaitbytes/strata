/**
 * Records 1920x1080 clips of the live site with Playwright recordVideo, then trims and re-encodes
 * each one to H.264 30 fps MP4 with ffmpeg (constant frame rate, yuv420p, faststart).
 *
 *   node film/capture/clips.mjs [hero|scroll|arena ...]
 *
 * The raw .webm files stay in film/assets/clips/ (gitignored); the MP4s are the deliverables.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { chromium } from "../../apps/web/node_modules/@playwright/test/index.mjs";

const SITE = "https://strata-web-ochre.vercel.app";
const OUT = path.join(import.meta.dirname, "..", "assets", "clips");
const META = path.join(OUT, "clips.json");
const only = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const meta = existsSync(META) ? JSON.parse(readFileSync(META, "utf8")) : { clips: {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  channel: "chromium",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--hide-scrollbars"],
});

/** Opens a recording context; returns the page and the wall-clock time recording started. */
async function recordingPage(theme = "dark") {
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: theme,
    recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } },
  });
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem("strata-theme", t);
    } catch {}
  }, theme);
  const startedAt = Date.now();
  const page = await ctx.newPage();
  return { ctx, page, startedAt };
}

function encode(webm, mp4, startSec, durationSec) {
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error",
    "-ss", startSec.toFixed(3), "-i", webm, "-t", String(durationSec),
    "-vf", "fps=30,scale=1920:1080:flags=lanczos,format=yuv420p",
    "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-profile:v", "high", "-movflags", "+faststart", "-an",
    mp4,
  ]);
}

async function finish(id, ctx, page, startedAt, windowStart, durationSec, extra) {
  const video = page.video();
  await ctx.close();
  const webm = path.join(OUT, `${id}.webm`);
  rmSync(webm, { force: true });
  renameSync(await video.path(), webm);
  const mp4 = path.join(OUT, `${id}.mp4`);
  const offset = (windowStart - startedAt) / 1000;
  encode(webm, mp4, offset, durationSec);
  const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height,r_frame_rate,codec_name,nb_frames:format=duration,size", "-of", "json", mp4]).toString());
  meta.clips[id] = { file: `${id}.mp4`, raw: `${id}.webm`, recordedAt: new Date(windowStart).toISOString(), trimOffsetSec: offset, ...extra, probe };
  writeFileSync(META, JSON.stringify(meta, null, 1));
  console.log(`${id}: ${probe.format.duration}s, ${(Number(probe.format.size) / 1e6).toFixed(1)} MB`);
}

async function heroIdle() {
  const { ctx, page, startedAt } = await recordingPage();
  await page.goto(`${SITE}/`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.mouse.move(960, 540);
  await page.waitForSelector(".survey-stage[data-live]", { timeout: 60_000 });
  await sleep(7000);
  const windowStart = Date.now();
  await sleep(10_800);
  await finish("hero-terrain-idle", ctx, page, startedAt, windowStart, 10, { url: `${SITE}/`, what: "Live 3D hero terrain, idle, no input" });
}

async function scrollStory() {
  const { ctx, page, startedAt } = await recordingPage();
  await page.goto(`${SITE}/`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.mouse.move(960, 540);
  await page.waitForSelector(".survey-stage[data-live]", { timeout: 60_000 });
  await sleep(6000);
  const durationMs = 30_000;
  const windowStart = Date.now();
  // Linear scroll driven by requestAnimationFrame: constant speed from the top to the bottom.
  const total = await page.evaluate(
    (ms) =>
      new Promise((resolve) => {
        const max = document.documentElement.scrollHeight - innerHeight;
        const t0 = performance.now();
        const step = (now) => {
          const k = Math.min(1, (now - t0) / ms);
          window.scrollTo(0, Math.round(max * k));
          if (k < 1) requestAnimationFrame(step);
          else resolve(max);
        };
        requestAnimationFrame(step);
      }),
    durationMs,
  );
  await sleep(600);
  await finish("landing-scroll-story", ctx, page, startedAt, windowStart, 30, { url: `${SITE}/`, what: `Constant-speed scroll from top to bottom (${total} CSS px in 30 s)` });
}

async function arena() {
  const { ctx, page, startedAt } = await recordingPage();
  await page.goto(`${SITE}/arena?network=testnet`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForSelector("[data-testid=leaderboard-row]", { timeout: 30_000 }).catch(() => {});
  await sleep(3000);
  const windowStart = Date.now();
  await sleep(10_800);
  await finish("arena-live", ctx, page, startedAt, windowStart, 10, { url: `${SITE}/arena?network=testnet`, what: "Arena leaderboard on testnet with the live stream connected" });
}

const jobs = { hero: heroIdle, scroll: scrollStory, arena };
for (const [id, run] of Object.entries(jobs)) {
  if (only.length && !only.includes(id)) continue;
  try {
    await run();
  } catch (e) {
    console.error(`FAILED ${id}: ${e.message}`);
  }
}
await browser.close();
