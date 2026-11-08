/**
 * zod schemas for the Indexer records the live indexer consumes (shapes recorded from mainnet via
 * sdk-ts IndexerGrpcDerivativesApi fetchTrades / fetchOrders / fetchPositionsV2 on 2026-11-09,
 * test/fixtures/derivatives.mainnet.xau.json). Stream payloads use the same transformers.
 * Units: prices, margins and fees in chain format (x 10^quoteDecimals); quantities human.
 */
import { z } from "zod";

const Num = z.union([z.string(), z.number()]).transform((v) => String(v));
const Ms = z.union([z.number(), z.bigint(), z.string()]).transform((v) => Number(v));

export const IndexerTrade = z.object({
  tradeId: z.string().min(1),
  marketId: z.string(),
  orderHash: z.string(),
  subaccountId: z.string(),
  executedAt: Ms,
  executionPrice: Num,
  executionQuantity: Num,
  tradeDirection: z.enum(["buy", "sell"]),
  executionSide: z.string(),
  fee: Num,
});
export type IndexerTrade = z.infer<typeof IndexerTrade>;

export const IndexerOrder = z.object({
  orderHash: z.string(),
  marketId: z.string(),
  subaccountId: z.string(),
  cid: z.string().default(""),
  orderSide: z.string(),
  price: Num,
  quantity: Num,
  unfilledQuantity: Num,
  state: z.string(),
  createdAt: Ms,
  updatedAt: Ms,
});
export type IndexerOrder = z.infer<typeof IndexerOrder>;

export const IndexerPosition = z.object({
  marketId: z.string(),
  subaccountId: z.string(),
  direction: z.string(),
  quantity: Num,
  entryPrice: Num,
  margin: Num,
  markPrice: Num.optional(),
  updatedAt: Ms.optional(),
});
export type IndexerPosition = z.infer<typeof IndexerPosition>;
