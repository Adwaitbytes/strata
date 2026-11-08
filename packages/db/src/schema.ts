/**
 * Drizzle schema (PRD 11.1, 19.5). Time-series tables are TimescaleDB hypertables
 * (created in migrations/0001_init.sql). Idempotency: chain-derived rows are keyed by
 * (tx_hash, event_index) or natural IDs so backfills and restarts can upsert safely.
 */
import { pgTable, text, integer, bigint, boolean, doublePrecision, jsonb, timestamp, primaryKey, index, numeric, pgEnum } from "drizzle-orm/pg-core";

export const networkEnum = pgEnum("network", ["mainnet", "testnet"]);
export const provenanceEnum = pgEnum("provenance", ["LIVE", "TESTNET", "SIMULATED", "BACKTEST", "BASELINE", "MOCK"]);

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const markets = pgTable("markets", {
  network: networkEnum("network").notNull(),
  marketId: text("market_id").notNull(),
  ticker: text("ticker").notNull(),
  data: jsonb("data").notNull(),
  arenaEnabled: boolean("arena_enabled").notNull().default(false),
  fetchedAt: ts("fetched_at").notNull(),
}, (t) => [primaryKey({ columns: [t.network, t.marketId] })]);

export const agents = pgTable("agents", {
  network: networkEnum("network").notNull(),
  agentId: integer("agent_id").notNull(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  operator: text("operator").notNull(),
  injAddress: text("inj_address").notNull(),
  subaccountId: text("subaccount_id").notNull(),
  erc8004Id: text("erc8004_id"),
  metadataUri: text("metadata_uri").notNull().default(""),
  marketIds: jsonb("market_ids").notNull(),
  status: text("status").notNull(),
  statusReason: text("status_reason"),
  simulated: boolean("simulated").notNull().default(false),
  enrolledAt: ts("enrolled_at").notNull(),
}, (t) => [primaryKey({ columns: [t.network, t.agentId] })]);

/** 5-second samples of the public book for arena markets (hypertable on `at`). */
export const bookSnapshots = pgTable("book_snapshots", {
  network: networkEnum("network").notNull(),
  marketId: text("market_id").notNull(),
  at: ts("at").notNull(),
  provenance: provenanceEnum("provenance").notNull(),
  mid: numeric("mid"),
  spreadBps: doublePrecision("spread_bps"),
  depthUsd25: doublePrecision("depth_usd_25").notNull(),
  strataDepthUsd25: doublePrecision("strata_depth_usd_25").notNull(),
  bids: jsonb("bids").notNull(),
  asks: jsonb("asks").notNull(),
  oraclePrice: numeric("oracle_price"),
  oracleTs: ts("oracle_ts"),
  sessionState: text("session_state").notNull(),
}, (t) => [primaryKey({ columns: [t.network, t.marketId, t.at] })]);

export const trades = pgTable("trades", {
  network: networkEnum("network").notNull(),
  marketId: text("market_id").notNull(),
  tradeId: text("trade_id").notNull(),
  executedAt: ts("executed_at").notNull(),
  price: numeric("price").notNull(),
  quantity: numeric("quantity").notNull(),
  side: text("side").notNull(),
  subaccountId: text("subaccount_id").notNull(),
  isMaker: boolean("is_maker").notNull(),
  fee: numeric("fee").notNull(),
}, (t) => [primaryKey({ columns: [t.network, t.tradeId, t.executedAt] })]);

export const agentOrders = pgTable("agent_orders", {
  network: networkEnum("network").notNull(),
  agentId: integer("agent_id").notNull(),
  marketId: text("market_id").notNull(),
  orderHash: text("order_hash").notNull(),
  side: text("side").notNull(),
  price: numeric("price").notNull(),
  quantity: numeric("quantity").notNull(),
  level: integer("level").notNull(),
  postedAt: ts("posted_at").notNull(),
  cancelledAt: ts("cancelled_at"),
  provenance: provenanceEnum("provenance").notNull(),
}, (t) => [primaryKey({ columns: [t.network, t.orderHash, t.postedAt] }), index("agent_orders_agent_idx").on(t.network, t.agentId, t.postedAt)]);

export const agentFills = pgTable("agent_fills", {
  network: networkEnum("network").notNull(),
  agentId: integer("agent_id").notNull(),
  marketId: text("market_id").notNull(),
  orderHash: text("order_hash").notNull(),
  tradeId: text("trade_id").notNull(),
  txHash: text("tx_hash").notNull(),
  eventIndex: integer("event_index").notNull(),
  side: text("side").notNull(),
  price: numeric("price").notNull(),
  quantity: numeric("quantity").notNull(),
  feeUsd: doublePrecision("fee_usd").notNull(),
  isMaker: boolean("is_maker").notNull(),
  counterpartySubaccountId: text("counterparty_subaccount_id"),
  executedAt: ts("executed_at").notNull(),
  provenance: provenanceEnum("provenance").notNull(),
}, (t) => [primaryKey({ columns: [t.network, t.txHash, t.eventIndex, t.executedAt] })]);

export const oraclePrices = pgTable("oracle_prices", {
  network: networkEnum("network").notNull(),
  marketId: text("market_id").notNull(),
  source: text("source").notNull(),
  at: ts("at").notNull(),
  price: numeric("price").notNull(),
  oracleTs: ts("oracle_ts").notNull(),
}, (t) => [primaryKey({ columns: [t.network, t.marketId, t.source, t.at] })]);

export const guardEvents = pgTable("guard_events", {
  id: text("id").notNull(),
  network: networkEnum("network").notNull(),
  provenance: provenanceEnum("provenance").notNull(),
  agentId: integer("agent_id").notNull(),
  marketId: text("market_id"),
  guard: text("guard").notNull(),
  action: text("action").notNull(),
  reason: text("reason").notNull(),
  detail: text("detail").notNull(),
  observed: jsonb("observed").notNull(),
  at: ts("at").notNull(),
}, (t) => [primaryKey({ columns: [t.id, t.at] })]);

export const tunerEvents = pgTable("tuner_events", {
  id: text("id").notNull(),
  network: networkEnum("network").notNull(),
  agentId: integer("agent_id").notNull(),
  marketId: text("market_id").notNull(),
  mode: text("mode").notNull(),
  model: text("model").notNull(),
  payload: jsonb("payload").notNull(),
  at: ts("at").notNull(),
}, (t) => [primaryKey({ columns: [t.id, t.at] })]);

export const epochs = pgTable("epochs", {
  network: networkEnum("network").notNull(),
  season: integer("season").notNull(),
  epoch: integer("epoch").notNull(),
  startTime: ts("start_time").notNull(),
  endTime: ts("end_time").notNull(),
  merkleRoot: text("merkle_root").notNull(),
  dataUri: text("data_uri").notNull(),
  txHash: text("tx_hash"),
  postedAt: ts("posted_at"),
  contract: text("contract").notNull(),
}, (t) => [primaryKey({ columns: [t.network, t.season, t.epoch] })]);

export const scores = pgTable("scores", {
  network: networkEnum("network").notNull(),
  season: integer("season").notNull(),
  epoch: integer("epoch").notNull(),
  agentId: integer("agent_id").notNull(),
  score: integer("score").notNull(),
  metrics: jsonb("metrics").notNull(),
  flags: bigint("flags", { mode: "number" }).notNull(),
  leaf: text("leaf").notNull(),
  proof: jsonb("proof").notNull(),
  provenance: provenanceEnum("provenance").notNull(),
}, (t) => [primaryKey({ columns: [t.network, t.season, t.epoch, t.agentId] })]);

/** Agent process heartbeats for /status and uptime. */
export const heartbeats = pgTable("heartbeats", {
  network: networkEnum("network").notNull(),
  service: text("service").notNull(),
  at: ts("at").notNull(),
  detail: jsonb("detail").notNull(),
}, (t) => [primaryKey({ columns: [t.network, t.service] })]);

/** Single-use nonces for signed admin requests (PRD 16.2). */
export const adminNonces = pgTable("admin_nonces", {
  nonce: text("nonce").primaryKey(),
  usedAt: ts("used_at").notNull(),
});

/** Raw arena contract logs from Blockscout (migration 0002). Keyed by tx hash + log index. */
export const arenaEvents = pgTable("arena_events", {
  network: networkEnum("network").notNull(),
  contract: text("contract").notNull(),
  txHash: text("tx_hash").notNull(),
  logIndex: integer("log_index").notNull(),
  blockNumber: bigint("block_number", { mode: "number" }).notNull(),
  blockTime: ts("block_time").notNull(),
  event: text("event").notNull(),
  args: jsonb("args").notNull(),
  ingestedAt: ts("ingested_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.network, t.txHash, t.logIndex] })]);

/** Resume points for pollers and backfills (migration 0002). */
export const indexerCursors = pgTable("indexer_cursors", {
  network: networkEnum("network").notNull(),
  source: text("source").notNull(),
  cursor: jsonb("cursor").notNull(),
  updatedAt: ts("updated_at").notNull(),
}, (t) => [primaryKey({ columns: [t.network, t.source] })]);

/** Agent position samples (migration 0002, hypertable on `at`). */
export const agentPositions = pgTable("agent_positions", {
  network: networkEnum("network").notNull(),
  agentId: integer("agent_id").notNull(),
  marketId: text("market_id").notNull(),
  at: ts("at").notNull(),
  direction: text("direction").notNull(),
  quantity: numeric("quantity").notNull(),
  entryPrice: numeric("entry_price").notNull(),
  margin: numeric("margin").notNull(),
  markPrice: numeric("mark_price"),
  provenance: provenanceEnum("provenance").notNull(),
}, (t) => [primaryKey({ columns: [t.network, t.agentId, t.marketId, t.at] })]);

/**
 * Accepted kill-switch commands (PRD 9.6 b), written by apps/api after verifying the owner
 * signature. Agents poll rows newer than their cursor where target_agent_id is NULL (all)
 * or their own id, and acknowledge by writing a guard_events row with reason
 * `kill_switch_api` and observed.killCommandId. `pg_notify('strata_kill', id)` fires on insert.
 */
export const killCommands = pgTable("kill_commands", {
  id: text("id").primaryKey(),
  network: networkEnum("network").notNull(),
  targetAgentId: integer("target_agent_id"),
  closePositions: boolean("close_positions").notNull(),
  signer: text("signer").notNull(),
  nonce: text("nonce").notNull().unique().references(() => adminNonces.nonce),
  requestedAt: ts("requested_at").notNull(),
  signatureExpiresAt: ts("signature_expires_at").notNull(),
}, (t) => [index("kill_commands_network_requested_idx").on(t.network, t.requestedAt)]);

/**
 * Scorer state per epoch (migration 0004, owned by W5). The scheduler cursor, skip reasons and the
 * postEpoch tx being tracked. status: computed | submitted | posted | skipped | failed.
 */
export const epochRuns = pgTable("epoch_runs", {
  network: networkEnum("network").notNull(),
  season: integer("season").notNull(),
  epoch: integer("epoch").notNull(),
  status: text("status").notNull(),
  merkleRoot: text("merkle_root"),
  dataUri: text("data_uri"),
  documentHash: text("document_hash"),
  txHash: text("tx_hash"),
  reason: text("reason"),
  attempts: integer("attempts").notNull().default(0),
  detail: jsonb("detail").notNull(),
  updatedAt: ts("updated_at").notNull(),
}, (t) => [primaryKey({ columns: [t.network, t.season, t.epoch] })]);
