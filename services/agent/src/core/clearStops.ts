/**
 * Human-only resume (review H-2). A tripped season stop, daily stop or kill latch stays tripped
 * across restarts; the owner clears it at the host after review:
 *   pnpm --filter @strata/agent clear-stops -- --network testnet --agent-id 3 --season --confirm
 * Stop the agent first; it reloads state at boot.
 */
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { NetworkName } from "@strata/sdk";
import type { AgentStateStore, PersistedAgentState } from "./persistence.js";

export interface ClearStopsArgs {
  readonly network: NetworkName;
  readonly agentId: number;
  readonly kill: boolean;
  readonly season: boolean;
  readonly day: boolean;
}

export function parseClearStopsArgs(argv: readonly string[]): ClearStopsArgs {
  const value = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  if (!argv.includes("--confirm")) throw new Error("refusing without --confirm: clearing a stop resumes trading on next start");
  const args = z
    .object({ network: z.enum(["mainnet", "testnet"]), agentId: z.coerce.number().int().positive() })
    .parse({ network: value("--network"), agentId: value("--agent-id") });
  const out = { ...args, kill: argv.includes("--kill"), season: argv.includes("--season"), day: argv.includes("--day") };
  if (!out.kill && !out.season && !out.day) throw new Error("choose at least one of --kill, --season, --day");
  return out;
}

/** Returns the state before the change. */
export async function clearStops(store: AgentStateStore, args: ClearStopsArgs, nowMs: number): Promise<PersistedAgentState> {
  const before = await store.load(args.network, args.agentId);
  if (before === null) throw new Error(`no stored state for agent ${args.agentId} on ${args.network}`);
  const next: PersistedAgentState = {
    risk: {
      ...before.risk,
      ...(args.day ? { stoppedForDay: false } : {}),
      ...(args.season ? { stoppedForSeason: false, peakEquityUsd: null } : {}),
    },
    kill: args.kill ? { killed: false, closePositions: false, source: null, at: null } : before.kill,
  };
  await store.save(args.network, args.agentId, next, nowMs);
  return before;
}

async function cli(): Promise<void> {
  const { default: postgres } = await import("postgres");
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const { DrizzleAgentStateStore } = await import("./persistence.js");
  const args = parseClearStopsArgs(process.argv.slice(2));
  const url = process.env["DATABASE_URL"]?.trim();
  if (!url) throw new Error("DATABASE_URL is required");
  const sql = postgres(url, { max: 1 });
  try {
    const before = await clearStops(new DrizzleAgentStateStore(drizzle(sql)), args, Date.now());
    process.stdout.write(`${JSON.stringify({ cleared: { kill: args.kill, season: args.season, day: args.day }, before })}\n`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  cli().catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : "clear-stops failed"}\n`);
    process.exit(1);
  });
}
