/**
 * Arena contract addresses. Source of truth is packages/contracts/deployments/<network>.json
 * (written by W1 after deploy), falling back to @strata/config NETWORKS[network].contracts.
 * Nothing is hand-written here; with no deployment the arena poller idles.
 */
import { existsSync, readFileSync } from "node:fs";
import { NETWORKS } from "@strata/config";
import { EvmAddress, type NetworkName } from "@strata/sdk";
import { z } from "zod";

export interface ArenaContracts {
  arena: `0x${string}` | null;
  attestor: `0x${string}` | null;
  deployBlock: number | null;
}

const Addr = EvmAddress.transform((a) => a.toLowerCase() as `0x${string}`);
const Entry = z.union([Addr, z.object({ address: Addr, block: z.number().int().nonnegative().optional(), blockNumber: z.number().int().nonnegative().optional() }).passthrough()]);
/**
 * W1's deploy script writes { contracts: { StrataArena: { address, block }, ScoreAttestor: {...} } }.
 * Note the top-level `attestor` key there is the attestor EOA, not the ScoreAttestor contract,
 * so only contract-named keys are read.
 */
const DeploymentFile = z
  .object({
    StrataArena: Addr.optional(),
    ScoreAttestor: Addr.optional(),
    deployBlock: z.number().int().nonnegative().optional(),
    contracts: z.record(z.string(), Entry).optional(),
  })
  .passthrough();

function entry(c: z.infer<typeof DeploymentFile>["contracts"], name: string): { address: `0x${string}`; block: number | null } | null {
  const v = c?.[name];
  if (v === undefined) return null;
  if (typeof v === "string") return { address: v, block: null };
  return { address: v.address, block: v.block ?? v.blockNumber ?? null };
}

export function parseDeployment(json: unknown): ArenaContracts {
  const d = DeploymentFile.parse(json);
  const arena = entry(d.contracts, "StrataArena");
  const attestor = entry(d.contracts, "ScoreAttestor");
  const blocks = [arena?.block, attestor?.block].filter((b): b is number => typeof b === "number");
  return {
    arena: arena?.address ?? d.StrataArena ?? null,
    attestor: attestor?.address ?? d.ScoreAttestor ?? null,
    deployBlock: d.deployBlock ?? (blocks.length > 0 ? Math.min(...blocks) : null),
  };
}

export function resolveArenaContracts(network: NetworkName, deploymentsDir: string): ArenaContracts {
  const file = `${deploymentsDir}/${network}.json`;
  if (existsSync(file)) return parseDeployment(JSON.parse(readFileSync(file, "utf8")));
  const c = NETWORKS[network].contracts;
  return { arena: c.arena, attestor: c.attestor, deployBlock: c.deployBlock };
}
