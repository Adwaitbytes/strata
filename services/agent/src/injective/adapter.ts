/**
 * ExchangeAdapter implementation for Injective (W3). See services/agent/src/core/exchange.ts for the
 * contract and docs/INJECTIVE.md for every fact this relies on.
 *
 * Data paths:
 *  - Push: Indexer gRPC-web streams (IndexerGrpcDerivativesStreamV2) for L2 orderbook snapshots,
 *    the subaccount's trades (fills) and positions. Reconnect with backoff over every official
 *    endpoint bundle (streams.ts).
 *  - Pull (source of truth, and fallback when a stream is stale): chain exchange v2 gRPC
 *    (chain.ts), chain oracle module with report timestamps (oracle.ts), latest block time (tx.ts).
 * Writes: one `MsgBatchUpdateOrdersV2` per update (cancels + creates in one tx), signed through a
 * KeyHandle (no raw key in this process's adapter state). Optional authz mode wraps every message
 * in MsgExec so a hot key trades a granter's subaccount without withdraw rights (authz.ts).
 */
import { ChainGrpcBankApi, IndexerGrpcDerivativesApi, IndexerGrpcDerivativesStreamV2, MsgAuthzExec, MsgBatchUpdateOrdersV2, MsgDepositV2, getSubaccountId } from "@injectivelabs/sdk-ts";
import type { Msgs } from "@injectivelabs/sdk-ts";
import { getMarkets } from "@strata/config";
import type { KeyHandle, KeySource } from "@strata/keys";
import { evmToInjAddress } from "@strata/keys";
import type { Market, NetworkName, Side } from "@strata/sdk";
import type { BatchResult, BatchUpdate, ExchangeAdapter, FillEvent, L2Level, LiveOrder, MarketState, OraclePoint, PositionState } from "../core/exchange.js";
import { ChainExchange, depositToHuman } from "./chain.js";
import { decodeBatchResponse } from "./decode.js";
import { getEndpointSet } from "./endpoints.js";
import type { EndpointSet } from "./endpoints.js";
import { EvmRpc } from "./evm.js";
import { readOracle } from "./oracle.js";
import { buildLimitOrder, closeOrder } from "./orders.js";
import type { DerivativeOrderParams, MarketSpec } from "./orders.js";
import { ManagedStream } from "./streams.js";
import type { StreamHealth, StreamLogEvent } from "./streams.js";
import { CosmosSigner } from "./tx.js";
import type { BroadcastResult } from "./tx.js";
import { dec, plain, scaleDown } from "./units.js";

type V2Params = Parameters<typeof MsgBatchUpdateOrdersV2.fromJSON>[0];
type V2Order = NonNullable<V2Params["derivativeOrdersToCreate"]>[number];

export interface AdapterLogEvent {
  kind: "stream" | "tx" | "warn";
  detail: string;
  data?: Record<string, string | number | boolean>;
}

export interface InjectiveAdapterOptions {
  network: NetworkName;
  keySource: KeySource;
  /** Key name in the KeySource (e.g. "strata-test-1"). */
  keyName: string;
  subaccountIndex?: number;
  marketIds: readonly string[];
  /** Authz mode: trade this granter's subaccount through MsgExec (see authz.ts). */
  granter?: string;
  /** Open Indexer streams (default true). Tests and one-shot scripts can turn them off. */
  streams?: boolean;
  /** Book data older than this is refreshed from the chain (default 3000 ms). */
  staleBookMs?: number;
  log?: (event: AdapterLogEvent) => void;
}

interface BookCache {
  bids: L2Level[];
  asks: L2Level[];
  atMs: number;
}

interface Cached<T> {
  value: T;
  atMs: number;
}

const ORACLE_TTL_MS = 1_000;
const MARK_TTL_MS = 1_000;
const BLOCK_TTL_MS = 1_000;
const FUNDING_TTL_MS = 60_000;

export class InjectiveAdapter implements ExchangeAdapter {
  readonly network: NetworkName;
  readonly subaccountId: string;
  /** inj1 address that owns the subaccount (the granter in authz mode). */
  readonly address: string;
  /** inj1 address that signs (equals `address` unless authz mode). */
  readonly signerAddress: string;

  private readonly endpoints: EndpointSet;
  private readonly chain: ChainExchange;
  private readonly signer: CosmosSigner;
  private readonly specs: Map<string, Market>;
  private readonly books = new Map<string, BookCache>();
  private readonly oracleCache = new Map<string, Cached<OraclePoint>>();
  private readonly markCache = new Map<string, Cached<string>>();
  private readonly fundingCache = new Map<string, Cached<string | null>>();
  private blockCache: Cached<number> | null = null;
  private readonly firstSeen = new Map<string, number>();
  private readonly fillHandlers = new Set<(fill: FillEvent) => void>();
  private readonly seenTrades = new Set<string>();
  private readonly streams: ManagedStream[] = [];
  private readonly staleBookMs: number;
  private readonly log: (event: AdapterLogEvent) => void;

  constructor(
    private readonly key: KeyHandle,
    private readonly opts: InjectiveAdapterOptions,
  ) {
    this.network = opts.network;
    this.endpoints = getEndpointSet(opts.network);
    this.chain = new ChainExchange(this.endpoints);
    this.signer = new CosmosSigner(this.endpoints, key);
    this.signerAddress = key.injAddress;
    this.address = opts.granter === undefined ? key.injAddress : normalizeInj(opts.granter);
    this.subaccountId = getSubaccountId(this.address, opts.subaccountIndex ?? 0);
    this.staleBookMs = opts.staleBookMs ?? 3_000;
    this.log = opts.log ?? (() => undefined);

    const all = new Map(getMarkets(opts.network).map((m) => [m.marketId.toLowerCase(), m]));
    this.specs = new Map();
    for (const id of opts.marketIds) {
      const m = all.get(id.toLowerCase());
      if (m === undefined) throw new Error(`market ${id} is not in the generated ${opts.network} market list; run pnpm fetch-markets`);
      this.specs.set(m.marketId, m);
    }
  }

  /** Index 0: the default subaccount, funded by the bank balance (no MsgDeposit). */
  get isDefaultSubaccount(): boolean {
    return /^0x[0-9a-fA-F]{40}0{24}$/.test(this.subaccountId);
  }

  get isAuthz(): boolean {
    return this.address !== this.signerAddress;
  }

  spec(marketId: string): Market {
    const m = this.specs.get(marketId) ?? [...this.specs.values()].find((x) => x.marketId.toLowerCase() === marketId.toLowerCase());
    if (m === undefined) throw new Error(`market ${marketId} is not configured on this adapter`);
    return m;
  }

  // ---------------------------------------------------------------- streams

  startStreams(): void {
    const ids = [...this.specs.keys()];
    const logStream = (e: StreamLogEvent): void =>
      this.log({ kind: "stream", detail: `${e.stream} ${e.kind}`, data: { endpoint: e.endpoint, attempt: e.attempt, ...(e.detail === undefined ? {} : { info: e.detail }) } });

    const book: ManagedStream = new ManagedStream(this.endpoints, {
      name: "orderbooks",
      log: logStream,
      // A quiet book pushes nothing; staleness is covered by the chain read in book(), so the
      // watchdog only needs to catch a dead connection.
      idleRestartMs: 10 * 60_000,
      open: (e) =>
        new IndexerGrpcDerivativesStreamV2(e.indexer).streamOrderbooksV2({
          marketIds: ids,
          callback: (r) => {
            book.touch();
            const ob = r.orderbook;
            if (ob === undefined) return;
            const spec = this.specs.get(r.marketId);
            if (spec === undefined) return;
            // Indexer v1 API format: price x 10^quoteDecimals, quantity human (verified live, see units.ts).
            const conv = (l: { price: string; quantity: string }): L2Level => ({ price: scaleDown(l.price, spec.quoteDecimals), quantity: plain(dec(l.quantity)) });
            this.books.set(r.marketId, { bids: ob.buys.map(conv), asks: ob.sells.map(conv), atMs: Date.now() });
          },
        }),
    });

    const trades: ManagedStream = new ManagedStream(this.endpoints, {
      name: "trades",
      log: logStream,
      idleRestartMs: 10 * 60_000,
      onReconnect: () => void this.backfillFills(),
      open: (e) =>
        new IndexerGrpcDerivativesStreamV2(e.indexer).streamTrades({
          marketIds: ids,
          subaccountId: this.subaccountId,
          callback: (r) => {
            trades.touch();
            if (r.trade !== undefined) this.emitTrade(r.trade);
          },
        }),
    });

    const positions: ManagedStream = new ManagedStream(this.endpoints, {
      name: "positions",
      log: logStream,
      idleRestartMs: 10 * 60_000,
      open: (e) =>
        new IndexerGrpcDerivativesStreamV2(e.indexer).streamPositionsV2({
          subaccountId: this.subaccountId,
          callback: () => {
            // Positions are read from the chain in getMarketState; the stream only proves liveness.
            positions.touch();
          },
        }),
    });

    for (const s of [book, trades, positions]) {
      s.start();
      this.streams.push(s);
    }
  }

  streamHealth(): StreamHealth[] {
    return this.streams.map((s) => s.health());
  }

  close(): void {
    for (const s of this.streams) s.close();
    this.streams.length = 0;
  }

  // ---------------------------------------------------------------- fills

  onFill(handler: (fill: FillEvent) => void): () => void {
    this.fillHandlers.add(handler);
    return () => this.fillHandlers.delete(handler);
  }

  private emitTrade(t: {
    tradeId: string;
    marketId: string;
    orderHash: string;
    tradeDirection: string;
    executionPrice: string;
    executionQuantity: string;
    fee: string;
    executionSide: string;
    executedAt: number;
    subaccountId: string;
  }): void {
    if (this.seenTrades.has(t.tradeId)) return;
    const spec = this.specs.get(t.marketId);
    if (spec === undefined || t.subaccountId.toLowerCase() !== this.subaccountId.toLowerCase()) return;
    this.seenTrades.add(t.tradeId);
    if (this.seenTrades.size > 50_000) {
      const first = this.seenTrades.values().next().value;
      if (first !== undefined) this.seenTrades.delete(first);
    }
    // tradeId is "<blockHeight>_<eventIndex>" (observed on mainnet 2026-11-09). The Indexer trade
    // record carries no tx hash, so txHash is left empty and consumers key fills on tradeId.
    const eventIndex = Number(t.tradeId.split("_")[1] ?? "0");
    const side: Side = t.tradeDirection === "buy" || t.tradeDirection === "long" ? "buy" : "sell";
    const fill: FillEvent = {
      marketId: t.marketId,
      orderHash: t.orderHash,
      tradeId: t.tradeId,
      txHash: "",
      eventIndex: Number.isFinite(eventIndex) ? eventIndex : 0,
      side,
      price: scaleDown(t.executionPrice, spec.quoteDecimals),
      quantity: plain(dec(t.executionQuantity)),
      fee: scaleDown(t.fee, spec.quoteDecimals),
      isMaker: t.executionSide === "maker",
      counterpartySubaccountId: null,
      executedAtMs: t.executedAt,
    };
    for (const h of this.fillHandlers) {
      try {
        h(fill);
      } catch (err) {
        this.log({ kind: "warn", detail: `fill handler threw: ${err instanceof Error ? err.message : String(err)}` });
      }
    }
  }

  /** Re-reads recent trades after a stream reconnect so no fill is missed (deduped by tradeId). */
  async backfillFills(limit = 100): Promise<void> {
    const ids = [...this.specs.keys()];
    for (const bundle of this.endpoints.bundles) {
      try {
        const { trades } = await new IndexerGrpcDerivativesApi(bundle.indexer).fetchTrades({ marketIds: ids, subaccountId: this.subaccountId, pagination: { limit } });
        for (const t of [...trades].reverse()) this.emitTrade(t);
        return;
      } catch (err) {
        this.log({ kind: "warn", detail: `fill backfill failed on ${bundle.indexer}: ${err instanceof Error ? err.message : String(err)}` });
      }
    }
  }

  // ---------------------------------------------------------------- reads

  async chainTimeMs(): Promise<number> {
    const now = Date.now();
    if (this.blockCache !== null && now - this.blockCache.atMs < BLOCK_TTL_MS) return this.blockCache.value;
    const { timeMs } = await this.signer.latestBlock();
    if (!Number.isFinite(timeMs)) throw new Error("latest block has no time");
    this.blockCache = { value: timeMs, atMs: now };
    return timeMs;
  }

  private async book(marketId: string): Promise<BookCache> {
    const cached = this.books.get(marketId);
    if (cached !== undefined && Date.now() - cached.atMs <= this.staleBookMs) return cached;
    const ob = await this.chain.orderbook(marketId);
    const fresh = { bids: ob.bids, asks: ob.asks, atMs: Date.now() };
    this.books.set(marketId, fresh);
    return fresh;
  }

  private async oracle(spec: Market): Promise<OraclePoint> {
    const c = this.oracleCache.get(spec.marketId);
    if (c !== undefined && Date.now() - c.atMs < ORACLE_TTL_MS) return c.value;
    let last: unknown;
    for (const b of this.endpoints.bundles) {
      try {
        const r = await readOracle(b.grpc, spec);
        const point: OraclePoint = { price: r.price, timestampMs: r.timestampMs, source: r.source };
        this.oracleCache.set(spec.marketId, { value: point, atMs: Date.now() });
        return point;
      } catch (err) {
        last = err;
      }
    }
    throw last instanceof Error ? last : new Error(String(last));
  }

  private async markPrice(marketId: string): Promise<string> {
    const c = this.markCache.get(marketId);
    if (c !== undefined && Date.now() - c.atMs < MARK_TTL_MS) return c.value;
    const m = await this.chain.market(marketId);
    this.markCache.set(marketId, { value: m.markPrice, atMs: Date.now() });
    return m.markPrice;
  }

  /** Last applied hourly funding rate from the Indexer funding history, null if unavailable. */
  private async fundingRate(marketId: string): Promise<string | null> {
    const c = this.fundingCache.get(marketId);
    if (c !== undefined && Date.now() - c.atMs < FUNDING_TTL_MS) return c.value;
    let value: string | null = null;
    for (const b of this.endpoints.bundles) {
      try {
        const r = await new IndexerGrpcDerivativesApi(b.indexer).fetchFundingRates({ marketId, pagination: { limit: 1 } });
        const rate = r.fundingRates[0]?.rate;
        value = rate === undefined ? null : plain(dec(rate));
        break;
      } catch {
        continue;
      }
    }
    this.fundingCache.set(marketId, { value, atMs: Date.now() });
    return value;
  }

  async availableQuote(spec: Market): Promise<string> {
    if (this.isDefaultSubaccount) {
      // Subaccount 0 trades from the bank balance (see depositToSubaccount); the chain deposit
      // query returns zero for it, verified on testnet 2026-11-09 with 20 USDC in the bank.
      return this.bankBalance(spec.quoteDenom, spec.quoteDecimals);
    }
    const raw = await this.chain.depositRaw(this.subaccountId, spec.quoteDenom);
    return depositToHuman(raw.available, spec.quoteDecimals);
  }

  async bankBalance(denom: string, decimals: number): Promise<string> {
    let last: unknown;
    for (const b of this.endpoints.bundles) {
      try {
        const coin = await new ChainGrpcBankApi(b.grpc).fetchBalance({ accountAddress: this.address, denom });
        return scaleDown(coin.amount, decimals);
      } catch (err) {
        last = err;
      }
    }
    throw last instanceof Error ? last : new Error(String(last));
  }

  async getMarketState(marketId: string): Promise<MarketState> {
    const spec = this.spec(marketId);
    const [book, oracle, mark, chainTimeMs, pos, availableQuote, fundingRate] = await Promise.all([
      this.book(spec.marketId),
      this.oracle(spec),
      this.markPrice(spec.marketId),
      this.chainTimeMs(),
      this.chain.position(spec.marketId, this.subaccountId),
      this.availableQuote(spec),
      this.fundingRate(spec.marketId),
    ]);

    let position: PositionState = { quantity: "0", entryPrice: null, margin: "0", unrealizedPnl: "0" };
    let marginRatio: number | null = null;
    if (pos !== null) {
      const signed = pos.isLong ? dec(pos.quantity) : dec(pos.quantity).neg();
      const upnl = dec(mark).minus(pos.entryPrice).mul(signed);
      position = { quantity: plain(signed), entryPrice: pos.entryPrice, margin: pos.margin, unrealizedPnl: plain(upnl) };
      const maintenance = dec(pos.quantity).mul(mark).mul(spec.maintenanceMarginRatio);
      if (maintenance.gt(0)) marginRatio = dec(pos.margin).plus(upnl).div(maintenance).toNumber();
    }

    return {
      marketId: spec.marketId,
      bids: book.bids,
      asks: book.asks,
      oracle,
      reference: null,
      markPrice: mark,
      chainTimeMs,
      position,
      availableQuote,
      fundingRate,
      marginRatio,
    };
  }

  async getOpenOrders(marketId: string): Promise<LiveOrder[]> {
    const spec = this.spec(marketId);
    const orders = await this.chain.openOrders(spec.marketId, this.subaccountId);
    const now = Date.now();
    const live = new Set<string>();
    const out = orders.map((o) => {
      live.add(o.orderHash);
      if (!this.firstSeen.has(o.orderHash)) this.firstSeen.set(o.orderHash, now);
      return {
        orderHash: o.orderHash,
        side: (o.isBuy ? "buy" : "sell") as Side,
        price: o.price,
        quantity: o.quantity,
        filled: plain(dec(o.quantity).minus(o.fillable)),
        // The chain does not expose creation time; this is when this adapter first saw the order.
        createdAtMs: this.firstSeen.get(o.orderHash) ?? now,
      };
    });
    for (const h of this.firstSeen.keys()) if (!live.has(h) && now - (this.firstSeen.get(h) ?? 0) > 3_600_000) this.firstSeen.delete(h);
    return out;
  }

  // ---------------------------------------------------------------- writes

  private wrap(msg: Msgs): Msgs {
    return this.isAuthz ? MsgAuthzExec.fromJSON({ grantee: this.signerAddress, msgs: msg }) : msg;
  }

  private toV2(o: DerivativeOrderParams): V2Order {
    // The sdk-ts V2 order type is the exchange v2 proto OrderType enum, re-declared inside the
    // sdk-ts bundle. Same numeric values (BUY=1, SELL=2, BUY_PO=7, SELL_PO=8), so the cast is exact.
    return { ...o, orderType: o.orderType as unknown as V2Order["orderType"] };
  }

  private async broadcast(msg: Msgs, memo: string): Promise<BroadcastResult> {
    const res = await this.signer.broadcast(this.wrap(msg), { memo });
    this.log({ kind: "tx", detail: memo, data: { txHash: res.txHash, height: res.height, gasUsed: res.gasUsed } });
    return res;
  }

  async batchUpdate(update: BatchUpdate): Promise<BatchResult> {
    const spec = this.spec(update.marketId);
    const feeRecipient = normalizeInj(update.feeRecipient);
    const mark = update.create.some((o) => !o.reduceOnly) ? await this.markPrice(spec.marketId) : null;

    const rejected: { cid: string; reason: string }[] = [];
    const creates: V2Order[] = [];
    const cidOrder: string[] = [];
    for (const o of update.create) {
      const built = buildLimitOrder(spec as MarketSpec, o, { markPrice: mark, feeRecipient });
      if (!built.ok) {
        rejected.push({ cid: built.cid, reason: built.reason });
        continue;
      }
      creates.push(this.toV2(built.order));
      cidOrder.push(o.cid);
    }
    if (creates.length === 0 && update.cancelOrderHashes.length === 0) {
      return { txHash: "", createdOrderHashes: [], rejected };
    }

    const msg = MsgBatchUpdateOrdersV2.fromJSON({
      injectiveAddress: this.address,
      subaccountId: this.subaccountId,
      derivativeOrdersToCancel: update.cancelOrderHashes.map((orderHash) => ({ marketId: spec.marketId, subaccountId: this.subaccountId, orderHash })),
      derivativeOrdersToCreate: creates,
    });
    const res = await this.broadcast(msg, "strata:batch");
    const decoded = decodeBatchResponse(res.data);
    if (decoded !== null) {
      for (const cid of decoded.failedDerivativeOrdersCids) rejected.push({ cid, reason: "rejected by chain (post-only would cross, margin, or market rules)" });
    }
    const createdOrderHashes = (decoded?.derivativeOrderHashes ?? []).filter((h) => h.length > 0);
    return { txHash: res.txHash, createdOrderHashes, rejected };
  }

  async cancelAll(marketId: string): Promise<void> {
    const spec = this.spec(marketId);
    const msg = MsgBatchUpdateOrdersV2.fromJSON({
      injectiveAddress: this.address,
      subaccountId: this.subaccountId,
      derivativeMarketIdsToCancelAll: [spec.marketId],
    });
    await this.broadcast(msg, "strata:cancel-all");
  }

  async closePositionReduceOnly(marketId: string): Promise<void> {
    const spec = this.spec(marketId);
    const pos = await this.chain.position(spec.marketId, this.subaccountId);
    if (pos === null) return;
    const mark = await this.markPrice(spec.marketId);
    const order = closeOrder(spec as MarketSpec, {
      positionQty: pos.quantity,
      isLong: pos.isLong,
      markPrice: mark,
      feeRecipient: this.signerAddress,
      cid: `close-${Date.now()}`,
    });
    if (order === null) return;
    const msg = MsgBatchUpdateOrdersV2.fromJSON({
      injectiveAddress: this.address,
      subaccountId: this.subaccountId,
      derivativeMarketIdsToCancelAll: [spec.marketId],
      derivativeMarketOrdersToCreate: [this.toV2(order)],
    });
    await this.broadcast(msg, "strata:close-reduce-only");
  }

  /** Moves `amount` (human units) of `denom` from the bank balance into the trading subaccount. */
  async depositToSubaccount(amount: string, denom: string, decimals: number): Promise<BroadcastResult> {
    if (this.isAuthz) throw new Error("deposits are made by the granter, not the authz hot key");
    // Exchange v2 rejects MsgDeposit into the default subaccount (index 0): it trades straight from
    // the bank balance. Source: InjectiveLabs/sdk-go chain/exchange/types/v2/msgs.go MsgDeposit.ValidateBasic.
    if (this.isDefaultSubaccount) throw new Error("subaccount 0 uses the bank balance directly; no deposit needed");
    const chainAmount = plain(dec(amount).mul(dec(10).pow(decimals)).floor());
    const msg = MsgDepositV2.fromJSON({ injectiveAddress: this.address, subaccountId: this.subaccountId, amount: { denom, amount: chainAmount } });
    return this.broadcast(msg, "strata:deposit");
  }

  /**
   * PRD 4.4: a fresh account that never sent a tx has no pubkey on chain. Our signer supplies the
   * pubkey itself, but we still prime with one tiny EVM self-transfer when the account has no
   * pubkey, matching the documented workaround. Returns the EVM tx hash, or null if not needed.
   */
  async primeAccountIfNeeded(): Promise<string | null> {
    const acct = await this.signer.refreshAccount();
    if (acct.sequence > 0) return null;
    const evm = new EvmRpc(this.network);
    const hash = await evm.sendLegacy(this.key, { to: this.key.evmAddress, value: 0n, gasLimit: 21_000n });
    await evm.waitForReceipt(hash, 60_000).catch(() => null);
    await this.signer.refreshAccount();
    return hash;
  }
}

function normalizeInj(addr: string): string {
  if (/^inj1[02-9ac-hj-np-z]{38}$/.test(addr)) return addr;
  if (/^0x[0-9a-fA-F]{40}$/.test(addr)) return evmToInjAddress(addr);
  throw new Error(`invalid address ${addr}`);
}


export async function createInjectiveAdapter(opts: InjectiveAdapterOptions): Promise<InjectiveAdapter> {
  const key = await opts.keySource.load(opts.keyName);
  const adapter = new InjectiveAdapter(key, opts);
  if (opts.streams !== false) adapter.startStreams();
  return adapter;
}
