/** In-memory Repository for contract tests. Behaves like the Drizzle implementation on the fields tests touch. */
import type {
  AgentProfile,
  BookSnapshot,
  EpochAttestation,
  EpochScore,
  Fill,
  GuardEvent,
  LiquiditySample,
  Market,
  NetworkName,
  Quote,
  TunerEvent,
} from "@strata/sdk";
import type {
  BaselineStats,
  EventQuery,
  Heartbeat,
  KillCommandInput,
  KillInsertResult,
  OracleReading,
  Repository,
} from "../../src/repo/types.js";

export interface MemoryData {
  markets: Market[];
  books: BookSnapshot[];
  baselines: Array<BaselineStats & { network: NetworkName }>;
  history: Array<LiquiditySample & { network: NetworkName; marketId: string }>;
  oracles: Array<OracleReading & { network: NetworkName; marketId: string }>;
  agents: AgentProfile[];
  quotes: Quote[];
  fills: Fill[];
  scores: EpochScore[];
  guardEvents: GuardEvent[];
  tunerEvents: TunerEvent[];
  heartbeats: Array<Heartbeat & { network: NetworkName }>;
  epochs: EpochAttestation[];
}

export function emptyData(): MemoryData {
  return {
    markets: [], books: [], baselines: [], history: [], oracles: [], agents: [], quotes: [], fills: [],
    scores: [], guardEvents: [], tunerEvents: [], heartbeats: [], epochs: [],
  };
}

const newestFirst = <T extends { at: number }>(a: T, b: T) => b.at - a.at;

export class MemoryRepo implements Repository {
  readonly usedNonces = new Set<string>();
  readonly killCommands: KillCommandInput[] = [];
  failWith: Error | null = null;

  constructor(public data: MemoryData = emptyData()) {}

  private check(): void {
    if (this.failWith) throw this.failWith;
  }

  async ping() { this.check(); }
  async listMarkets(network: NetworkName) { this.check(); return this.data.markets.filter((m) => m.network === network); }
  async getMarket(network: NetworkName, marketId: string) {
    this.check();
    return this.data.markets.find((m) => m.network === network && m.marketId === marketId) ?? null;
  }
  async latestBooks(network: NetworkName) {
    this.check();
    const byMarket = new Map<string, BookSnapshot>();
    for (const b of this.data.books.filter((x) => x.network === network)) {
      const cur = byMarket.get(b.marketId);
      if (!cur || cur.at < b.at) byMarket.set(b.marketId, b);
    }
    return [...byMarket.values()];
  }
  async latestBook(network: NetworkName, marketId: string) {
    return (await this.latestBooks(network)).find((b) => b.marketId === marketId) ?? null;
  }
  async baselineStats(network: NetworkName) {
    this.check();
    return this.data.baselines.filter((b) => b.network === network).map(({ network: _n, ...rest }) => rest);
  }
  async liquidityHistory(network: NetworkName, marketId: string, sinceMs: number) {
    this.check();
    return this.data.history
      .filter((h) => h.network === network && h.marketId === marketId && h.at >= sinceMs)
      .map(({ network: _n, marketId: _m, ...rest }) => rest);
  }
  async latestOracle(network: NetworkName, marketId: string) {
    this.check();
    const o = this.data.oracles.find((x) => x.network === network && x.marketId === marketId);
    return o ? { price: o.price, timestamp: o.timestamp } : null;
  }
  async listAgents(network: NetworkName) { this.check(); return this.data.agents.filter((a) => a.network === network); }
  async getAgent(network: NetworkName, agentId: number) {
    this.check();
    return this.data.agents.find((a) => a.network === network && a.agentId === agentId) ?? null;
  }
  async liveQuotes(network: NetworkName, agentId: number, sinceMs: number) {
    this.check();
    return this.data.quotes.filter((q) => q.network === network && q.agentId === agentId && q.cancelledAt === null && q.postedAt >= sinceMs);
  }
  async quotingAgentCount(network: NetworkName, sinceMs: number) {
    this.check();
    return new Set(this.data.quotes.filter((q) => q.network === network && q.cancelledAt === null && q.postedAt >= sinceMs).map((q) => q.agentId)).size;
  }
  async recentFills(network: NetworkName, agentId: number, limit: number) {
    this.check();
    return this.data.fills.filter((f) => f.network === network && f.agentId === agentId).slice(0, limit);
  }
  async agentScores(network: NetworkName, agentId: number, limit: number) {
    this.check();
    return this.data.scores.filter((s) => s.network === network && s.agentId === agentId).slice(0, limit);
  }
  async guardEvents(network: NetworkName, q: EventQuery) {
    this.check();
    return this.data.guardEvents
      .filter((e) => e.network === network && (q.agentId === undefined || e.agentId === q.agentId) && (q.sinceMs === undefined || e.at >= q.sinceMs))
      .sort(newestFirst)
      .slice(0, q.limit);
  }
  async tunerEvents(network: NetworkName, q: EventQuery) {
    this.check();
    return this.data.tunerEvents
      .filter((e) => e.network === network && (q.agentId === undefined || e.agentId === q.agentId) && (q.sinceMs === undefined || e.at >= q.sinceMs))
      .sort(newestFirst)
      .slice(0, q.limit);
  }
  async heartbeats(network: NetworkName) {
    this.check();
    return this.data.heartbeats.filter((h) => h.network === network).map(({ network: _n, ...rest }) => rest);
  }
  async latestSeason(network: NetworkName) {
    this.check();
    const seasons = this.data.scores.filter((s) => s.network === network).map((s) => s.season);
    return seasons.length ? Math.max(...seasons) : null;
  }
  async scoredEpochs(network: NetworkName, season: number, limit: number) {
    this.check();
    const epochs = new Set(this.data.scores.filter((s) => s.network === network && s.season === season).map((s) => s.epoch));
    return [...epochs].sort((a, b) => b - a).slice(0, limit);
  }
  async epochScores(network: NetworkName, season: number, epoch: number) {
    this.check();
    return this.data.scores.filter((s) => s.network === network && s.season === season && s.epoch === epoch);
  }
  async listEpochs(network: NetworkName, limit: number) {
    this.check();
    return this.data.epochs.filter((e) => e.network === network).slice(0, limit);
  }
  async getEpoch(network: NetworkName, season: number, epoch: number) {
    this.check();
    return this.data.epochs.find((e) => e.network === network && e.season === season && e.epoch === epoch) ?? null;
  }
  async latestPostedEpoch(network: NetworkName) {
    this.check();
    return this.data.epochs.find((e) => e.network === network && e.postedAt !== null) ?? null;
  }
  async insertKillCommand(cmd: KillCommandInput): Promise<KillInsertResult> {
    this.check();
    if (this.usedNonces.has(cmd.nonce)) return "nonce_reused";
    this.usedNonces.add(cmd.nonce);
    this.killCommands.push(cmd);
    return "inserted";
  }
}
