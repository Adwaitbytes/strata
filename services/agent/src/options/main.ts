/**
 * Options-writer entrypoint (PRD 9.8), SIMULATED. No keys are loaded and no transaction is ever
 * built: there is no public options writer interface (docs/OPTIONS.md, decision D9). Underlying
 * prices are read-only queries of the mainnet chain oracle through the official endpoint list.
 *
 *   STRATA_NETWORK=testnet DATABASE_URL_FILE=../../.secrets/neon_url node dist/options/main.js
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { getInjectiveAddress } from "@injectivelabs/sdk-ts";
import { getMarkets } from "@strata/config";
import { DEFAULT_PARAMS, type RiskParams } from "@strata/risk";
import { HeartbeatWriter, KillCommandPoller } from "../core/control.js";
import { KillSwitch, installShutdownHandlers, killFromEnv } from "../core/killSwitch.js";
import {
  DrizzleAgentStateStore,
  DrizzleHeartbeatSink,
  DrizzleKillCommandFeed,
  StatePersister,
  persistable,
  riskStateFrom,
} from "../core/persistence.js";
import { BufferedRecorder, DrizzleWriter } from "../core/recorder.js";
import { getEndpointSet, withFailover } from "../injective/endpoints.js";
import { readOracle } from "../injective/oracle.js";
import { OptionsBook } from "./book.js";
import { loadOptionsConfig, resolveUnderlyings, runnerParams } from "./config.js";
import { OptionsRunner, type PriceSource } from "./runner.js";
import { DrizzleOptionsStore } from "./store.js";

type Fields = Record<string, string | number | boolean | null>;
function log(level: "info" | "warn" | "error", msg: string, fields: Fields = {}): void {
  process.stdout.write(`${JSON.stringify({ level, msg, provenance: "SIMULATED", ...fields, at: new Date().toISOString() })}\n`);
}
const errMsg = (err: unknown): string => (err instanceof Error ? err.message : "unknown");

function databaseUrl(env: NodeJS.ProcessEnv): string {
  const direct = env["DATABASE_URL"]?.trim();
  if (direct) return direct;
  const file = env["DATABASE_URL_FILE"]?.trim();
  const url = file ? readFileSync(file, "utf8").trim() : "";
  if (url === "") throw new Error("the options agent records every quote; set DATABASE_URL or DATABASE_URL_FILE");
  return url;
}

async function main(): Promise<void> {
  if ((process.env["STRATA_NETWORK"] ?? "testnet") !== "testnet") throw new Error("the options agent runs on testnet only");
  const cfgPath = process.env["OPTIONS_CONFIG"] ?? fileURLToPath(new URL("../../config/options/strata-options.json", import.meta.url));
  const cfg = loadOptionsConfig(cfgPath);
  const resolved = resolveUnderlyings(cfg, getMarkets("mainnet"));
  const identity = { agentId: cfg.agentId, agentName: cfg.name, network: cfg.network, provenance: "SIMULATED" as const };

  const sql = postgres(databaseUrl(process.env), { max: 3 });
  const db = drizzle(sql);
  const store = new DrizzleOptionsStore(db);
  await store.ensureAgentRow({ network: cfg.network, agentId: cfg.agentId, name: cfg.name, operator: cfg.operator, injAddress: getInjectiveAddress(cfg.operator), enrolledAt: Date.now() });

  const stateStore = new DrizzleAgentStateStore(db);
  const saved = await stateStore.load(cfg.network, cfg.agentId);
  const positions = await store.loadPositions(cfg.network, cfg.agentId);
  const book = OptionsBook.restore({ cashUsd: cfg.startingCashUsd, callCapMultiple: cfg.strategy.callCapMultiple }, positions);
  log("info", "options book restored", { positions: positions.length, open: book.open().length, cashUsd: book.totalCashUsd(), killed: saved?.kill.killed ?? false });

  const recorder = new BufferedRecorder({ writer: new DrizzleWriter(db, { orders: false, fills: false }), onError: (err) => log("warn", "guard event write failed", { error: errMsg(err) }) });
  recorder.start();
  const killSwitch = new KillSwitch(identity, saved?.kill ?? null);
  const envKill = killFromEnv(process.env, Date.now());
  if (envKill !== null) killSwitch.trigger(envKill);

  const riskParams: RiskParams = { ...DEFAULT_PARAMS, ...cfg.risk };
  const now = (): number => Date.now();
  const ids = (): string => randomUUID();
  const mainnetEndpoints = getEndpointSet("mainnet");
  const oracleByUnderlying = new Map(resolved.map((r) => [r.spec.underlying, r.oracle]));
  const prices: PriceSource = {
    read: async (spec) => {
      const ref = oracleByUnderlying.get(spec.underlying);
      if (ref === undefined) throw new Error(`no oracle for ${spec.underlying}`);
      const r = await withFailover(mainnetEndpoints, (e) => readOracle(e.grpc, ref));
      return { price: Number(r.price), timestampMs: r.timestampMs, source: `mainnet:${r.source}` };
    },
  };

  let runner: OptionsRunner | null = null;
  const persister = new StatePersister(stateStore, cfg.network, cfg.agentId, now, (err) => log("error", "failed to persist safety state", { error: errMsg(err) }), saved);
  const persist = (): void => {
    if (runner !== null) persister.update(persistable(runner.riskState, killSwitch.state));
  };
  runner = new OptionsRunner({
    identity,
    specs: resolved.map((r) => r.spec),
    prices,
    store,
    sink: recorder,
    killSwitch,
    book,
    params: runnerParams(cfg),
    riskParams,
    initialRisk: saved === null ? null : riskStateFrom(saved),
    now,
    ids,
    onRiskChange: persist,
  });
  killSwitch.onKill(persist);
  persist();

  const poller = new KillCommandPoller({ feed: new DrizzleKillCommandFeed(db), killSwitch, identity, sink: recorder, now, ids, intervalMs: 5_000 });
  poller.start((err) => log("warn", "kill command poll failed", { error: errMsg(err) }));
  const heartbeat = new HeartbeatWriter({
    sink: new DrizzleHeartbeatSink(db),
    network: cfg.network,
    agentId: cfg.agentId,
    now,
    intervalMs: 15_000,
    detail: () => ({
      agent: cfg.name,
      kind: "options_writer",
      provenance: "SIMULATED",
      simulated: true,
      underlyings: resolved.map((r) => r.ticker),
      priceSource: "mainnet chain oracle (read-only)",
      killed: killSwitch.state.killed,
      stoppedForDay: runner?.riskState.stoppedForDay ?? false,
      stoppedForSeason: runner?.riskState.stoppedForSeason ?? false,
      openPositions: book.open().length,
      lockedCollateralUsd: book.lockedCollateralUsd(),
      // Not "capitalUsd": the Transparency page lists that as real house capital, and this USDC is simulated.
      simulatedCapitalUsd: cfg.startingCashUsd,
    }),
  });
  heartbeat.start((err) => log("warn", "heartbeat write failed", { error: errMsg(err) }));

  let stopping = false;
  let cycleNo = 0;
  let wake: (() => void) | null = null;
  const loop = (async () => {
    while (!stopping) {
      const quote = cycleNo % cfg.quoteEveryCycles === 0;
      try {
        const r = await runner.cycle({ quote });
        const vols = Object.fromEntries(resolved.map((x) => [`vol_${x.spec.underlying}`, Number((runner?.realizedVol(x.spec.underlying) ?? -1).toFixed(4))]));
        log("info", "cycle", { cycle: cycleNo, quote, written: r.written, settled: r.settled, closed: r.closed, prices: r.pricesRead, equityUsd: Number(r.equity.toFixed(2)), open: book.open().length, ...vols });
      } catch (err) {
        log("error", "cycle failed", { cycle: cycleNo, error: errMsg(err) });
      }
      cycleNo++;
      if (stopping) break;
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, cfg.cycleMs);
        wake = () => {
          clearTimeout(t);
          resolve();
        };
      });
    }
  })();

  installShutdownHandlers(
    process,
    async () => {
      stopping = true;
      wake?.();
      await loop;
      poller.stop();
      heartbeat.stop();
      await persister.flush();
      await recorder.stop();
      await sql.end({ timeout: 5 });
      log("info", "options agent stopped");
    },
    (code) => process.exit(code),
  );
  log("info", "options agent started", { agentId: cfg.agentId, underlyings: resolved.length, cycleMs: cfg.cycleMs });
}

main().catch((err: unknown) => {
  log("error", "options agent failed to start", { error: errMsg(err) });
  process.exit(1);
});
