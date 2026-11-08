import { readFileSync } from "node:fs";
import { scoreAttestorAbi, strataArenaAbi } from "@strata/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Hex } from "viem";
import type { DbHandle } from "@strata/db";
import { freshTestDb, hasTestDb } from "../../test/db.js";
import { BlockscoutClient, type BlockscoutLog, type FetchFn } from "./blockscout.js";
import { parseDeployment } from "./contracts.js";
import { decodeArenaLog } from "./decode.js";
import { ArenaPoller } from "./poller.js";
import { arenaMarketIds } from "./project.js";

/**
 * Arena contracts are not deployed yet, so arena logs are built with viem from the committed ABIs
 * and wrapped in the exact envelope of a recorded testnet Blockscout getLogs response.
 */
const recorded = JSON.parse(readFileSync(new URL("../../test/fixtures/blockscout.getLogs.testnet.json", import.meta.url), "utf8")) as {
  response: { status: string; message: string; result: Record<string, unknown>[] };
};
const envelope = recorded.response.result[0]!;

const ARENA = "0x1111111111111111111111111111111111111111";
const ATTESTOR = "0x2222222222222222222222222222222222222222";
const OPERATOR = "0xdc6f17bbec824fff8f86587966b2047db6ab7367";
const SUB = `0x${"dc6f17bbec824fff8f86587966b2047db6ab7367"}${"0".repeat(23)}1` as Hex;
const MARKET = `0x${"ab".repeat(32)}` as Hex;
const ROOT = `0x${"cd".repeat(32)}` as Hex;

function rawLog(address: string, topics: (Hex | null)[], data: Hex, block: number, logIndex: number, tx: string): Record<string, unknown> {
  return { ...envelope, address, topics: [...topics, ...Array(Math.max(0, 4 - topics.length)).fill(null)], data, blockNumber: `0x${block.toString(16)}`, logIndex: `0x${logIndex.toString(16)}`, timeStamp: `0x${(1_794_000_000 + block).toString(16)}`, transactionHash: tx };
}

function arenaLog(event: string, args: Record<string, unknown>, nonIndexed: { type: string; value: unknown }[], block: number, logIndex: number, tx: string) {
  const topics = encodeEventTopics({ abi: strataArenaAbi, eventName: event as never, args: args as never }) as Hex[];
  const data = nonIndexed.length ? encodeAbiParameters(nonIndexed.map((p) => ({ type: p.type })), nonIndexed.map((p) => p.value)) : "0x";
  return rawLog(ARENA, topics, data, block, logIndex, tx);
}

const TX1 = `0x${"01".repeat(32)}`;
const TX2 = `0x${"02".repeat(32)}`;
const TX3 = `0x${"03".repeat(32)}`;
const logs = [
  arenaLog("SeasonStarted", { season: 1n }, [{ type: "uint64", value: 1_765_000_000n }, { type: "uint64", value: 1_765_086_400n }, { type: "uint32", value: 3600 }], 100, 0, TX1),
  arenaLog("MarketSet", { marketId: MARKET }, [{ type: "bool", value: true }, { type: "uint16", value: 50 }, { type: "uint32", value: 5000 }, { type: "string", value: "XAU/USDC PERP" }], 100, 1, TX1),
  arenaLog("AgentEnrolled", { agentId: 1n, operator: OPERATOR, erc8004Id: 7n }, [{ type: "bytes32", value: SUB }, { type: "uint64", value: 1n }, { type: "string", value: "ipfs://meta" }], 101, 0, TX2),
  arenaLog("AgentSuspended", { agentId: 1n }, [{ type: "string", value: "wash trading" }], 102, 0, TX3),
];
const attestorTopics = encodeEventTopics({ abi: scoreAttestorAbi, eventName: "EpochPosted", args: { season: 1n, epoch: 2n } }) as Hex[];
const attestorLogs = [rawLog(ATTESTOR, attestorTopics, encodeAbiParameters([{ type: "bytes32" }, { type: "string" }], [ROOT, "https://api/v1/epochs/1/2"]), 103, 0, `0x${"04".repeat(32)}`)];

function fakeFetch(head: number, byAddress: Record<string, Record<string, unknown>[]>): FetchFn {
  return async (url) => {
    const q = new URL(url).searchParams;
    if (q.get("action") === "eth_block_number") return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", result: `0x${head.toString(16)}`, id: 1 }) };
    const from = Number(q.get("fromBlock"));
    const to = Number(q.get("toBlock"));
    const result = (byAddress[q.get("address") ?? ""] ?? []).filter((l) => {
      const b = Number.parseInt(String(l.blockNumber), 16);
      return b >= from && b <= to;
    });
    return { ok: true, status: 200, json: async () => (result.length ? { status: "1", message: "OK", result } : { status: "0", message: "No logs found", result: [] }) };
  };
}

describe("Blockscout client", () => {
  it("parses the recorded getLogs envelope (hex fields, null topics)", async () => {
    const client = new BlockscoutClient("https://example.test/api", async () => ({ ok: true, status: 200, json: async () => recorded.response }));
    const out = await client.getLogs("0x0000000000000000000000000000000000000800", 0, 1);
    expect(out[0]?.blockNumber).toBe(0x8ccf5c6);
    expect(out[0]?.logIndex).toBe(0);
    expect(out[0]?.topics[2]).toBeNull();
  });
  it("treats 'No logs found' as empty and other status 0 as an error", async () => {
    const empty = new BlockscoutClient("https://x/api", async () => ({ ok: true, status: 200, json: async () => ({ status: "0", message: "No logs found", result: [] }) }));
    expect(await empty.getLogs("0x", 0, 1)).toEqual([]);
    const bad = new BlockscoutClient("https://x/api", async () => ({ ok: true, status: 200, json: async () => ({ status: "0", message: "NOTOK", result: "rate limited" }) }));
    await expect(bad.getLogs("0x", 0, 1)).rejects.toThrow(/NOTOK/);
  });
  it("builds the API base from the explorer URL", () => {
    expect(BlockscoutClient.forExplorer("https://testnet.blockscout.injective.network/").apiBase).toBe("https://testnet.blockscout.injective.network/api");
  });
});

describe("decodeArenaLog", () => {
  it("decodes AgentEnrolled with JSON-safe args", async () => {
    const client = new BlockscoutClient("https://x/api", fakeFetch(200, { [ARENA]: logs }));
    const parsed: BlockscoutLog[] = await client.getLogs(ARENA, 0, 200);
    const e = decodeArenaLog(parsed[2]!, "arena");
    expect(e?.event).toBe("AgentEnrolled");
    expect(e?.args).toMatchObject({ agentId: "1", erc8004Id: "7", metadataURI: "ipfs://meta", season: "1" });
    expect(String(e?.args.operator).toLowerCase()).toBe(OPERATOR);
  });
  it("returns null for foreign logs", async () => {
    const client = new BlockscoutClient("https://x/api", async () => ({ ok: true, status: 200, json: async () => recorded.response }));
    const [foreign] = await client.getLogs("0x", 0, 1);
    expect(decodeArenaLog(foreign!, "arena")).toBeNull();
  });
});

describe("parseDeployment", () => {
  it("reads the real W1 testnet deployment file (contract entries, not the attestor EOA)", () => {
    const real = JSON.parse(readFileSync(new URL("../../test/fixtures/deployments.testnet.json", import.meta.url), "utf8")) as unknown;
    expect(parseDeployment(real)).toEqual({
      arena: "0x33d6c1239e15d3a5875d9ef1351eb6b583731f24",
      attestor: "0x1332434661332088379a98f821bd19eb2b1d8282",
      deployBlock: 147650528,
    });
  });
  it("accepts flat contract-named keys", () => {
    expect(parseDeployment({ StrataArena: ARENA, ScoreAttestor: ATTESTOR, deployBlock: 5 })).toEqual({ arena: ARENA, attestor: ATTESTOR, deployBlock: 5 });
  });
});

describe.skipIf(!hasTestDb)("ArenaPoller (local TimescaleDB)", () => {
  let h: DbHandle;
  beforeAll(async () => {
    h = await freshTestDb("strata_w4_arena_test");
    await h.sql`INSERT INTO markets (network, market_id, ticker, data, fetched_at) VALUES ('testnet', ${MARKET}, 'XAU/USDC PERP', '{}'::jsonb, now())`;
  }, 60_000);
  afterAll(async () => h?.close());

  const contracts = { arena: ARENA, attestor: ATTESTOR, deployBlock: 90 } as const;

  it("projects agents, markets and epochs, and is idempotent across replays", async () => {
    const client = new BlockscoutClient("https://x/api", fakeFetch(200, { [ARENA]: logs, [ATTESTOR]: attestorLogs }));
    const first = await new ArenaPoller("testnet", h.sql, client, contracts, { window: 3 }).pollOnce();
    expect(first.inserted).toBe(5);

    const [agent] = await h.sql`SELECT agent_id, operator, subaccount_id, erc8004_id, status, status_reason, inj_address FROM agents WHERE network = 'testnet'`;
    expect(agent).toMatchObject({ agent_id: 1, operator: OPERATOR, subaccount_id: SUB, erc8004_id: "7", status: "suspended", status_reason: "wash trading" });
    expect(String(agent?.inj_address)).toMatch(/^inj1/);
    const [market] = await h.sql`SELECT arena_enabled FROM markets WHERE market_id = ${MARKET}`;
    expect(market?.arena_enabled).toBe(true);
    expect(await arenaMarketIds(h.sql, "testnet")).toEqual([MARKET]);
    const [epoch] = await h.sql`SELECT merkle_root, start_time, end_time FROM epochs WHERE season = 1 AND epoch = 2`;
    expect(epoch?.merkle_root).toBe(ROOT);
    expect((epoch?.start_time as Date).getTime()).toBe((1_765_000_000 + 2 * 3600) * 1000);

    // Replay from scratch (cursor reset, as a backfill would) inserts nothing new.
    await h.sql`DELETE FROM indexer_cursors`;
    const replay = await new ArenaPoller("testnet", h.sql, client, contracts).pollOnce();
    expect(replay.inserted).toBe(0);
    expect(replay.duplicates).toBe(5);
    const [{ n }] = (await h.sql`SELECT count(*)::int AS n FROM arena_events`) as unknown as [{ n: number }];
    expect(n).toBe(5);
    const [again] = await h.sql`SELECT status FROM agents WHERE agent_id = 1`;
    expect(again?.status).toBe("suspended");
  });

  it("resumes from the cursor", async () => {
    const client = new BlockscoutClient("https://x/api", fakeFetch(200, { [ARENA]: logs, [ATTESTOR]: attestorLogs }));
    const r = await new ArenaPoller("testnet", h.sql, client, contracts).pollOnce();
    expect(r.inserted + r.duplicates).toBe(0);
  });
});
