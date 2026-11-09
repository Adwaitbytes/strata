/**
 * Agent entrypoint: one process per agent (PRD 9.1).
 *   STRATA_NETWORK=testnet AGENT_CONFIG=strata-test-1 AGENT_ID=<id> pnpm --filter @strata/agent start
 * Set STRATA_ADAPTER=sim for a local SIMULATED run with no network access.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { getMarkets, getNetwork } from "@strata/config";
import { LivenessWatchdog, watchdogConfigFromEnv } from "@strata/db";
import { DEFAULT_PARAMS, assertMainnetCaps, type RiskParams } from "@strata/risk";
import { AgentEnv, buildRiskParams, loadAgentConfig, resolveMarkets } from "./config.js";
import { HeartbeatWriter, KillCommandPoller, heartbeatDetail } from "./control.js";
import {
  DrizzleAgentStateStore,
  DrizzleHeartbeatSink,
  DrizzleKillCommandFeed,
  DrizzleNonceStore,
  MemoryAgentStateStore,
  StatePersister,
  persistable,
  riskStateFrom,
  type AgentStateStore,
} from "./persistence.js";
import { assertRunnable, buildSimMarkets, driveSim, loadInjectiveAdapter, provenanceFor, resolveConfigPath } from "./bootstrap.js";
import { MonotonicClock } from "./clock.js";
import type { ExchangeAdapter } from "./exchange.js";
import { KillSwitch, MemoryNonceStore, installFatalHandlers, installShutdownHandlers, killFromEnv, parseOwnerAddress } from "./killSwitch.js";
import { AgentRisk, AgentRunner, MarketQuoter, type AgentIdentity } from "./loop.js";
import { createControlServer, createMetrics } from "./metrics.js";
import { ParamStore } from "./paramStore.js";
import { BufferedRecorder, DrizzleWriter, type RecordWriter } from "./recorder.js";
import { createAnthropicTunerClient, readSecret, resolveTunerMode } from "./tuner.js";
import { TunerScheduler } from "./tunerScheduler.js";

type Fields = Record<string, string | number | boolean | null>;
function log(level: "info" | "warn" | "error", msg: string, fields: Fields = {}): void {
  process.stdout.write(`${JSON.stringify({ level, msg, ...fields, at: new Date().toISOString() })}\n`);
}

function readKillToken(path: string): string | null {
  try {
    const token = readFileSync(path, "utf8").trim();
    return token.length >= 32 ? token : null;
  } catch {
    return null;
  }
}

function databaseUrl(env: NodeJS.ProcessEnv): string | null {
  const direct = env["DATABASE_URL"]?.trim();
  if (direct) return direct;
  const file = env["DATABASE_URL_FILE"]?.trim();
  return file ? readFileSync(file, "utf8").trim() || null : null;
}

/** Replaced by the cancel-all shutdown path once the runner exists; until then nothing can rest on the book. */
let fail: (code: number) => void = (code) => process.exit(code);
installFatalHandlers(process, (code) => fail(code), (kind, err) =>
  log("error", `${kind}: cancelling all orders and exiting`, {
    error: err instanceof Error ? err.message : String(err),
    code: err instanceof Error && "code" in err ? String(err.code) : null,
    stack: err instanceof Error ? (err.stack ?? null) : null,
  }),
);

// Bounds the cancel-all when the database or RPC is dead, so the supervisor can restart us.
const SHUTDOWN_FORCE_EXIT_MS = 45_000;

async function main(): Promise<void> {
  const env = AgentEnv.parse(process.env);
  getNetwork(env.STRATA_NETWORK);
  const cfg = loadAgentConfig(resolveConfigPath(env.AGENT_CONFIG));
  const agentId = assertRunnable(cfg, env);
  // D6 hard cap on the agent-wide limits; per-market params are checked again in buildRiskParams.
  const agentParams: RiskParams = { ...DEFAULT_PARAMS, ...(cfg.params as Partial<RiskParams>) };
  assertMainnetCaps({ network: cfg.network, capitalUsd: cfg.capitalUsd, params: agentParams });
  const clock = new MonotonicClock();
  const identity: AgentIdentity = { agentId, agentName: cfg.name, network: cfg.network, provenance: provenanceFor(cfg.network, env.STRATA_ADAPTER) };

  let adapter: ExchangeAdapter;
  let resolved;
  let stopSim: () => void = () => undefined;
  if (env.STRATA_ADAPTER === "sim") {
    const built = buildSimMarkets(cfg, Date.now());
    adapter = built.sim;
    resolved = built.resolved;
    stopSim = driveSim(built.sim, resolved.map((r) => r.runtime.marketId));
  } else {
    resolved = resolveMarkets(cfg, getMarkets(cfg.network));
    adapter = await loadInjectiveAdapter({ network: cfg.network, agentName: cfg.name, markets: resolved.map((r) => r.market), secretsDir: env.STRATA_SECRETS_DIR ?? env.SECRETS_DIR });
  }

  const url = databaseUrl(process.env);
  if (url === null && cfg.network === "mainnet") throw new Error("mainnet requires a database so risk stops and kills persist (review H-2)");
  const sql = url === null ? null : postgres(url, { max: 4 });
  const db = sql === null ? null : drizzle(sql);
  // Without a database the events are discarded; the warning makes that explicit.
  const recordOrders = env.AGENT_RECORD_ORDERS === undefined ? env.STRATA_ADAPTER === "sim" : env.AGENT_RECORD_ORDERS === "true";
  const writer: RecordWriter = db === null ? { write: async () => undefined } : new DrizzleWriter(db, { orders: recordOrders, fills: recordOrders });
  if (db === null) log("warn", "No DATABASE_URL or DATABASE_URL_FILE; events, risk stops and kill latch are not persisted (local testnet only)");

  // Load persisted stops and kill latch before anything can quote (review H-2). A failed load exits.
  const stateStore: AgentStateStore = db === null ? new MemoryAgentStateStore() : new DrizzleAgentStateStore(db);
  const saved = await stateStore.load(cfg.network, agentId);
  if (saved !== null) log("info", "restored persisted safety state", { stoppedForDay: saved.risk.stoppedForDay, stoppedForSeason: saved.risk.stoppedForSeason, killed: saved.kill.killed });
  const recorder = new BufferedRecorder({ writer, onError: (err) => log("warn", "recorder write failed", { error: err instanceof Error ? err.message : "unknown" }) });
  recorder.start();

  const metrics = createMetrics(undefined, true);
  const killSwitch = new KillSwitch({ agentId, agentName: cfg.name }, saved?.kill ?? null);
  const envKill = killFromEnv(process.env, clock.now());
  if (envKill !== null) killSwitch.trigger(envKill);

  const ids = (): string => randomUUID();
  const now = (): number => clock.now();
  const risk = new AgentRisk(identity, recorder, ids, now, metrics.loop, saved === null ? null : riskStateFrom(saved));
  const persister = new StatePersister(stateStore, cfg.network, agentId, now, (err) => log("error", "failed to persist safety state", { error: err instanceof Error ? err.message : "unknown" }), saved);
  const persist = (): void => persister.update(persistable(risk.state, killSwitch.state));
  risk.onChange(persist);
  killSwitch.onKill(persist);
  persist();
  const stores = new Map<string, ParamStore>();
  const quoters = resolved.map((r) => {
    const store = new ParamStore(buildRiskParams(cfg, r.config));
    for (const c of store.initialClamps) log("warn", "parameter clamped to bounds", { market: r.runtime.ticker, field: c.field, from: c.from, to: c.to });
    stores.set(r.runtime.marketId, store);
    return new MarketQuoter({
      adapter,
      market: r.runtime,
      identity,
      getParams: () => store.get(),
      risk,
      sink: recorder,
      killSwitch,
      now,
      ids,
      metrics: metrics.loop,
      settleMs: cfg.loop.settleMs,
      callTimeoutMs: cfg.loop.callTimeoutMs,
    });
  });

  const apiKey = readSecret("anthropic_api_key", process.env, env.SECRETS_DIR);
  const tunerMode = resolveTunerMode({ requested: cfg.tuner.mode, shadowReview: cfg.tuner.shadowReview }, apiKey !== null);
  const tuners: TunerScheduler[] = [];
  if (tunerMode !== "off" && apiKey !== null) {
    const client = createAnthropicTunerClient(apiKey, env.ANTHROPIC_MODEL);
    resolved.forEach((r, i) => {
      const t = new TunerScheduler({
        client,
        mode: tunerMode,
        quoter: quoters[i]!,
        ticker: r.runtime.ticker,
        marketId: r.runtime.marketId,
        store: stores.get(r.runtime.marketId)!,
        sink: recorder,
        identity,
        ids,
        now,
        intervalMs: cfg.tuner.intervalMin * 60_000,
      });
      t.start((err) => log("warn", "tuner step failed", { market: r.runtime.ticker, error: err instanceof Error ? err.constructor.name : "unknown" }));
      tuners.push(t);
    });
  }

  const runner = new AgentRunner({
    adapter,
    quoters,
    killSwitch,
    onCycleError: (marketId, err) => log("error", "cycle error", { marketId, error: err instanceof Error ? err.message : "unknown" }),
  });

  const server = createControlServer({
    registry: metrics.registry,
    killSwitch,
    killToken: readKillToken(env.INTERNAL_KILL_TOKEN_FILE),
    owner: parseOwnerAddress(env.ADMIN_OWNER_ADDRESS),
    network: cfg.network,
    nonces: db === null ? new MemoryNonceStore() : new DrizzleNonceStore(db),
    now,
    health: () => ({ agent: cfg.name, network: cfg.network, killed: killSwitch.state.killed, markets: resolved.length, recorderBuffered: recorder.stats.buffered }),
  });
  server.listen(env.METRICS_PORT, env.METRICS_HOST);

  const background: { stop(): void }[] = [];
  if (db !== null && sql !== null) {
    const poller = new KillCommandPoller({ feed: new DrizzleKillCommandFeed(db), killSwitch, identity, sink: recorder, now, ids, intervalMs: 2_000 });
    poller.start((err) => log("warn", "kill command poll failed", { error: err instanceof Error ? err.message : "unknown" }));
    await sql.listen("strata_kill", () => poller.notify());
    poller.notify();
    background.push(poller);
    const heartbeat = new HeartbeatWriter({
      sink: new DrizzleHeartbeatSink(db),
      network: cfg.network,
      agentId,
      now: () => Date.now(),
      intervalMs: 15_000,
      detail: () =>
        heartbeatDetail({
          name: cfg.name,
          capitalUsd: cfg.capitalUsd,
          params: agentParams,
          tickers: resolved.map((r) => r.runtime.ticker),
          killed: killSwitch.state.killed,
          risk: risk.state,
          tunerMode,
          provenance: identity.provenance,
        }),
    });
    // Soak 2026-11-09: a postgres.js pool on dead sockets never recovered in place; exit and let the supervisor restart.
    const wdCfg = watchdogConfigFromEnv(process.env, { stallMs: 5 * 60_000 });
    const watchdog = new LivenessWatchdog({
      ...wdCfg,
      onTrip: (trip) => {
        log("error", "database liveness watchdog tripped: cancelling all orders and exiting", { ...trip, ...wdCfg });
        fail(1);
      },
    });
    heartbeat.start(
      (err) => {
        log("warn", "heartbeat write failed", { error: err instanceof Error ? err.message : "unknown" });
        watchdog.failure(err);
      },
      () => watchdog.success(),
    );
    watchdog.start(10_000);
    background.push(heartbeat, watchdog);
  }

  fail = installShutdownHandlers(
    process,
    async () => {
      log("info", "shutdown: cancelling all orders");
      for (const t of tuners) t.stop();
      for (const b of background) b.stop();
      stopSim();
      try {
        await runner.shutdown();
      } finally {
        await persister.flush();
        await recorder.stop();
        server.close();
        await sql?.end({ timeout: 5 });
      }
    },
    (code) => process.exit(code),
    { forceExitMs: SHUTDOWN_FORCE_EXIT_MS },
  );

  runner.start();
  log("info", "agent started", {
    agent: cfg.name,
    network: cfg.network,
    adapter: env.STRATA_ADAPTER,
    markets: resolved.map((r) => r.runtime.ticker).join(","),
    tuner: tunerMode,
    killed: killSwitch.state.killed,
  });
}

main().catch((err: unknown) => {
  log("error", "agent failed to start", { error: err instanceof Error ? err.message : "unknown" });
  process.exit(1);
});
