import { describe, expect, it } from "vitest";
import { Market } from "@strata/sdk";
import { getMarkets } from "@strata/config";
import { marketCandidate } from "../src/repo/mappers.js";

type MarketRow = Parameters<typeof marketCandidate>[0];

// Shape the W4 indexer writes to markets.data (services/indexer/src/store/writes.ts upsertMarkets).
function indexerRow(network: "mainnet" | "testnet", marketId: string, ticker: string): MarketRow {
  return {
    network,
    marketId,
    ticker,
    arenaEnabled: true,
    fetchedAt: new Date(1_794_000_000_000),
    data: {
      assetClass: "crypto",
      quoteDecimals: 6,
      oracleType: "pythpro",
      oracleBase: "x",
      oracleQuote: "y",
      oracleScaleFactor: 6,
      source: "https://sentry.exchange.grpc-web.injective.network IndexerGrpcDerivativesApi.fetchMarkets",
      indexer: { marketId, ticker },
    },
  };
}

describe("marketCandidate", () => {
  it("completes a partial indexer row from the verified config record", () => {
    const verified = getMarkets("testnet")[0];
    if (!verified) throw new Error("config has no testnet markets");
    const parsed = Market.safeParse(marketCandidate(indexerRow("testnet", verified.marketId, verified.ticker)));
    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject({
      marketId: verified.marketId,
      symbol: verified.symbol,
      source: verified.source,
      arenaEnabled: true,
      fetchedAt: 1_794_000_000_000,
    });
  });

  it("keeps a full stored record as written", () => {
    const verified = getMarkets("mainnet")[0];
    if (!verified) throw new Error("config has no mainnet markets");
    const row = { ...indexerRow("mainnet", verified.marketId, verified.ticker), data: { ...verified, maxSpreadBps: 25 } };
    expect(Market.parse(marketCandidate(row)).maxSpreadBps).toBe(25);
  });

  it("leaves an unknown partial row invalid so it is dropped, not invented", () => {
    const id = `0x${"ab".repeat(32)}`;
    expect(Market.safeParse(marketCandidate(indexerRow("testnet", id, "NEW/USDC PERP"))).success).toBe(false);
  });
});
