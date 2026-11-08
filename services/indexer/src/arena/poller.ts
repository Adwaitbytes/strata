/**
 * Polls Blockscout for StrataArena and ScoreAttestor logs, block range by block range, and
 * applies them idempotently. Cursor per contract in indexer_cursors ("blockscout:<address>").
 * The same code path is the backfill: with no cursor it starts at the deploy block.
 */
import type { Sql } from "@strata/db";
import type { NetworkName } from "@strata/sdk";
import { GETLOGS_MAX, type BlockscoutClient } from "./blockscout.js";
import type { ArenaContracts } from "./contracts.js";
import { decodeArenaLog, type ArenaEvent, type ContractKind } from "./decode.js";
import { applyArenaEvents, type ProjectOptions } from "./project.js";
import { readCursor, writeCursor } from "../store/cursors.js";

export interface PollResult {
  latestBlock: number;
  inserted: number;
  duplicates: number;
  undecoded: number;
  contracts: number;
}

export interface ArenaPollerOptions extends ProjectOptions {
  /** Blocks behind head treated as final. Injective has instant finality; 2 covers indexer lag. */
  confirmations?: number;
  window?: number;
}

export class ArenaPoller {
  constructor(
    private readonly network: NetworkName,
    private readonly sql: Sql,
    private readonly client: BlockscoutClient,
    private readonly contracts: ArenaContracts,
    private readonly opts: ArenaPollerOptions = {},
  ) {}

  private targets(): { address: string; kind: ContractKind }[] {
    const out: { address: string; kind: ContractKind }[] = [];
    if (this.contracts.arena) out.push({ address: this.contracts.arena, kind: "arena" });
    if (this.contracts.attestor) out.push({ address: this.contracts.attestor, kind: "attestor" });
    return out;
  }

  async pollOnce(): Promise<PollResult> {
    const latest = await this.client.latestBlock();
    const head = latest - (this.opts.confirmations ?? 2);
    const result: PollResult = { latestBlock: latest, inserted: 0, duplicates: 0, undecoded: 0, contracts: this.targets().length };
    for (const t of this.targets()) {
      const source = `blockscout:${t.address}`;
      const cursor = await readCursor<{ block: number }>(this.sql, this.network, source);
      // Without a known deploy block, never scan from genesis (150M blocks): start at head.
      let from = cursor ? cursor.block + 1 : (this.contracts.deployBlock ?? head);
      let window = this.opts.window ?? 50_000;
      while (from <= head) {
        const to = Math.min(head, from + window - 1);
        const logs = await this.client.getLogs(t.address, from, to);
        if (logs.length >= GETLOGS_MAX && window > 1) {
          window = Math.max(1, Math.floor(window / 2));
          continue;
        }
        const events: ArenaEvent[] = [];
        for (const l of logs) {
          const e = decodeArenaLog(l, t.kind);
          if (e) events.push(e);
          else result.undecoded += 1;
        }
        const r = await applyArenaEvents(this.sql, this.network, events, this.opts);
        result.inserted += r.inserted;
        result.duplicates += r.duplicates;
        await writeCursor(this.sql, this.network, source, { block: to });
        from = to + 1;
      }
    }
    return result;
  }
}
