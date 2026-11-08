/**
 * Stores decoded arena logs and projects them into `agents`, `markets.arena_enabled` and `epochs`.
 *
 * Idempotency: raw events are inserted with ON CONFLICT (network, tx_hash, log_index) DO NOTHING
 * and only rows that were actually inserted are projected, inside the same transaction. A crash
 * rolls back both, a replay inserts nothing and projects nothing.
 */
import { getInjectiveAddress } from "@injectivelabs/sdk-ts";
import type { Sql } from "@strata/db";
import type { TransactionSql } from "postgres";
import type { NetworkName } from "@strata/sdk";
import type { ArenaEvent } from "./decode.js";

type Tx = TransactionSql;

export interface ProjectOptions {
  /** Operator addresses (lowercase) that run house agents; everyone else is third_party. */
  houseOperators?: ReadonlySet<string>;
}

export interface ApplyResult {
  inserted: number;
  duplicates: number;
}

function str(e: ArenaEvent, key: string): string {
  const v = e.args[key];
  if (v === undefined) throw new Error(`${e.event} ${e.txHash}:${e.logIndex} missing arg ${key}`);
  return String(v);
}

function sortKey(a: ArenaEvent, b: ArenaEvent): number {
  return a.blockNumber - b.blockNumber || a.logIndex - b.logIndex;
}

export async function applyArenaEvents(sql: Sql, network: NetworkName, events: readonly ArenaEvent[], opts: ProjectOptions = {}): Promise<ApplyResult> {
  const ordered = [...events].sort(sortKey);
  let inserted = 0;
  await sql.begin(async (tx) => {
    for (const e of ordered) {
      const rows = await tx`
        INSERT INTO arena_events (network, contract, tx_hash, log_index, block_number, block_time, event, args)
        VALUES (${network}, ${e.contract}, ${e.txHash}, ${e.logIndex}, ${e.blockNumber}, ${e.blockTime}, ${e.event}, ${tx.json(e.args)})
        ON CONFLICT (network, tx_hash, log_index) DO NOTHING
        RETURNING 1`;
      if (rows.length === 0) continue;
      inserted += 1;
      await project(tx, network, e, opts);
    }
  });
  return { inserted, duplicates: ordered.length - inserted };
}

async function project(tx: Tx, network: NetworkName, e: ArenaEvent, opts: ProjectOptions): Promise<void> {
  switch (e.event) {
    case "AgentEnrolled": {
      const agentId = Number(str(e, "agentId"));
      const operator = str(e, "operator").toLowerCase();
      const erc8004 = str(e, "erc8004Id");
      const kind = opts.houseOperators?.has(operator) ? "house" : "third_party";
      // EVM address to inj bech32 via sdk-ts getInjectiveAddress (same 20 bytes, PRD 4.2).
      const injAddress = getInjectiveAddress(operator);
      await tx`
        INSERT INTO agents (network, agent_id, name, kind, operator, inj_address, subaccount_id, erc8004_id, metadata_uri, market_ids, status, enrolled_at)
        VALUES (${network}, ${agentId}, ${`Agent #${agentId}`}, ${kind}, ${operator}, ${injAddress}, ${str(e, "subaccountId").toLowerCase()},
                ${erc8004 === "0" ? null : erc8004}, ${str(e, "metadataURI")}, ${tx.json([])}, 'active', ${e.blockTime})
        ON CONFLICT (network, agent_id) DO UPDATE SET operator = excluded.operator, inj_address = excluded.inj_address,
          subaccount_id = excluded.subaccount_id, erc8004_id = excluded.erc8004_id, metadata_uri = excluded.metadata_uri,
          status = 'active', status_reason = NULL, enrolled_at = excluded.enrolled_at`;
      return;
    }
    case "AgentUpdated":
      await tx`UPDATE agents SET metadata_uri = ${str(e, "metadataURI")} WHERE network = ${network} AND agent_id = ${Number(str(e, "agentId"))}`;
      return;
    case "AgentWithdrawn":
      await tx`UPDATE agents SET status = 'withdrawn' WHERE network = ${network} AND agent_id = ${Number(str(e, "agentId"))}`;
      return;
    case "AgentSuspended":
      await tx`UPDATE agents SET status = 'suspended', status_reason = ${str(e, "reason")} WHERE network = ${network} AND agent_id = ${Number(str(e, "agentId"))}`;
      return;
    case "MarketSet":
      await tx`UPDATE markets SET arena_enabled = ${e.args.enabled === true} WHERE network = ${network} AND market_id = ${str(e, "marketId").toLowerCase()}`;
      return;
    case "EpochPosted": {
      const season = Number(str(e, "season"));
      const epoch = Number(str(e, "epoch"));
      const window = await epochWindow(tx, network, season, epoch);
      // Same window rule as services/scorer/src/epoch.ts epochWindow: 0-based, start + epoch * len.
      await tx`
        INSERT INTO epochs (network, season, epoch, start_time, end_time, merkle_root, data_uri, tx_hash, posted_at, contract)
        VALUES (${network}, ${season}, ${epoch}, ${window?.start ?? e.blockTime}, ${window?.end ?? e.blockTime}, ${str(e, "root").toLowerCase()},
                ${str(e, "uri")}, ${e.txHash}, ${e.blockTime}, ${e.contract})
        ON CONFLICT (network, season, epoch) DO UPDATE SET merkle_root = excluded.merkle_root, data_uri = excluded.data_uri,
          tx_hash = excluded.tx_hash, posted_at = excluded.posted_at, contract = excluded.contract`;
      return;
    }
    default:
      // SeasonStarted/SeasonEnded/AttestorChanged/AgentCapChanged stay in arena_events only.
      return;
  }
}

async function epochWindow(tx: Tx, network: NetworkName, season: number, epoch: number): Promise<{ start: Date; end: Date } | null> {
  const [s] = await tx<{ args: { startTime: string; endTime: string; epochSeconds: number | string } }[]>`
    SELECT args FROM arena_events WHERE network = ${network} AND event = 'SeasonStarted' AND args->>'season' = ${String(season)}
    ORDER BY block_number DESC, log_index DESC LIMIT 1`;
  if (!s) return null;
  const startMs = Number(s.args.startTime) * 1000;
  const endMs = Number(s.args.endTime) * 1000;
  const len = Number(s.args.epochSeconds) * 1000;
  if (!(len > 0)) return null;
  const start = startMs + epoch * len;
  return { start: new Date(start), end: new Date(Math.min(start + len, endMs)) };
}

/** Arena-enabled market IDs from the latest MarketSet per market (independent of the markets table). */
export async function arenaMarketIds(sql: Sql, network: NetworkName): Promise<string[]> {
  const rows = await sql<{ market_id: string; enabled: boolean }[]>`
    SELECT DISTINCT ON (args->>'marketId') lower(args->>'marketId') AS market_id, (args->>'enabled')::boolean AS enabled
    FROM arena_events WHERE network = ${network} AND event = 'MarketSet'
    ORDER BY args->>'marketId', block_number DESC, log_index DESC`;
  return rows.filter((r) => r.enabled).map((r) => r.market_id);
}
