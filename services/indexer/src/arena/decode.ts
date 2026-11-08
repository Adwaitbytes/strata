/** Decodes StrataArena / ScoreAttestor logs with the ABIs committed in @strata/sdk (wagmi-generated). */
import { scoreAttestorAbi, strataArenaAbi } from "@strata/sdk";
import { decodeEventLog, type Hex } from "viem";
import type { BlockscoutLog } from "./blockscout.js";

export type ContractKind = "arena" | "attestor";

export interface ArenaEvent {
  contract: string;
  kind: ContractKind;
  txHash: string;
  logIndex: number;
  blockNumber: number;
  blockTime: Date;
  event: string;
  /** JSON-safe args: bigints become decimal strings. */
  args: Record<string, string | number | boolean>;
}

function jsonSafe(v: unknown): string | number | boolean {
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") return v;
  return JSON.stringify(v, (_k, x: unknown) => (typeof x === "bigint" ? x.toString() : x));
}

/** Returns null for logs that are not events of the given contract ABI. */
export function decodeArenaLog(log: BlockscoutLog, kind: ContractKind): ArenaEvent | null {
  const topics = log.topics.filter((t): t is string => t !== null) as Hex[];
  if (topics.length === 0) return null;
  const abi = kind === "arena" ? strataArenaAbi : scoreAttestorAbi;
  let decoded: { eventName: string; args: unknown };
  try {
    decoded = decodeEventLog({ abi, data: log.data as Hex, topics: topics as [Hex, ...Hex[]] }) as { eventName: string; args: unknown };
  } catch {
    return null;
  }
  const args: Record<string, string | number | boolean> = {};
  if (decoded.args && typeof decoded.args === "object") {
    for (const [k, v] of Object.entries(decoded.args as Record<string, unknown>)) args[k] = jsonSafe(v);
  }
  return {
    contract: log.address.toLowerCase(),
    kind,
    txHash: log.transactionHash.toLowerCase(),
    logIndex: log.logIndex,
    blockNumber: log.blockNumber,
    blockTime: new Date(log.timeStamp * 1000),
    event: decoded.eventName,
    args,
  };
}
