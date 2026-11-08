/**
 * Chain exchange v2 reads (injective.exchange.v2.Query over gRPC-web, generated client from
 * @injectivelabs/core-proto-ts-v2). All numeric fields are cosmos `Dec` integers scaled by 10^18
 * of the HUMAN value in exchange v2 (verified live 2026-11-09: testnet BTC/USDC orderbook level
 * p=63272000000000000000000 is 63272 USDC; mark price 75864038829348164004281 is 75864.04).
 * Exception: subaccount deposits stay in the token's native decimals (Exchange.sol notes deposits
 * are CHAIN FORMAT), so they are scaled down by quote decimals as well. See `depositToHuman`.
 */
import { GrpcWebFetchTransport } from "@protobuf-ts/grpcweb-transport";
import { QueryClient } from "@injectivelabs/core-proto-ts-v2/generated/injective/exchange/v2/query_pb.client";
import type { EndpointSet } from "./endpoints.js";
import { backoffDelay, sleep } from "./retry.js";
import { dec, decFromChain, plain } from "./units.js";

export interface HumanLevel {
  price: string;
  quantity: string;
}

export interface ChainOrder {
  orderHash: string;
  cid: string;
  isBuy: boolean;
  price: string;
  quantity: string;
  fillable: string;
  margin: string;
}

export interface ChainPosition {
  isLong: boolean;
  quantity: string;
  entryPrice: string;
  margin: string;
}

export interface ChainMarketState {
  markPrice: string;
  hourlyFundingRateCap: string;
  hourlyInterestRate: string;
  nextFundingTimestampSec: number;
}

export class ChainExchange {
  private readonly clients: QueryClient[];

  constructor(set: EndpointSet, private readonly timeoutMs = 5_000) {
    this.clients = set.bundles.map((b) => new QueryClient(new GrpcWebFetchTransport({ baseUrl: b.grpc })));
  }

  private async call<T>(fn: (c: QueryClient) => Promise<T>): Promise<T> {
    let last: unknown;
    for (let i = 0; i < this.clients.length * 2; i++) {
      const c = this.clients[i % this.clients.length];
      if (c === undefined) break;
      try {
        return await fn(c);
      } catch (err) {
        last = err;
        if (i + 1 < this.clients.length * 2) await sleep(backoffDelay(i, 100, 1_000));
      }
    }
    throw last instanceof Error ? last : new Error(String(last));
  }

  private get opts() {
    return { timeout: this.timeoutMs };
  }

  async orderbook(marketId: string, depth = 20): Promise<{ bids: HumanLevel[]; asks: HumanLevel[]; seq: bigint }> {
    const r = await this.call(async (c) => (await c.derivativeOrderbook({ marketId, limit: BigInt(depth), limitCumulativeNotional: "" }, this.opts)).response);
    const conv = (l: { p: string; q: string }): HumanLevel => ({ price: decFromChain(l.p), quantity: decFromChain(l.q) });
    return { bids: r.buysPriceLevel.map(conv), asks: r.sellsPriceLevel.map(conv), seq: r.seq };
  }

  async market(marketId: string): Promise<ChainMarketState> {
    const r = await this.call(async (c) => (await c.derivativeMarket({ marketId }, this.opts)).response);
    const m = r.market;
    if (m === undefined) throw new Error(`market ${marketId} not found on chain`);
    const info = m.info.oneofKind === "perpetualInfo" ? m.info.perpetualInfo.marketInfo : undefined;
    return {
      markPrice: decFromChain(m.markPrice),
      hourlyFundingRateCap: info === undefined ? "0" : decFromChain(info.hourlyFundingRateCap),
      hourlyInterestRate: info === undefined ? "0" : decFromChain(info.hourlyInterestRate),
      nextFundingTimestampSec: info === undefined ? 0 : Number(info.nextFundingTimestamp),
    };
  }

  async openOrders(marketId: string, subaccountId: string): Promise<ChainOrder[]> {
    const r = await this.call(async (c) => (await c.traderDerivativeOrders({ marketId, subaccountId }, this.opts)).response);
    return r.orders.map((o: { orderHash: string; cid: string; isBuy: boolean; price: string; quantity: string; fillable: string; margin: string }) => ({
      orderHash: o.orderHash,
      cid: o.cid,
      isBuy: o.isBuy,
      price: decFromChain(o.price),
      quantity: decFromChain(o.quantity),
      fillable: decFromChain(o.fillable),
      margin: decFromChain(o.margin),
    }));
  }

  async position(marketId: string, subaccountId: string): Promise<ChainPosition | null> {
    const r = await this.call(async (c) => (await c.subaccountPositionInMarket({ subaccountId, marketId }, this.opts)).response);
    const s = r.state;
    if (s === undefined || dec(s.quantity).isZero()) return null;
    return { isLong: s.isLong, quantity: decFromChain(s.quantity), entryPrice: decFromChain(s.entryPrice), margin: decFromChain(s.margin) };
  }

  /** Raw deposit Dec strings for a denom (see depositToHuman). */
  async depositRaw(subaccountId: string, denom: string): Promise<{ available: string; total: string }> {
    const r = await this.call(async (c) => (await c.subaccountDeposit({ subaccountId, denom }, this.opts)).response);
    return { available: r.deposits?.availableBalance ?? "0", total: r.deposits?.totalBalance ?? "0" };
  }
}

/** Deposit Dec (10^18) of an amount in native token units -> human. */
export function depositToHuman(raw: string, tokenDecimals: number): string {
  return plain(dec(decFromChain(raw)).div(dec(10).pow(tokenDecimals)));
}
