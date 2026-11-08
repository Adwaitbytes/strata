/**
 * Blockscout Etherscan-compatible RPC API client (`/api?module=...`).
 * Base URL = the verified explorer URL from CLAUDE.md / PRD 4.3 plus `api`:
 *   mainnet https://blockscout.injective.network/api, testnet https://testnet.blockscout.injective.network/api
 * Both answered `module=block&action=eth_block_number` and `module=logs&action=getLogs` live on
 * 2026-11-09. (The `blockscout-api.*` hosts in @strata/config `explorerApi` did not resolve.)
 */
import { z } from "zod";

const HexNum = z.string().regex(/^0x[0-9a-fA-F]*$/).transform((h) => (h === "0x" ? 0 : Number.parseInt(h, 16)));

export const BlockscoutLog = z.object({
  address: z.string(),
  topics: z.array(z.string().nullable()),
  data: z.string(),
  blockNumber: HexNum,
  timeStamp: HexNum,
  logIndex: HexNum,
  transactionHash: z.string(),
});
export type BlockscoutLog = z.infer<typeof BlockscoutLog>;

const LogsResponse = z.object({ status: z.string(), message: z.string(), result: z.union([z.array(BlockscoutLog), z.string(), z.null()]) });
const BlockNumberResponse = z.object({ result: HexNum });

/** Etherscan-compatible getLogs returns at most 1000 records per call. */
export const GETLOGS_MAX = 1000;

export type FetchFn = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export class BlockscoutClient {
  constructor(
    readonly apiBase: string,
    private readonly fetchFn: FetchFn = (u) => fetch(u, { signal: AbortSignal.timeout(20_000) }),
  ) {}

  static forExplorer(explorerUrl: string): BlockscoutClient {
    return new BlockscoutClient(new URL("api", explorerUrl).toString());
  }

  private async get(params: Record<string, string>): Promise<unknown> {
    const url = `${this.apiBase}?${new URLSearchParams(params).toString()}`;
    const res = await this.fetchFn(url);
    if (!res.ok) throw new Error(`blockscout ${params.module}/${params.action} HTTP ${res.status}`);
    return res.json();
  }

  async latestBlock(): Promise<number> {
    return BlockNumberResponse.parse(await this.get({ module: "block", action: "eth_block_number" })).result;
  }

  async getLogs(address: string, fromBlock: number, toBlock: number): Promise<BlockscoutLog[]> {
    const r = LogsResponse.parse(
      await this.get({ module: "logs", action: "getLogs", address, fromBlock: String(fromBlock), toBlock: String(toBlock) }),
    );
    if (Array.isArray(r.result)) return r.result;
    // status "0" + "No logs found" is the API's empty result, anything else is an error.
    if (r.status === "0" && /no logs found/i.test(r.message)) return [];
    throw new Error(`blockscout getLogs: ${r.message} ${typeof r.result === "string" ? r.result : ""}`.trim());
  }
}
