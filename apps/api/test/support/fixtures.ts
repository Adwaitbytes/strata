/** Schema-valid fixtures. Values are arbitrary test inputs, never shown anywhere. */
import type { AgentProfile, BookSnapshot, EpochAttestation, EpochScore, GuardEvent, Market, Quote, TunerEvent } from "@strata/sdk";

export const NOW = 1_800_000_000_000;
export const MARKET_A = `0x${"a".repeat(64)}`;
export const MARKET_B = `0x${"b".repeat(64)}`;
export const HEX32 = (c: string) => `0x${c.repeat(64)}`;

export function market(marketId = MARKET_A, symbol = "TEST/USDT"): Market {
  return {
    network: "testnet",
    marketId,
    ticker: `${symbol} PERP`,
    symbol,
    assetClass: "equity",
    quoteDenom: "peggy0xtest",
    quoteDecimals: 6,
    oracleType: "pyth",
    oracleBase: "base",
    oracleQuote: "quote",
    minPriceTickSize: "0.01",
    minQuantityTickSize: "0.001",
    minNotional: "1",
    makerFeeRate: "-0.0001",
    takerFeeRate: "0.0005",
    initialMarginRatio: "0.05",
    maintenanceMarginRatio: "0.02",
    isPerpetual: true,
    arenaEnabled: true,
    maxSpreadBps: 50,
    minDepthUsd: 1000,
    fetchedAt: NOW - 3_600_000,
    source: "https://example.test/indexer",
  };
}

export function book(marketId = MARKET_A, at = NOW - 2_000, over: Partial<BookSnapshot> = {}): BookSnapshot {
  return {
    network: "testnet",
    provenance: "TESTNET",
    marketId,
    bids: [{ price: "99.9", quantity: "10", strataQuantity: "4" }],
    asks: [{ price: "100.1", quantity: "12", strataQuantity: "5" }],
    mid: "100",
    spreadBps: 20,
    depthUsd25: 2200,
    strataDepthUsd25: 900,
    oraclePrice: "100.02",
    oracleTimestamp: at - 1_000,
    sessionState: "open",
    at,
    ...over,
  };
}

export function agent(agentId = 1, over: Partial<AgentProfile> = {}): AgentProfile {
  return {
    network: "testnet",
    agentId,
    name: `house-${agentId}`,
    kind: "house",
    operator: `0x${"1".repeat(40)}`,
    injAddress: "inj1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
    subaccountId: HEX32("c"),
    erc8004Id: null,
    metadataURI: "",
    marketIds: [MARKET_A],
    status: "active",
    statusReason: null,
    enrolledAt: NOW - 86_400_000,
    simulated: false,
    ...over,
  };
}

export function quote(agentId = 1, postedAt = NOW - 1_000): Quote {
  return {
    network: "testnet",
    provenance: "TESTNET",
    agentId,
    marketId: MARKET_A,
    orderHash: `0x${agentId}${postedAt}`,
    side: "buy",
    price: "99.9",
    quantity: "1",
    level: 0,
    postedAt,
    cancelledAt: null,
  };
}

export function score(agentId: number, epoch: number, value: number, season = 0): EpochScore {
  return {
    network: "testnet",
    provenance: "TESTNET",
    season,
    epoch,
    agentId,
    score: value,
    metrics: {
      quotedSpreadBps: 12,
      depthUsd25: 5000,
      uptimeBps: 9500,
      bookShare: 0.3,
      markout60s: 0.1,
      pnlUsd: 3.5,
      maxDrawdownUsd: 1,
      spreadImprovementBps: 4,
      samples: 720,
    },
    flags: 0,
    flagNames: [],
    leaf: HEX32("d"),
    proof: [HEX32("e")],
  };
}

export function attestation(season = 0, epoch = 1, posted = true): EpochAttestation {
  return {
    network: "testnet",
    season,
    epoch,
    startTime: NOW - 7_200_000,
    endTime: NOW - 3_600_000,
    merkleRoot: HEX32("f"),
    dataURI: "https://example.test/epoch.json",
    txHash: posted ? HEX32("9") : null,
    postedAt: posted ? NOW - 3_000_000 : null,
    contract: `0x${"2".repeat(40)}`,
  };
}

export function guardEvent(at = NOW - 5_000, id = "g1"): GuardEvent {
  return {
    network: "testnet",
    provenance: "TESTNET",
    id,
    agentId: 1,
    marketId: MARKET_A,
    guard: "oracle",
    action: "widen",
    reason: "oracle_stale",
    detail: "Oracle price older than limit",
    observed: { oracleAgeSec: 41, limit: 30 },
    at,
  };
}

export function tunerEvent(at = NOW - 4_000, id = "t1"): TunerEvent {
  const params = { gamma: 0.1, minHalfSpreadBps: 5, levels: 3, sizeMultiplier: 1, offHoursQuoting: false };
  return {
    network: "testnet",
    id,
    agentId: 1,
    marketId: MARKET_A,
    mode: "shadow",
    model: "test-model",
    before: params,
    suggested: { ...params, gamma: 0.12 },
    applied: null,
    clamped: [],
    rationale: "Volatility rose",
    rejected: false,
    rejectReason: null,
    at,
  };
}
