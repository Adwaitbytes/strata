/**
 * Scorer entrypoint: a long-running scheduler for one network (STRATA_NETWORK).
 *
 *   tsx src/main.ts              run forever, posting roots
 *   tsx src/main.ts --dry-run    compute and store scores, never sign or post
 *   tsx src/main.ts --once       one tick, exit 1 on failure (cron or manual catch-up)
 *
 * Exposes Prometheus metrics on :SCORER_METRICS_PORT/metrics and liveness on /healthz.
 */
import { setTimeout as delay } from "node:timers/promises";
import { createDb, describeDatabaseUrl, resolveDatabaseUrl } from "@strata/db";
import { KeystoreKeySource } from "@strata/keys";
import { createAttestorChain } from "./chain.js";
import { loadScorerConfig } from "./config.js";
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
  let failures = 0;
  let exitCode = 0;
  try {
    while (!stop.signal.aborted) {
      try {
        await runner.tick();
        await store.heartbeat({ ok: true, dryRun: cfg.dryRun });
        lastSuccessMs = Date.now();
        failures = 0;
      } catch (err) {
        failures++;
        exitCode = 1;
        log.error("tick failed", { error: errorMessage(err), consecutiveFailures: failures });
        await store.heartbeat({ ok: false, error: errorMessage(err), consecutiveFailures: failures }).catch((hbErr: unknown) => {
          log.error("heartbeat write failed", { error: errorMessage(hbErr) });
        });
      }
      if (cfg.once) break;
      exitCode = 0;
      const wait = cfg.pollMs * Math.min(2 ** failures, MAX_BACKOFF_FACTOR);
      await delay(wait, undefined, { signal: stop.signal }).catch(() => undefined);
    }
  } finally {
    server?.close();
    await dbh.close();
  }
  return exitCode;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    log.error("scorer failed to start", { error: errorMessage(err) });
    process.exit(1);
  },
);
