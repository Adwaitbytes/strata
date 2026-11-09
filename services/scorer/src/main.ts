/**
 * Scorer entrypoint: a long-running scheduler for one network (STRATA_NETWORK).
 *
 *   tsx src/main.ts              run forever, posting roots
 *   tsx src/main.ts --dry-run    compute and store scores, never sign or post
 *   tsx src/main.ts --once       one tick, exit 1 on failure (cron or manual catch-up)
 *
 * Exposes Prometheus metrics on :SCORER_METRICS_PORT/metrics and liveness on /healthz.
 */
import { LivenessWatchdog, createDb, describeDatabaseUrl, resolveDatabaseUrl, watchdogConfigFromEnv } from "@strata/db";
import { KeystoreKeySource } from "@strata/keys";
import { createAttestorChain } from "./chain.js";
import { loadScorerConfig } from "./config.js";
import { runScorerLoop } from "./loop.js";
import { DEFAULT_PARAMS } from "./params.js";
import { EpochRunner, type Logger } from "./runner.js";
import { PgScorerStore } from "./store.js";
import { createScorerMetrics, serveMetrics } from "./telemetry.js";

const MAX_BACKOFF_FACTOR = 8;

const log: Logger = {
  info: (msg, fields) =>
    void process.stdout.write(`${JSON.stringify({ level: "info", service: "scorer", msg, ...fields, at: new Date().toISOString() })}\n`),
  warn: (msg, fields) => console.warn(JSON.stringify({ level: "warn", service: "scorer", msg, ...fields, at: new Date().toISOString() })),
  error: (msg, fields) => console.error(JSON.stringify({ level: "error", service: "scorer", msg, ...fields, at: new Date().toISOString() })),
};

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function main(): Promise<number> {
  const cfg = loadScorerConfig(process.env, process.argv.slice(2));
  const dbUrl = resolveDatabaseUrl();
  const dbh = createDb(dbUrl);
  const store = new PgScorerStore(dbh.db, cfg.network);
  const signer = cfg.dryRun ? null : await new KeystoreKeySource().load(cfg.attestorKeyName);
  const chain = createAttestorChain({
    network: cfg.networkConfig,
    arena: cfg.arena,
    attestor: cfg.attestor,
    signer,
    rpcUrl: cfg.rpcUrl,
    allowMainnet: cfg.allowMainnet,
  });
  const metrics = createScorerMetrics(cfg.network);
  const runner = new EpochRunner({
    network: cfg.network,
    store,
    chain,
    params: DEFAULT_PARAMS,
    apiBase: cfg.apiBase,
    settleDelayMs: cfg.settleDelayMs,
    dryRun: cfg.dryRun,
    metrics,
    log,
  });

  log.info("scorer starting", {
    network: cfg.network,
    database: describeDatabaseUrl(dbUrl),
    arena: cfg.arena,
    attestor: cfg.attestor,
    signer: signer?.evmAddress ?? null,
    dryRun: cfg.dryRun,
  });
  await runner.preflight();
  const season = await chain.getSeason();
  if (season && season.epochSeconds !== cfg.expectedEpochSeconds) {
    log.warn("onchain season epoch length differs from SCORER_EPOCH_SECONDS; using the onchain value", {
      season: season.season,
      onchain: season.epochSeconds,
      expected: cfg.expectedEpochSeconds,
    });
  }

  const stop = new AbortController();
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.once(sig, () => {
      log.info("shutting down", { signal: sig });
      stop.abort();
    });
  }

  let lastSuccessMs = Date.now();
  const server = cfg.once ? null : serveMetrics(cfg.metricsPort, metrics, () => Date.now() - lastSuccessMs < cfg.pollMs * (MAX_BACKOFF_FACTOR + 2));
  // A hung tick reports nothing, so the stall window must exceed the longest healthy gap between
  // successes: the full backoff plus a slow tick.
  const wdCfg = watchdogConfigFromEnv(process.env, { stallMs: Math.max(15 * 60_000, cfg.pollMs * (MAX_BACKOFF_FACTOR + 2)) });
  const watchdog = new LivenessWatchdog({
    ...wdCfg,
    onTrip: (trip) => {
      log.error("liveness watchdog tripped, exiting for a supervised restart", { ...trip, ...wdCfg });
      process.exit(1);
    },
  });
  if (!cfg.once) watchdog.start(10_000);
  try {
    return await runScorerLoop({
      tick: () => runner.tick(),
      heartbeat: (detail) => store.heartbeat(detail),
      pollMs: cfg.pollMs,
      maxBackoffFactor: MAX_BACKOFF_FACTOR,
      once: cfg.once,
      signal: stop.signal,
      watchdog,
      log,
      dryRun: cfg.dryRun,
      onSuccess: () => void (lastSuccessMs = Date.now()),
    });
  } finally {
    watchdog.stop();
    server?.close();
    await dbh.close();
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    log.error("scorer failed to start", { error: errorMessage(err) });
    process.exit(1);
  },
);
