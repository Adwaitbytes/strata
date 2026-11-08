/**
 * Epoch scheduler: score every closed epoch in order, persist it, and post its root once.
 *
 * Idempotency and resume rules:
 * - epoch_runs is the cursor. `posted` and `skipped` are settled (also `computed` in dry-run);
 *   the next tick starts after the highest settled epoch.
 * - A run with a tx hash is resolved by its receipt before anything else, so a restart between
 *   broadcast and inclusion never posts twice. A tx whose receipt has not appeared after
 *   MAX_RECEIPT_WAITS ticks is abandoned and the epoch is posted again; ScoreAttestor rejects
 *   duplicates, so the worst case is one reverted transaction, never two roots.
 * - The chain is the final word: if it already holds our root the run is marked posted; if it
 *   holds a different root, or has moved past this epoch, the run is skipped with the reason.
 * - A failure stops the tick so later epochs never get posted ahead of an earlier one.
 */
import type { Address, Hex } from "viem";
import type { EpochScore, NetworkName } from "@strata/sdk";
import type { FlagEvidence } from "./antiGaming.js";
import type { AttestorChain } from "./chain.js";
import {
  buildDataUri,
  computeEpoch,
  documentHash,
  epochWindow,
  lastClosedEpoch,
  type AgentBreakdown,
  type EpochData,
  type SeasonInfo,
} from "./epoch.js";
import type { EpochWindow } from "./model.js";
import type { ScoringParams } from "./params.js";
import type { ScorerMetrics } from "./telemetry.js";

export type RunStatus = "computed" | "submitted" | "posted" | "skipped" | "failed";

export interface EpochRun {
  season: number;
  epoch: number;
  status: RunStatus;
  merkleRoot: Hex | null;
  dataUri: string | null;
  txHash: Hex | null;
  reason: string | null;
  /** Failures since the last broadcast. */
  attempts: number;
}

export interface SaveScoredArgs {
  window: EpochWindow;
  merkleRoot: Hex;
  dataUri: string;
  documentHash: Hex;
  contract: Address;
  scores: EpochScore[];
  evidence: FlagEvidence[];
  breakdown: AgentBreakdown[];
}

/** Persistence boundary. The Postgres implementation lives in store.ts; all writes are scoped to one network. */
export interface ScorerStore {
  loadEpochData(window: EpochWindow, season: SeasonInfo): Promise<EpochData>;
  getRun(season: number, epoch: number): Promise<EpochRun | null>;
  nextEpochToProcess(season: number, settled: readonly RunStatus[]): Promise<number>;
  /** Writes epochs + scores rows (tx hash empty) and marks the run computed. Never called after a broadcast. */
  saveScored(args: SaveScoredArgs): Promise<void>;
  recordSubmitted(season: number, epoch: number, txHash: Hex): Promise<void>;
  recordPosted(season: number, epoch: number, txHash: Hex | null, postedAtMs: number): Promise<void>;
  recordSkipped(season: number, epoch: number, reason: string): Promise<void>;
  /** Marks the run failed, keeps any tx hash, increments attempts. */
  recordFailure(season: number, epoch: number, reason: string): Promise<void>;
}

export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export interface RunnerDeps {
  network: NetworkName;
  store: ScorerStore;
  chain: AttestorChain;
  params: ScoringParams;
  /** Public API base for the dataURI mirror, e.g. https://strata-api.vercel.app */
  apiBase: string;
  settleDelayMs: number;
  dryRun: boolean;
  metrics: ScorerMetrics;
  log: Logger;
  now?: () => number;
}

export const MAX_RECEIPT_WAITS = 3;

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export class EpochRunner {
  constructor(readonly deps: RunnerDeps) {}

  /** Fails fast on a wrong RPC or a signer that ScoreAttestor would reject. */
  async preflight(): Promise<void> {
    const { chain, dryRun } = this.deps;
    await chain.verifyNetwork();
    if (dryRun) return;
    const authorized = await chain.authorizedAttestor();
    if (!chain.signerAddress || authorized.toLowerCase() !== chain.signerAddress.toLowerCase()) {
      throw new Error(`signer ${chain.signerAddress ?? "(none)"} is not the arena attestor ${authorized}`);
    }
  }

  async tick(nowMs: number = (this.deps.now ?? Date.now)()): Promise<void> {
    const { chain, store, settleDelayMs, dryRun, metrics } = this.deps;
    const season = await chain.getSeason();
    if (!season) return;
    const last = lastClosedEpoch(season, nowMs, settleDelayMs);
    if (last !== null) {
      const settled: RunStatus[] = dryRun ? ["posted", "skipped", "computed"] : ["posted", "skipped"];
      for (let e = await store.nextEpochToProcess(season.season, settled); e <= last; e++) {
        await this.processEpoch(season, e);
      }
    }
    metrics.tickCompleted(nowMs);
  }

  async processEpoch(season: SeasonInfo, epoch: number): Promise<void> {
    const { store, chain, log, metrics, dryRun } = this.deps;
    const s = season.season;
    const run = await store.getRun(s, epoch);
    if (run?.status === "posted" || run?.status === "skipped") return;
    if (dryRun && run?.status === "computed") return;

    try {
      if (run?.txHash && (run.status === "submitted" || run.status === "failed")) {
        if (run.attempts < MAX_RECEIPT_WAITS) {
          if (await this.confirm(s, epoch, run.txHash)) return;
        } else {
          log.warn("abandoning unconfirmed tx", { season: s, epoch, txHash: run.txHash, attempts: run.attempts });
        }
      }

      const onchain = await chain.getPostedRoot(s, epoch);
      if (onchain) {
        if (run?.merkleRoot && run.merkleRoot.toLowerCase() === onchain.toLowerCase()) {
          await store.recordPosted(s, epoch, run.txHash, Date.now());
          metrics.epochPosted(epoch);
          return;
        }
        // Recompute before calling it a mismatch: the run may simply not be saved yet.
        const fresh = await this.compute(season, epoch);
        if (fresh.kind === "scored" && fresh.merkleRoot.toLowerCase() === onchain.toLowerCase()) {
          await this.save(fresh);
          await store.recordPosted(s, epoch, null, Date.now());
          metrics.epochPosted(epoch);
          return;
        }
        metrics.rootMismatch();
        log.error("onchain root differs from recomputed root", { season: s, epoch, onchain });
        await this.skip(s, epoch, `chain already holds a different root ${onchain} for this epoch`);
        return;
      }

      const lastPosted = await chain.lastPostedEpoch(s);
      if (lastPosted !== null && lastPosted >= epoch) {
        await this.skip(s, epoch, `chain already has epoch ${lastPosted}; epochs must strictly increase, so this one cannot be posted`);
        return;
      }

      const computed = await this.compute(season, epoch);
      if (computed.kind === "skip") {
        await this.skip(s, epoch, computed.reason);
        return;
      }
      await this.save(computed);
      if (dryRun) {
        log.info("dry run: epoch computed, not posted", { season: s, epoch, root: computed.merkleRoot });
        return;
      }

      const txHash = await chain.postEpoch({ season: s, epoch, root: computed.merkleRoot, dataUri: computed.dataUri });
      await store.recordSubmitted(s, epoch, txHash);
      log.info("epoch root broadcast", { season: s, epoch, txHash, root: computed.merkleRoot });
      if (!(await this.confirm(s, epoch, txHash))) throw new Error(`postEpoch tx ${txHash} reverted`);
    } catch (err) {
      metrics.epochPostFailed();
      log.error("epoch processing failed", { season: s, epoch, error: errorMessage(err) });
      await store.recordFailure(s, epoch, errorMessage(err));
      throw err;
    }
  }

  /** True when the tx succeeded (run marked posted). False when it reverted. Throws when the receipt is unavailable. */
  private async confirm(season: number, epoch: number, txHash: Hex): Promise<boolean> {
    const status = await this.deps.chain.waitForReceipt(txHash);
    if (status !== "success") return false;
    await this.deps.store.recordPosted(season, epoch, txHash, Date.now());
    this.deps.metrics.epochPosted(epoch);
    this.deps.log.info("epoch root confirmed", { season, epoch, txHash });
    return true;
  }

  private async skip(season: number, epoch: number, reason: string) {
    await this.deps.store.recordSkipped(season, epoch, reason);
    this.deps.metrics.epochSkipped();
    this.deps.log.info("epoch skipped", { season, epoch, reason });
  }

  private async compute(season: SeasonInfo, epoch: number) {
    const { store, params, network, apiBase, chain } = this.deps;
    const window = epochWindow(season, epoch);
    const data = await store.loadEpochData(window, season);
    const result = computeEpoch(data, params);
    if (result.kind === "skip") return result;
    const docInput = {
      network,
      season: season.season,
      epoch,
      startTime: window.startMs,
      endTime: window.endMs,
      merkleRoot: result.merkleRoot,
      contract: chain.contract,
      scores: result.scores,
    };
    const hash = documentHash(docInput);
    return { ...result, window, documentHash: hash, dataUri: buildDataUri(apiBase, network, season.season, epoch, hash) };
  }

  private async save(c: Extract<Awaited<ReturnType<EpochRunner["compute"]>>, { kind: "scored" }>) {
    await this.deps.store.saveScored({
      window: c.window,
      merkleRoot: c.merkleRoot,
      dataUri: c.dataUri,
      documentHash: c.documentHash,
      contract: this.deps.chain.contract,
      scores: c.scores,
      evidence: c.evidence,
      breakdown: c.breakdown,
    });
  }
}
