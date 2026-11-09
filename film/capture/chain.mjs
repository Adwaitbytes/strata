/**
 * Captures 2x stills (3840x2160 PNG) of the public chain pages the film cites: Blockscout (epoch
 * attestation tx, StrataArena and ScoreAttestor verified source), Sourcify, and the Injective testnet
 * explorer (house agent accounts, the kill-switch cancel-all tx). Read-only page views.
 *
 *   node film/capture/chain.mjs [id-prefix ...]
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { chromium } from "../../apps/web/node_modules/@playwright/test/index.mjs";

const OUT = path.join(import.meta.dirname, "..", "assets", "screens", "chain");
const BOXES = path.join(OUT, "boxes.json");
const BS = "https://testnet.blockscout.injective.network";
// testnet.explorer.injective.network now redirects to injscan and drops the path, so link injscan directly.
const EXP = "https://testnet.injscan.com";
// Testnet deployment, packages/config/src/networks.ts (testnet contracts).
const ARENA = "0x2046D580f7c710bEE8C8eFE46CB34ccFD1B40870";
const ATTESTOR = "0xfb73da045cDc792dCb9f8Dcdc300aeE348bff4DF";
// Season 1 epoch 0 postEpoch tx, Neon `epochs` and docs/STATUS.md "First attestation".
const EPOCH_TX = "0xc7133de93833b909c81a1a51aa452ff58d96c46f5c8011b1e23d79db205d9d0a";
// Sample quoting batch (MsgBatchUpdateOrdersV2) from strata-test-1, docs/STATUS.md "Live evidence".
const BATCH_TX = "8D5858CA815FB5DBCB10E172AE3C8BBD640CCB685319E7D0A19D4AB60636B657";
// First cancel-all after the signed API kill, docs/STATUS.md "Kill switch test" step 1.
const KILL_CANCEL_TX = "BA464D0D0445189D230D21D166A9029F79D3F6ABFF2C7731A54AB35C0892D925";
const AGENTS = {
  "strata-test-1": "inj15dlcgkplx4hvatfpy3cmfx2ykd2xnmv28q3pdh",
  "strata-test-2": "inj1fn53nvva0t7qayhvpef0qk4thae79zsnrekrev",
  "strata-test-3": "inj1wxtyzazhp85x0wc2erge29dmey4ns47kghnt5t",
};

const only = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const boxes = existsSync(BOXES) ? JSON.parse(readFileSync(BOXES, "utf8")) : { captures: {} };
boxes.meta = { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, units: "CSS px, viewport-relative" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ channel: "chromium", args: ["--use-angle=metal", "--hide-scrollbars"] });

/** Declines optional cookies where a banner offers it; otherwise picks the most restrictive choice. */
async function handleCookies(page) {
  const order = [/^(reject all|decline all|decline|reject|deny|necessary only|only necessary|essential only|refuse)/i, /^(accept necessary|use necessary)/i, /^(ok|got it|close)$/i];
  for (const re of order) {
    const btn = page.getByRole("button", { name: re }).first();
    if (await btn.isVisible().catch(() => false)) {
      const label = (await btn.innerText().catch(() => "")).trim();
      await btn.click().catch(() => {});
      await sleep(600);
      return label;
    }
  }
  return null;
}

async function measure(page, selectors) {
  return page.evaluate((sel) => {
    const out = {};
    for (const [name, css] of Object.entries(sel)) {
      const list = [];
      for (const el of [...document.querySelectorAll(css)].slice(0, 30)) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) continue;
        list.push({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), text: (el.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 160) });
      }
      if (list.length) out[name] = list;
    }
    return out;
  }, selectors);
}

/** Boxes of the elements whose own text contains each needle (smallest matching element). */
async function findText(page, needles) {
  return page.evaluate((needles) => {
    const out = {};
    for (const [name, needle] of Object.entries(needles)) {
      const hits = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      for (let el = walker.nextNode(); el; el = walker.nextNode()) {
        const t = (el.innerText ?? "").trim();
        if (!t || !t.toLowerCase().includes(needle.toLowerCase())) continue;
        if ([...el.children].some((c) => (c.innerText ?? "").toLowerCase().includes(needle.toLowerCase()))) continue;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) continue;
        hits.push({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), text: t.replace(/\s+/g, " ").slice(0, 160) });
        if (hits.length >= 6) break;
      }
      if (hits.length) out[name] = hits;
    }
    return out;
  }, needles);
}

async function capture(id, url, { needles = {}, selectors = {}, before } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, colorScheme: "dark" });
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForLoadState("networkidle", { timeout: 25_000 }).catch(() => {});
    await sleep(3500);
    const cookie = await handleCookies(page);
    if (before) await before(page);
    await sleep(1200);
    await page.screenshot({ path: path.join(OUT, `${id}.png`) });
    const elements = { ...(await measure(page, { h1: "h1", h2: "h2", ...selectors })), ...(await findText(page, needles)) };
    boxes.captures[id] = { file: `${id}.png`, url: page.url(), requestedUrl: url, capturedAt: new Date().toISOString(), cookieBanner: cookie ?? "none shown", elements };
    writeFileSync(BOXES, JSON.stringify(boxes, null, 1));
    console.log(`captured ${id} (cookie: ${cookie ?? "none"}) title="${await page.title()}"`);
  } catch (e) {
    console.error(`FAILED ${id}: ${e.message}`);
  } finally {
    await ctx.close();
  }
}

async function clickTab(page, re) {
  const tab = page.getByRole("tab", { name: re }).first();
  if (await tab.isVisible().catch(() => false)) {
    await tab.click();
    await sleep(2500);
    return true;
  }
  const link = page.locator("a, button", { hasText: re }).first();
  if (await link.isVisible().catch(() => false)) {
    await link.click();
    await sleep(2500);
    return true;
  }
  return false;
}

const jobs = [
  ["blockscout-epoch-tx", `${BS}/tx/${EPOCH_TX}`, { needles: { txHash: EPOCH_TX.slice(0, 18), status: "Success", block: "147660200", method: "postEpoch", to: "0xfb73", from: "0xdc83" } }],
  ["blockscout-epoch-tx-logs", `${BS}/tx/${EPOCH_TX}?tab=logs`, { needles: { root: "117a7ecdd28cf13e", event: "EpochPosted" } }],
  ["blockscout-arena-contract", `${BS}/address/${ARENA}?tab=contract`, { needles: { verified: "verified", name: "StrataArena", compiler: "Compiler", address: ARENA.slice(0, 12) } }],
  ["blockscout-arena-overview", `${BS}/address/${ARENA}`, { needles: { name: "StrataArena", address: ARENA.slice(0, 12) } }],
  ["blockscout-attestor-contract", `${BS}/address/${ATTESTOR}?tab=contract`, { needles: { verified: "verified", name: "ScoreAttestor", compiler: "Compiler", address: ATTESTOR.slice(0, 12) } }],
  ["sourcify-arena", `https://repo.sourcify.dev/1439/${ARENA}`, { needles: { match: "match", address: ARENA.slice(0, 12), chain: "1439" } }],
  ["explorer-kill-cancel-tx", `${EXP}/transaction/${KILL_CANCEL_TX}/`, { needles: { hash: KILL_CANCEL_TX.slice(0, 16), memo: "strata:cancel-all", status: "Success", block: "147,657,579", cancelAll: "derivative_market_ids_to_cancel_all" } }],
  ["explorer-batch-tx", `${EXP}/transaction/${BATCH_TX}/`, { needles: { hash: BATCH_TX.slice(0, 16), memo: "strata:batch", status: "Success", create: "derivative_orders_to_create" } }],
  ...Object.entries(AGENTS).flatMap(([name, addr]) => [
    [`explorer-${name}`, `${EXP}/account/${addr}/`, { needles: { address: addr.slice(0, 14), usdc: "USDC", inj: "INJ Balance" } }],
    [
      `explorer-${name}-txs`,
      `${EXP}/account/${addr}/`,
      {
        needles: { address: addr.slice(0, 14), batch: "Batch Update Orders", success: "Success" },
        before: async (page) => {
          if (!(await clickTab(page, /^transactions$/i))) console.error(`${name}: no transactions tab`);
        },
      },
    ],
  ]),
];

for (const [id, url, opts] of jobs) {
  if (only.length && !only.some((o) => id.startsWith(o))) continue;
  await capture(id, url, opts);
}
await browser.close();
