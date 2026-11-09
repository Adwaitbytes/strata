/**
 * Captures 2x stills (3840x2160 PNG) of the live STRATA site for the film, plus boxes.json with the
 * CSS-pixel boxes of the key elements in each frame (getBoundingClientRect, viewport-relative).
 *
 *   node film/capture/stills.mjs            # all captures
 *   node film/capture/stills.mjs arena join # only captures whose id starts with one of the args
 *
 * Read-only: no wallet is connected. Join steps 2 to 4 use a stub EIP-1193 provider that exposes a
 * public operator address and rejects every signing method, so nothing can be signed or sent.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { chromium } from "../../apps/web/node_modules/@playwright/test/index.mjs";

const SITE = "https://strata-web-ochre.vercel.app";
const OUT = path.join(import.meta.dirname, "..", "assets", "screens");
const BOXES = path.join(OUT, "boxes.json");
const HEADER_PX = 57;
// Testnet ETH/USDC PERP, packages/config/src/generated/markets.testnet.json (arenaEnabled).
const ETH_TESTNET = "0x135de28700392fb1c17d40d5170a74f30055a4ad522feddafec42fbbbb780897";
// Agent 1 (strata-test-1) operator and its ERC-8004 identity 69, from Neon `agents` (public values).
const STUB_ADDRESS = "0xa37f84583f356ecead212471b49944b35469ed8a";
const STUB_IDENTITY = "69";
const TESTNET_RPC = "https://k8s.testnet.json-rpc.injective.network/";

const only = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const boxes = existsSync(BOXES) ? JSON.parse(readFileSync(BOXES, "utf8")) : { captures: {} };
boxes.meta = {
  site: SITE,
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 2,
  imageSize: { width: 3840, height: 2160 },
  units: "CSS px relative to the viewport at capture time; multiply by 2 for image pixels",
  method: "Element.getBoundingClientRect() in Chromium (Playwright 1.65, Metal ANGLE)",
};

const browser = await chromium.launch({
  channel: "chromium",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--hide-scrollbars"],
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newPage(theme, { stubWallet = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
    colorScheme: theme,
    reducedMotion: "no-preference",
  });
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem("strata-theme", t);
    } catch {}
  }, theme);
  if (stubWallet) await ctx.addInitScript(installStubWallet, { address: STUB_ADDRESS, rpc: TESTNET_RPC });
  const page = await ctx.newPage();
  return { ctx, page };
}

/** Runs in the page. Read-only provider: accounts and chain id answer locally, reads go to the
 * public testnet RPC, and anything that would sign or send is rejected with EIP-1193 code 4001. */
function installStubWallet({ address, rpc }) {
  const SIGNING = /^(eth_sign|personal_sign|eth_signTypedData|eth_sendTransaction|eth_sendRawTransaction|wallet_sendCalls|eth_signTransaction)/;
  const listeners = {};
  const provider = {
    isMetaMask: false,
    request: async ({ method, params }) => {
      if (SIGNING.test(method)) throw Object.assign(new Error("Capture stub never signs"), { code: 4001 });
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [address];
      if (method === "eth_chainId") return "0x59f";
      if (method === "net_version") return "1439";
      if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
      if (method === "wallet_requestPermissions" || method === "wallet_getPermissions") return [{ parentCapability: "eth_accounts" }];
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params ?? [] }),
      });
      const body = await res.json();
      if (body.error) throw Object.assign(new Error(body.error.message), { code: body.error.code, data: body.error.data });
      return body.result;
    },
    on: (e, f) => ((listeners[e] ??= []).push(f), provider),
    removeListener: (e, f) => ((listeners[e] = (listeners[e] ?? []).filter((x) => x !== f)), provider),
  };
  window.ethereum = provider;
  const info = { uuid: "00000000-0000-4000-8000-000000000001", name: "Read-only capture stub", icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E", rdns: "film.strata.stub" };
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
}

/** Boxes for each named selector (all matches, capped), viewport-relative, with short text. */
async function measure(page, selectors) {
  return page.evaluate((sel) => {
    const out = {};
    for (const [name, css] of Object.entries(sel)) {
      const els = [...document.querySelectorAll(css)].slice(0, 24);
      const list = [];
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
        const text = (el.innerText ?? el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
        list.push({ x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, text });
      }
      if (list.length) out[name] = list;
    }
    return out;
  }, selectors);
}

const COMMON = { h1: "main h1", h2: "main h2", header: "header" };

async function shot(page, id, selectors, extra = {}) {
  const file = `${id}.png`;
  await page.screenshot({ path: path.join(OUT, file), animations: "allow" });
  const elements = await measure(page, { ...COMMON, ...selectors });
  const scrollY = await page.evaluate(() => Math.round(scrollY));
  boxes.captures[id] = { file, url: page.url(), capturedAt: new Date().toISOString(), scrollY, ...extra, elements };
  writeFileSync(BOXES, JSON.stringify(boxes, null, 1));
  console.log(`captured ${id} (${Object.keys(elements).length} element groups)`);
}

async function scrollToEl(page, css, mode = "top") {
  await page.evaluate(
    ({ css, mode, header }) => {
      const el = document.querySelector(css);
      if (!el) throw new Error(`missing ${css}`);
      const r = el.getBoundingClientRect();
      const top = r.top + scrollY;
      const y = mode === "center" ? top + r.height / 2 - innerHeight / 2 : top - header - 24;
      window.scrollTo({ top: Math.max(0, y), behavior: "instant" });
    },
    { css, mode, header: HEADER_PX },
  );
}

async function settle(page, ms = 1500) {
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  await sleep(ms);
}

async function goto(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await settle(page, 2500);
}

const LANDING_SEL = {
  headline: "#hero-title",
  heroLede: "section.hero p",
  heroCtas: "section.hero a",
  statStrip: "section.readout",
  statCells: "section.readout .readout-cell",
  statNumbers: "section.readout dd",
  statLabels: "section.readout dt",
  provenanceBadges: "section.readout .readout-head span",
  terrainCanvas: ".survey-stage canvas",
  terrainLabels: ".survey-labels > *",
  depthSurveyLegend: "[class*='survey-legend'], [class*='legend']",
  sceneTitle: "section.scene h2",
  sceneLede: "section.scene p",
  sceneFigure: "section.scene svg, section.scene figure, section.scene [data-figure]",
  terrainCaption: "section.scene [class*='terrain'], section.scene figcaption",
  ecosystem: "section.ecosystem",
};

async function captureLanding(theme) {
  const { ctx, page } = await newPage(theme);
  await goto(page, `${SITE}/`);
  await page.mouse.move(960, 540);
  await page.waitForSelector(".survey-stage[data-live]", { timeout: 60_000 });
  // Heights ease to their targets after the data arrives.
  await sleep(7000);
  const suffix = theme === "dark" ? "" : "-light";
  await shot(page, `landing-hero${suffix}`, LANDING_SEL, { theme });
  if (theme === "light") {
    await ctx.close();
    return;
  }
  const scenes = await page.evaluate(() =>
    [...document.querySelectorAll("main section")].map((s, i) => ({ i, id: s.id, cls: s.className, aria: s.getAttribute("aria-label") ?? "" })),
  );
  boxes.landingSections = scenes;
  for (const s of scenes) {
    if (s.cls.includes("hero")) continue;
    const css = s.id ? `#${s.id}` : `main section:nth-of-type(${s.i + 1})`;
    const name = s.id || s.cls.split(" ")[0] || `section-${s.i}`;
    try {
      await page.evaluate((i) => {
        const el = document.querySelectorAll("main section")[i];
        const r = el.getBoundingClientRect();
        const top = r.top + scrollY;
        const y = r.height > innerHeight ? top + r.height / 2 - innerHeight / 2 : top - 140;
        window.scrollTo({ top: Math.max(0, y), behavior: "instant" });
      }, s.i);
      await sleep(2600);
      await shot(page, `landing-${name}`, LANDING_SEL, { theme, section: css });
    } catch (e) {
      console.error(`landing ${name}: ${e.message}`);
    }
  }
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
  await sleep(2000);
  await shot(page, "landing-footer", { ...LANDING_SEL, footer: "footer" }, { theme });
  await ctx.close();
}

const ARENA_SEL = {
  leaderboardCard: "[data-testid=leaderboard-card]",
  leaderboardRows: "[data-testid=leaderboard-row]",
  rowCount: "[data-testid=row-count]",
  marketCards: "[data-testid=market-card]",
  leaderboardTitle: "#leaderboard-title",
  marketsTitle: "#markets-title",
  liveIndicator: "[class*='live'], [aria-live]",
  badges: "main [class*='badge'], main .num.uppercase",
  pageHeader: "main header, main h1",
};

async function captureArena(theme) {
  const { ctx, page } = await newPage(theme);
  await goto(page, `${SITE}/arena?network=testnet`);
  await page.waitForSelector("[data-testid=leaderboard-row]", { timeout: 30_000 }).catch(() => console.error("arena: no leaderboard rows"));
  await sleep(3000);
  const suffix = theme === "dark" ? "" : "-light";
  await shot(page, `arena${suffix}`, ARENA_SEL, { theme });
  if (theme === "dark") {
    await scrollToEl(page, "#markets-title");
    await sleep(1500);
    await shot(page, "arena-markets", ARENA_SEL, { theme });
  }
  await ctx.close();
}

const AGENT_SEL = {
  focal: "[data-testid=agent-focal]",
  metrics: "[aria-label='Metrics, latest epoch']",
  metricValues: "[aria-label='Metrics, latest epoch'] dd, [aria-label='Metrics, latest epoch'] .num",
  scoreHistory: "#history",
  quotes: "#quotes",
  quoteLadder: "[aria-label='Live quotes by level']",
  verify: "#verify",
  verifyButton: "#verify button",
  verifyLocal: "[data-testid=verify-local]",
  verifyOnchain: "[data-testid=verify-onchain]",
  guardTimeline: "#guards",
  guardRows: "#guards li, #guards tr",
  tunerFeed: "#tuner",
  tunerRows: "#tuner li, #tuner article, #tuner tr",
  identity: "#identity",
  badges: "main .num.uppercase",
};

async function captureAgent() {
  const { ctx, page } = await newPage("dark");
  await goto(page, `${SITE}/agents/1?network=testnet`);
  await page.waitForSelector("[data-testid=agent-focal]", { timeout: 30_000 }).catch(() => console.error("agent: no focal"));
  await sleep(2500);
  await shot(page, "agent-1", AGENT_SEL, { theme: "dark" });
  for (const id of ["history", "quotes", "guards", "tuner", "identity"]) {
    try {
      await scrollToEl(page, `#${id}`);
      await sleep(1500);
      await shot(page, `agent-1-${id}`, AGENT_SEL, { theme: "dark" });
    } catch (e) {
      console.error(`agent ${id}: ${e.message}`);
    }
  }
  await scrollToEl(page, "#verify");
  await sleep(1200);
  await shot(page, "agent-1-verify-before", AGENT_SEL, { theme: "dark" });
  const btn = page.locator("#verify button", { hasText: "Verify my score" });
  await btn.click();
  await page
    .waitForFunction(
      () => {
        const t = document.querySelector("[data-testid=verify-onchain]")?.textContent ?? "";
        return /pass|fail|match|confirm|error|unavailable/i.test(t) && !document.querySelector("#verify .animate-spin");
      },
      null,
      { timeout: 45_000 },
    )
    .catch(() => console.error("verify: no result within 45 s"));
  await sleep(800);
  await shot(page, "agent-1-verify-result", AGENT_SEL, { theme: "dark" });
  await ctx.close();
}

const MARKET_SEL = {
  metrics: "[aria-label='Market metrics']",
  metricValues: "[aria-label='Market metrics'] dd, [aria-label='Market metrics'] .num",
  spreadChart: "#spread",
  ladder: "#ladder",
  depthContour: "[aria-labelledby=depth-contour-desc]",
  share: "#share",
  session: "#session",
  legendStrata: "[data-testid=legend-strata]",
  legendNoStrata: "[data-testid=legend-no-strata]",
  badges: "main .num.uppercase",
};

async function captureMarket() {
  const { ctx, page } = await newPage("dark");
  await goto(page, `${SITE}/markets/${ETH_TESTNET}?network=testnet`);
  await sleep(3000);
  await shot(page, "market-eth", MARKET_SEL, { theme: "dark", market: "ETH/USDC PERP (testnet)" });
  for (const id of ["spread", "ladder", "share", "session"]) {
    try {
      await scrollToEl(page, `#${id}`);
      await sleep(1500);
      await shot(page, `market-eth-${id}`, MARKET_SEL, { theme: "dark", market: "ETH/USDC PERP (testnet)" });
    } catch (e) {
      console.error(`market ${id}: ${e.message}`);
    }
  }
  await ctx.close();
}

const TRANSPARENCY_SEL = {
  contracts: "#contracts",
  contractRows: "#contracts tr, #contracts li",
  limits: "#limits",
  halts: "#halts",
  suspensions: "#suspensions",
  epochs: "#epochs",
  epochRows: "#epochs tr, #epochs li",
  security: "#security",
  badges: "main .num.uppercase",
};

async function capturePaged(id, url, selectors, sections) {
  const { ctx, page } = await newPage("dark");
  await goto(page, url);
  await sleep(2500);
  await shot(page, id, selectors, { theme: "dark" });
  for (const s of sections) {
    try {
      await scrollToEl(page, `#${s}`);
      await sleep(1300);
      await shot(page, `${id}-${s}`, selectors, { theme: "dark" });
    } catch (e) {
      console.error(`${id} ${s}: ${e.message}`);
    }
  }
  await ctx.close();
}

const STATUS_SEL = {
  freshness: "[aria-label='Data freshness']",
  freshnessValues: "[aria-label='Data freshness'] dd, [aria-label='Data freshness'] .num",
  services: "#services",
  serviceRows: "[data-testid=service-row]",
  badges: "main .num.uppercase",
};

const DOCS_SEL = {
  article: "article",
  articleH1: "article h1",
  articleH2: "article h2",
  formulas: "article pre, article code, article .katex-display, article table",
  sidebar: "nav, aside",
};

const JOIN_SEL = {
  stepper: "[aria-label='Enrollment steps']",
  stepperItems: "[aria-label='Enrollment steps'] li",
  stepHeading: "[data-testid=step-heading]",
  connectedAddress: "[data-testid=connected-address]",
  disabledReason: "[data-testid=disabled-reason]",
  buttons: "main button",
  inputs: "main input, main select",
  rules: "[aria-labelledby=rules-title]",
  kit: "[aria-labelledby=kit-title]",
  txPreview: "[data-testid=tx-preview]",
  networkNotice: "main [role=alert], main [role=note]",
};

async function captureJoin() {
  // Step 1 as a visitor sees it: no wallet anywhere.
  {
    const { ctx, page } = await newPage("dark");
    await goto(page, `${SITE}/join`);
    await sleep(1500);
    await shot(page, "join-step1", JOIN_SEL, { theme: "dark", wallet: "none" });
    await ctx.close();
  }
  // Steps 1 (connected) to 4 with the read-only stub provider.
  const { ctx, page } = await newPage("dark", { stubWallet: true });
  await goto(page, `${SITE}/join`);
  await sleep(1500);
  // wagmi reconnects on load when the provider already lists an account, so connect only if needed.
  if (!(await page.locator("[data-testid=connected-address]").count())) {
    await page.getByRole("button", { name: /^Connect/ }).first().click({ timeout: 15_000 });
  }
  await page.waitForSelector("[data-testid=connected-address]", { timeout: 20_000 });
  await sleep(1200);
  await shot(page, "join-step1-connected", JOIN_SEL, { theme: "dark", wallet: "read-only stub, public operator address of agent 1, signing rejected" });
  await page.locator("main button", { hasText: "Continue" }).click();
  await sleep(1200);
  const idInput = page.locator("main input").first();
  await idInput.fill(STUB_IDENTITY);
  await sleep(800);
  await shot(page, "join-step2", JOIN_SEL, { theme: "dark", identity: STUB_IDENTITY });
  await page.locator("main button", { hasText: "Continue" }).click();
  await sleep(1500);
  await shot(page, "join-step3", JOIN_SEL, { theme: "dark" });
  // Fill the rules step: a name, the first market, and both acknowledgements, if present.
  const step3 = await page.evaluate(() => [...document.querySelectorAll("main input, main select, main button")].map((e) => ({ tag: e.tagName, type: e.getAttribute("type"), name: e.getAttribute("name") ?? e.getAttribute("id") ?? "", label: (e.labels?.[0]?.innerText ?? e.innerText ?? "").trim().slice(0, 60) })));
  console.log("step3 controls", JSON.stringify(step3));
  await page.getByLabel("Agent name").fill("my-agent");
  await page.getByRole("checkbox", { name: /^ETH\/USDC PERP/ }).check();
  await page.getByRole("checkbox", { name: /risk disclosure/ }).check();
  await page.getByRole("checkbox", { name: /not a US person/ }).check();
  await sleep(1000);
  await shot(page, "join-step3-filled", JOIN_SEL, { theme: "dark" });
  const review = page.getByRole("button", { name: "Review enrollment" });
  if (await review.isEnabled()) {
    await review.click();
    await sleep(5000);
    await shot(page, "join-step4", JOIN_SEL, { theme: "dark", note: "transaction preview only; nothing signed or sent" });
    await scrollToEl(page, "[data-testid=tx-preview]").catch(() => {});
    await sleep(1000);
    await shot(page, "join-step4-preview", JOIN_SEL, { theme: "dark", note: "transaction preview only; nothing signed or sent" });
  } else {
    console.error("join: Review enrollment stays disabled");
  }
  await ctx.close();
}

const jobs = [
  ["landing", () => captureLanding("dark")],
  ["landing-light", () => captureLanding("light")],
  ["arena", () => captureArena("dark")],
  ["arena-light", () => captureArena("light")],
  ["agent", captureAgent],
  ["market", captureMarket],
  ["transparency", () => capturePaged("transparency", `${SITE}/transparency?network=testnet`, TRANSPARENCY_SEL, ["contracts", "limits", "halts", "epochs", "security"])],
  ["status", () => capturePaged("status", `${SITE}/status?network=testnet`, STATUS_SEL, ["services"])],
  ["docs", () => capturePaged("docs-scoring", `${SITE}/docs/scoring`, DOCS_SEL, [])],
  ["join", captureJoin],
];

let failures = 0;
for (const [id, run] of jobs) {
  if (only.length && !only.some((o) => id.startsWith(o))) continue;
  try {
    await run();
  } catch (e) {
    failures++;
    console.error(`FAILED ${id}: ${e.message}`);
  }
}
await browser.close();
process.exit(failures ? 1 : 0);
