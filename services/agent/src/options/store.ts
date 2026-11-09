/**
 * Postgres persistence for the options simulator (migration 0006). Every row is written with
 * provenance SIMULATED, and the tables enforce that with a CHECK constraint.
 */
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";
import { agents, simOptionBook, simOptionPositions, simOptionQuotes } from "@strata/db";
import type { NetworkName } from "@strata/sdk";
import { UNDERLYINGS, type SimPosition } from "./book.js";
import type { BookSnapshot, OptionsStore, QuoteRecord } from "./runner.js";

type AnyPgJsDb = PostgresJsDatabase<Record<string, never>>;

const num = (v: number): string => {
  if (!Number.isFinite(v)) throw new Error(`non-finite numeric ${v}`);
  return String(v);
};

const PositionRow = z.object({
  positionId: z.string(),
  underlying: z.enum(UNDERLYINGS),
  underlyingMarketId: z.string(),
  kind: z.enum(["call", "put"]),
  strike: z.coerce.number(),
  expiryAt: z.date(),
  size: z.coerce.number(),
  premium: z.coerce.number(),
  collateral: z.coerce.number(),
  status: z.enum(["open", "settled", "closed_early"]),
  payout: z.coerce.number().nullable(),
  settlementPrice: z.coerce.number().nullable(),
  settledOnStaleOracle: z.boolean(),
  openedAt: z.date(),
  closedAt: z.date().nullable(),
});

export interface SimulatedAgentRow {
  readonly network: NetworkName;
  readonly agentId: number;
  readonly name: string;
  readonly operator: string;
  readonly injAddress: string;
  readonly enrolledAt: number;
}

export class DrizzleOptionsStore implements OptionsStore {
  constructor(private readonly db: AnyPgJsDb) {}

  /**
   * Registers the options agent in `agents` with simulated = true (kind house, no arena markets), so
   * the API and web show it with the SIMULATED badge and the scorer skips it. Never takes over a
   * row that belongs to a real (non-simulated) agent.
   */
  async ensureAgentRow(a: SimulatedAgentRow): Promise<void> {
    const subaccountId = `${a.operator.toLowerCase()}${"0".repeat(24)}`;
    await this.db
      .insert(agents)
      .values({
        network: a.network,
        agentId: a.agentId,
        name: a.name,
        kind: "house",
        operator: a.operator.toLowerCase(),
        injAddress: a.injAddress,
        subaccountId,
        erc8004Id: null,
        metadataUri: "",
        marketIds: [],
        status: "active",
        statusReason: null,
        simulated: true,
        enrolledAt: new Date(a.enrolledAt),
      })
      .onConflictDoNothing();
    const [row] = await this.db
      .select({ name: agents.name, simulated: agents.simulated })
      .from(agents)
      .where(and(eq(agents.network, a.network), eq(agents.agentId, a.agentId)))
      .limit(1);
    if (row === undefined || !row.simulated || row.name !== a.name) {
      throw new Error(`agents row ${a.network}/${a.agentId} is not the simulated ${a.name}; refusing to run`);
    }
  }

  async loadPositions(network: NetworkName, agentId: number): Promise<SimPosition[]> {
    const rows = await this.db.select().from(simOptionPositions).where(and(eq(simOptionPositions.network, network), eq(simOptionPositions.agentId, agentId)));
    return rows.map((raw) => {
      const r = PositionRow.parse(raw);
      return {
        id: r.positionId,
        underlying: r.underlying,
        underlyingMarketId: r.underlyingMarketId,
        kind: r.kind,
        strike: r.strike,
        expiryMs: r.expiryAt.getTime(),
        size: r.size,
        premium: r.premium,
        openedAt: r.openedAt.getTime(),
        collateralUsd: r.collateral,
        status: r.status,
        payoutUsd: r.payout,
        settlementPrice: r.settlementPrice,
        settledOnStaleOracle: r.settledOnStaleOracle,
        closedAt: r.closedAt === null ? null : r.closedAt.getTime(),
      };
    });
  }

  async writeQuote(q: QuoteRecord): Promise<void> {
    await this.db
      .insert(simOptionQuotes)
      .values({
        network: q.network,
        provenance: q.provenance,
        agentId: q.agentId,
        quoteId: q.quoteId,
        underlying: q.underlying,
        underlyingMarketId: q.underlyingMarketId,
        kind: q.kind,
        strike: num(q.strike),
        expiryAt: new Date(q.expiryMs),
        spot: num(q.spot),
        spotSource: q.spotSource,
        spotTs: new Date(q.spotTs),
        size: num(q.size),
        delta: q.delta,
        realizedVol: q.realizedVol,
        sigmaFair: q.sigmaFair,
        impliedVol: q.impliedVol,
        fairValue: num(q.fairValue),
        premium: num(q.premium),
        collateral: num(q.collateral),
        outcome: q.outcome,
        at: new Date(q.at),
      })
      .onConflictDoNothing();
  }

  async writePosition(network: NetworkName, agentId: number, p: SimPosition): Promise<void> {
    const values = {
      network,
      provenance: "SIMULATED" as const,
      agentId,
      positionId: p.id,
      underlying: p.underlying,
      underlyingMarketId: p.underlyingMarketId,
      kind: p.kind,
      strike: num(p.strike),
      expiryAt: new Date(p.expiryMs),
      size: num(p.size),
      premium: num(p.premium),
      collateral: num(p.collateralUsd),
      status: p.status,
      payout: p.payoutUsd === null ? null : num(p.payoutUsd),
      settlementPrice: p.settlementPrice === null ? null : num(p.settlementPrice),
      settledOnStaleOracle: p.settledOnStaleOracle,
      openedAt: new Date(p.openedAt),
      closedAt: p.closedAt === null ? null : new Date(p.closedAt),
    };
    await this.db
      .insert(simOptionPositions)
      .values(values)
      .onConflictDoUpdate({
        target: [simOptionPositions.network, simOptionPositions.positionId],
        set: { status: values.status, payout: values.payout, settlementPrice: values.settlementPrice, settledOnStaleOracle: values.settledOnStaleOracle, closedAt: values.closedAt },
      });
  }

  async writeBook(s: BookSnapshot): Promise<void> {
    await this.db
      .insert(simOptionBook)
      .values({
        network: s.network,
        provenance: s.provenance,
        agentId: s.agentId,
        at: new Date(s.at),
        cash: num(s.cash),
        lockedCollateral: num(s.lockedCollateral),
        freeCash: num(s.freeCash),
        premiumCollected: num(s.premiumCollected),
        realizedPnl: num(s.realizedPnl),
        unrealizedPnl: num(s.unrealizedPnl),
        equity: num(s.equity),
        openPositions: s.openPositions,
      })
      .onConflictDoNothing();
  }
}
