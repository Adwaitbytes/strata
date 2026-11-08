/**
 * Startup checks and adapter selection, kept separate from main.ts so they are unit-tested.
 */
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Market, NetworkName, Provenance } from "@strata/sdk";
import { sessionClassFor } from "@strata/risk";
import type { AgentConfig, AgentEnv, ResolvedMarket } from "./config.js";
import type { ExchangeAdapter } from "./exchange.js";
import { SimExchange } from "./sim/simExchange.js";

export function resolveConfigPath(nameOrPath: string): string {
  if (nameOrPath.endsWith(".json")) return nameOrPath;
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(nameOrPath)) throw new Error(`invalid agent config name: ${nameOrPath}`);
  return fileURLToPath(new URL(`../../config/agents/${nameOrPath}.json`, import.meta.url));
}

/** Returns the arena agent ID once every startup gate passes. */
export function assertRunnable(cfg: AgentConfig, env: AgentEnv): number {
  if (cfg.network !== env.STRATA_NETWORK) throw new Error(`config ${cfg.name} is for network ${cfg.network} but STRATA_NETWORK=${env.STRATA_NETWORK}`);
  if (!cfg.enabled) throw new Error(`agent ${cfg.name} is disabled in its config`);
  if (cfg.network === "mainnet") {
    if (!env.MAINNET_GO_AHEAD) throw new Error("mainnet requires MAINNET_GO_AHEAD=true (orchestrator go-ahead, CLAUDE.md testnet-first rule)");
    if (env.STRATA_ADAPTER === "sim") throw new Error("the simulator never runs as a mainnet agent");
  }
  if (env.AGENT_ID === undefined) throw new Error("AGENT_ID is required (arena agent ID from StrataArena enrollment)");
  return env.AGENT_ID;
}

export function provenanceFor(network: NetworkName, adapter: AgentEnv["STRATA_ADAPTER"]): Provenance {
  if (adapter === "sim") return "SIMULATED";
  return network === "mainnet" ? "LIVE" : "TESTNET";
}

/**
 * Simulator markets for local runs. IDs are a hash of the ticker and prices are synthetic; every
 * event from these markets is recorded with provenance SIMULATED.
 */
export function buildSimMarkets(cfg: AgentConfig, chainTimeMs: number): { resolved: ResolvedMarket[]; sim: SimExchange } {
  const resolved: ResolvedMarket[] = cfg.markets.map((mc) => {
    const marketId = `0x${createHash("sha256").update(`sim:${mc.ticker}`).digest("hex")}`;
    const market: Market = {
      network: cfg.network,
      marketId,
      ticker: mc.ticker,
      symbol: mc.ticker.split("/")[0] ?? mc.ticker,
      assetClass: "crypto",
      quoteDenom: "sim",
      quoteDecimals: 6,
      oracleType: "sim",
      oracleBase: mc.ticker,
      oracleQuote: "USD",
      minPriceTickSize: "0.01",
      minQuantityTickSize: "0.001",
      minNotional: "1",
      makerFeeRate: "0",
      takerFeeRate: "0",
      initialMarginRatio: "0.05",
      maintenanceMarginRatio: "0.025",
      isPerpetual: true,
      arenaEnabled: true,
      maxSpreadBps: 50,
      minDepthUsd: 0,
      fetchedAt: chainTimeMs,
      source: "https://strata.invalid/simulator",
    };
    return {
      config: mc,
      market,
      runtime: {
        marketId,
        ticker: mc.ticker,
        sessionClass: mc.sessionClass ?? sessionClassFor(market.assetClass),
        spec: { tickSize: market.minPriceTickSize, minQuantity: market.minQuantityTickSize, minNotional: market.minNotional },
      },
    };
  });
  const sim = new SimExchange({
    chainTimeMs,
    markets: resolved.map((r) => ({ marketId: r.runtime.marketId, bids: [{ price: "99.95", quantity: "50" }], asks: [{ price: "100.05", quantity: "50" }], oraclePrice: "100" })),
  });
  return { resolved, sim };
}

/**
 * Moves simulator chain time with the wall clock and random-walks each SIMULATED oracle and book,
 * so a local run exercises the full loop. Returns a stop function.
 */
export function driveSim(sim: SimExchange, marketIds: readonly string[], stepMs = 1_000, random: () => number = Math.random): () => void {
  const prices = new Map(marketIds.map((id) => [id, 100]));
  const step = (): void => {
    sim.advance(stepMs);
    for (const id of marketIds) {
      const p = prices.get(id)! * (1 + (random() - 0.5) * 0.0004);
      prices.set(id, p);
      sim.setOracle(id, p.toFixed(4), sim.chainTimeMs - 300);
      sim.setBook(id, [{ price: (p * 0.9995).toFixed(2), quantity: "50" }], [{ price: (p * 1.0005).toFixed(2), quantity: "50" }]);
      if (random() < 0.05) sim.takerTrade(id, random() < 0.5 ? "buy" : "sell", "0.1");
    }
  };
  const timer = setInterval(step, stepMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

/** Options passed to W3's `createInjectiveAdapter` (services/agent/src/injective/index.ts). */
export interface InjectiveAdapterOptions {
  readonly network: NetworkName;
  readonly agentName: string;
  readonly markets: readonly Market[];
  readonly secretsDir: string;
}

export type ModuleImporter = () => Promise<unknown>;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const ADAPTER_METHODS = ["getMarketState", "getOpenOrders", "batchUpdate", "cancelAll", "closePositionReduceOnly", "onFill"] as const;

function isExchangeAdapter(v: unknown): v is ExchangeAdapter {
  return isRecord(v) && typeof v["network"] === "string" && typeof v["address"] === "string" && ADAPTER_METHODS.every((m) => typeof v[m] === "function");
}

// The specifier is a variable so the core typechecks and tests without W3's module present.
const INJECTIVE_MODULE = "../injective/index.js";
const defaultImporter: ModuleImporter = () => import(INJECTIVE_MODULE);

export async function loadInjectiveAdapter(opts: InjectiveAdapterOptions, importer: ModuleImporter = defaultImporter): Promise<ExchangeAdapter> {
  const mod = await importer();
  if (!isRecord(mod) || typeof mod["createInjectiveAdapter"] !== "function") {
    throw new Error("services/agent/src/injective/index.ts must export createInjectiveAdapter(options)");
  }
  const factory = mod["createInjectiveAdapter"] as (o: InjectiveAdapterOptions) => unknown;
  const adapter: unknown = await factory(opts);
  if (!isExchangeAdapter(adapter)) throw new Error("createInjectiveAdapter did not return an ExchangeAdapter");
  if (adapter.network !== opts.network) throw new Error(`adapter network ${adapter.network} does not match ${opts.network}`);
  return adapter;
}
