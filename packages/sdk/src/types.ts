/**
 * Shared domain types for every STRATA workstream (PRD Section 19.1).
 *
 * zod schemas are the single source of truth: runtime validation at every boundary
 * and the static types below are derived from the same definitions.
 *
 * Conventions:
 * - Chain-precision values (prices, quantities) are decimal strings in HUMAN units
 *   (already divided by quote/base decimals). Never JS floats for anything that hits the chain.
 * - Derived analytics (USD depth, bps, scores) are JS numbers.
 * - Timestamps are integer milliseconds since Unix epoch (UTC).
 * - Every data-bearing object carries `network` and `provenance` so the UI can never
 *   show a non-live number without a label (PRD rule 7).
 */
import { z } from "zod";

export const NetworkName = z.enum(["mainnet", "testnet"]);
export type NetworkName = z.infer<typeof NetworkName>;

/**
 * Where a number came from. Only `LIVE` may be shown unlabeled.
 * `MOCK` exists for local development and must never reach a production view.
 */
export const Provenance = z.enum(["LIVE", "TESTNET", "SIMULATED", "BACKTEST", "BASELINE", "MOCK"]);
export type Provenance = z.infer<typeof Provenance>;

export const Hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected 32-byte hex");
export const EvmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "expected EVM address");
export const InjAddress = z.string().regex(/^inj1[02-9ac-hj-np-z]{38}$/, "expected inj bech32 address");
export const DecimalString = z.string().regex(/^-?\d+(\.\d+)?$/, "expected decimal string");
export const TimestampMs = z.number().int().nonnegative();

export const AssetClass = z.enum(["equity", "index", "fx", "commodity", "compute", "crypto"]);
export type AssetClass = z.infer<typeof AssetClass>;

/** "unknown": the writer has no session calendar for the market (e.g. the indexer), so no state is claimed. */
export const SessionState = z.enum(["open", "closing", "closed", "reopening", "always_open", "unknown"]);
export type SessionState = z.infer<typeof SessionState>;

export const Market = z.object({
  network: NetworkName,
  /** Injective derivative market ID, fetched live from the Indexer. Never hand-written. */
  marketId: Hex32,
  ticker: z.string(),
  symbol: z.string(),
  assetClass: AssetClass,
  quoteDenom: z.string(),
  quoteDecimals: z.number().int().nonnegative(),
  oracleType: z.string(),
  oracleBase: z.string(),
  oracleQuote: z.string(),
  minPriceTickSize: DecimalString,
  minQuantityTickSize: DecimalString,
  minNotional: DecimalString,
  makerFeeRate: DecimalString,
  takerFeeRate: DecimalString,
  initialMarginRatio: DecimalString,
  maintenanceMarginRatio: DecimalString,
  isPerpetual: z.boolean(),
  arenaEnabled: z.boolean(),
  maxSpreadBps: z.number().int().positive(),
  minDepthUsd: z.number().int().nonnegative(),
  /** ISO timestamp + source URL of the live fetch that produced this record. */
  fetchedAt: TimestampMs,
  source: z.string().url(),
});
export type Market = z.infer<typeof Market>;

export const AgentStatus = z.enum(["active", "halted", "withdrawn", "suspended", "pending"]);
export type AgentStatus = z.infer<typeof AgentStatus>;

export const AgentKind = z.enum(["house", "third_party"]);
export type AgentKind = z.infer<typeof AgentKind>;

export const AgentProfile = z.object({
  network: NetworkName,
  /** Arena agent ID from StrataArena. */
  agentId: z.number().int().positive(),
  name: z.string().min(1).max(64),
  kind: AgentKind,
  operator: EvmAddress,
  injAddress: InjAddress,
  subaccountId: Hex32,
  /** ERC-8004 identity token ID; null until registered. */
  erc8004Id: z.string().regex(/^\d+$/).nullable(),
  metadataURI: z.string(),
  marketIds: z.array(Hex32),
  status: AgentStatus,
  statusReason: z.string().nullable(),
  enrolledAt: TimestampMs,
  /** True when the options agent or any agent runs against the simulator. */
  simulated: z.boolean(),
});
export type AgentProfile = z.infer<typeof AgentProfile>;

export const Side = z.enum(["buy", "sell"]);
export type Side = z.infer<typeof Side>;

export const Quote = z.object({
  network: NetworkName,
  provenance: Provenance,
  agentId: z.number().int().positive(),
  marketId: Hex32,
  orderHash: z.string(),
  side: Side,
  price: DecimalString,
  quantity: DecimalString,
  level: z.number().int().nonnegative(),
  postedAt: TimestampMs,
  cancelledAt: TimestampMs.nullable(),
});
export type Quote = z.infer<typeof Quote>;

export const Fill = z.object({
  network: NetworkName,
  provenance: Provenance,
  agentId: z.number().int().positive(),
  marketId: Hex32,
  orderHash: z.string(),
  tradeId: z.string(),
  txHash: z.string(),
  eventIndex: z.number().int().nonnegative(),
  side: Side,
  price: DecimalString,
  quantity: DecimalString,
  feeUsd: z.number(),
  isMaker: z.boolean(),
  counterpartySubaccountId: Hex32.nullable(),
  executedAt: TimestampMs,
});
export type Fill = z.infer<typeof Fill>;

export const GuardName = z.enum(["oracle", "session", "risk", "kill_switch"]);
export type GuardName = z.infer<typeof GuardName>;

export const GuardAction = z.enum(["ok", "widen", "reduce", "flatten", "halt", "resume"]);
export type GuardAction = z.infer<typeof GuardAction>;

export const GuardReason = z.enum([
  "oracle_stale",
  "oracle_future_timestamp",
  "oracle_book_deviation",
  "oracle_source_divergence",
  "oracle_jump",
  "session_pre_close",
  "session_flatten",
  "session_closed",
  "session_reopen_cooldown",
  "session_ramp",
  "risk_gross_notional",
  "risk_net_notional",
  "risk_daily_loss",
  "risk_max_drawdown",
  "risk_order_rate",
  "risk_margin_ratio",
  "kill_switch_telegram",
  "kill_switch_api",
  "kill_switch_env",
  "data_unavailable",
]);
export type GuardReason = z.infer<typeof GuardReason>;

export const GuardEvent = z.object({
  network: NetworkName,
  provenance: Provenance,
  id: z.string(),
  agentId: z.number().int().positive(),
  marketId: Hex32.nullable(),
  guard: GuardName,
  action: GuardAction,
  reason: GuardReason,
  /** Human-readable, plain sentence. Shown on the Transparency page. */
  detail: z.string(),
  /** Measured values that triggered the guard, e.g. { oracleAgeSec: 41, limit: 30 }. */
  observed: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
  at: TimestampMs,
});
export type GuardEvent = z.infer<typeof GuardEvent>;

/** Parameters the AI Risk Tuner may adjust. Bounds live in @strata/risk. */
export const TunableParams = z.object({
  gamma: z.number(),
  minHalfSpreadBps: z.number(),
  levels: z.number().int(),
  sizeMultiplier: z.number(),
  offHoursQuoting: z.boolean(),
});
export type TunableParams = z.infer<typeof TunableParams>;

export const TunerMode = z.enum(["shadow", "live", "static"]);
export type TunerMode = z.infer<typeof TunerMode>;

export const TunerEvent = z.object({
  network: NetworkName,
  id: z.string(),
  agentId: z.number().int().positive(),
  marketId: Hex32,
  mode: TunerMode,
  model: z.string(),
  before: TunableParams,
  suggested: TunableParams,
  /** Values after clamping to bounds and the 20%-per-step limit. */
  applied: TunableParams.nullable(),
  clamped: z.array(z.string()),
  rationale: z.string().max(280),
  rejected: z.boolean(),
  rejectReason: z.string().nullable(),
  at: TimestampMs,
});
export type TunerEvent = z.infer<typeof TunerEvent>;

/** Score flags. Any set flag disqualifies the epoch (PRD 10.5). Bitmask in the merkle leaf. */
export const ScoreFlag = {
  WASH: 1 << 0,
  SPAM: 1 << 1,
  SELF_TRADE: 1 << 2,
  SUSPENDED: 1 << 3,
  DATA_GAP: 1 << 4,
} as const;
export type ScoreFlagName = keyof typeof ScoreFlag;

export const EpochMetrics = z.object({
  quotedSpreadBps: z.number().nonnegative(),
  depthUsd25: z.number().nonnegative(),
  uptimeBps: z.number().int().min(0).max(10_000),
  bookShare: z.number().min(0).max(1),
  markout60s: z.number(),
  pnlUsd: z.number(),
  maxDrawdownUsd: z.number().nonnegative(),
  spreadImprovementBps: z.number(),
  samples: z.number().int().nonnegative(),
});
export type EpochMetrics = z.infer<typeof EpochMetrics>;

export const EpochScore = z.object({
  network: NetworkName,
  provenance: Provenance,
  season: z.number().int().nonnegative(),
  epoch: z.number().int().nonnegative(),
  agentId: z.number().int().positive(),
  score: z.number().int().min(0).max(10_000),
  metrics: EpochMetrics,
  flags: z.number().int().nonnegative(),
  flagNames: z.array(z.string()),
  /** Leaf = keccak256(abi.encode(season, epoch, agentId, score, spreadBps, depthUsd, uptimeBps, pnlUsd, flags)). See docs/SCORING.md. */
  leaf: Hex32,
  proof: z.array(Hex32),
});
export type EpochScore = z.infer<typeof EpochScore>;

export const EpochAttestation = z.object({
  network: NetworkName,
  season: z.number().int().nonnegative(),
  epoch: z.number().int().nonnegative(),
  startTime: TimestampMs,
  endTime: TimestampMs,
  merkleRoot: Hex32,
  dataURI: z.string(),
  txHash: Hex32.nullable(),
  postedAt: TimestampMs.nullable(),
  contract: EvmAddress,
});
export type EpochAttestation = z.infer<typeof EpochAttestation>;

export const LeaderboardRow = z.object({
  network: NetworkName,
  provenance: Provenance,
  rank: z.number().int().positive(),
  previousRank: z.number().int().positive().nullable(),
  agentId: z.number().int().positive(),
  name: z.string(),
  kind: AgentKind,
  status: AgentStatus,
  score: z.number().int().min(0).max(10_000),
  quotedSpreadBps: z.number().nonnegative(),
  depthUsd25: z.number().nonnegative(),
  uptimeBps: z.number().int().min(0).max(10_000),
  pnlUsd: z.number(),
  marketIds: z.array(Hex32),
  lastEpoch: z.number().int().nonnegative().nullable(),
});
export type LeaderboardRow = z.infer<typeof LeaderboardRow>;

/** One aggregated L2 level. */
export const BookLevel = z.object({
  price: DecimalString,
  quantity: DecimalString,
  /** Portion of `quantity` (base units) resting from STRATA agents. */
  strataQuantity: DecimalString,
});
export type BookLevel = z.infer<typeof BookLevel>;

export const BookSnapshot = z.object({
  network: NetworkName,
  provenance: Provenance,
  marketId: Hex32,
  bids: z.array(BookLevel),
  asks: z.array(BookLevel),
  mid: DecimalString.nullable(),
  spreadBps: z.number().nonnegative().nullable(),
  depthUsd25: z.number().nonnegative(),
  strataDepthUsd25: z.number().nonnegative(),
  oraclePrice: DecimalString.nullable(),
  oracleTimestamp: TimestampMs.nullable(),
  sessionState: SessionState,
  at: TimestampMs,
});
export type BookSnapshot = z.infer<typeof BookSnapshot>;

/** Spread/depth sample for charts. BASELINE samples predate STRATA quoting. */
export const LiquiditySample = z.object({
  at: TimestampMs,
  spreadBps: z.number().nonnegative().nullable(),
  depthUsd25: z.number().nonnegative(),
  strataDepthUsd25: z.number().nonnegative(),
  provenance: Provenance,
});
export type LiquiditySample = z.infer<typeof LiquiditySample>;
