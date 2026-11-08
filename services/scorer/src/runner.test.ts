import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import type { AttestorChain } from "./chain.js";
import { parseDataUri, type EpochData, type SeasonInfo } from "./epoch.js";
import type { EpochWindow } from "./model.js";
import { DEFAULT_PARAMS } from "./params.js";
import { EpochRunner, type EpochRun, type RunStatus, type SaveScoredArgs, type ScorerStore } from "./runner.js";
import { createScorerMetrics } from "./telemetry.js";
import { EPOCH, FIXTURE, SEASON } from "../test/fixtures/epochFixture.js";

const SETTLE = 120_000;
const CONTRACT = "0x00000000000000000000000000000000000c0c0c" as Address;
const SIGNER = "0x00000000000000000000000000000000000051e7" as Address;
const nowAfter = (epoch: number) => SEASON.startMs + (epoch + 1) * SEASON.epochSeconds * 1_000 + SETTLE;

class MemoryStore implements ScorerStore {
  runs = new Map<number, EpochRun>();
  saved: SaveScoredArgs[] = [];
  loads: number[] = [];
  async loadEpochData(window: EpochWindow): Promise<EpochData> {
    this.loads.push(window.epoch);
    return { ...FIXTURE, window, book: window.epoch === EPOCH ? FIXTURE.book : new Map() };
  }
  async getRun(_season: number, epoch: number) {
    return this.runs.get(epoch) ?? null;
  }
  async nextEpochToProcess(_season: number, settled: readonly RunStatus[]) {
    let max = -1;
    for (const [e, r] of this.runs) if (settled.includes(r.status)) max = Math.max(max, e);
    return max + 1;
  }
  private put(epoch: number, patch: Partial<EpochRun>) {
    const prev = this.runs.get(epoch) ?? { season: SEASON.season, epoch, status: "computed" as RunStatus, merkleRoot: null, dataUri: null, txHash: null, reason: null, attempts: 0 };
    this.runs.set(epoch, { ...prev, ...patch });
  }
  async saveScored(args: SaveScoredArgs) {
    this.saved.push(args);
    this.put(args.window.epoch, { status: "computed", merkleRoot: args.merkleRoot, dataUri: args.dataUri, reason: null });
  }
  async recordSubmitted(_s: number, epoch: number, txHash: Hex) {
    this.put(epoch, { status: "submitted", txHash, attempts: 0 });
  }
  async recordPosted(_s: number, epoch: number, txHash: Hex | null) {
    this.put(epoch, { status: "posted", txHash });
  }
  async recordSkipped(_s: number, epoch: number, reason: string) {
    this.put(epoch, { status: "skipped", reason });
  }
  async recordFailure(_s: number, epoch: number, reason: string) {
    const prev = this.runs.get(epoch);
    this.put(epoch, { status: "failed", reason, attempts: (prev?.attempts ?? 0) + 1 });
  }
}

class FakeChain implements AttestorChain {
  readonly contract = CONTRACT;
  readonly signerAddress: Address | null = SIGNER;
  roots = new Map<number, Hex>();
  posts: { epoch: number; root: Hex; dataUri: string }[] = [];
  failNextPost = false;
  revertNext = false;
  pending = new Map<Hex, { epoch: number; root: Hex; revert: boolean }>();
  async verifyNetwork() {}
  async getSeason(): Promise<SeasonInfo> {
    return SEASON;
  }
  async getPostedRoot(_s: number, epoch: number) {
    return this.roots.get(epoch) ?? null;
  }
  async lastPostedEpoch() {
    return this.roots.size === 0 ? null : Math.max(...this.roots.keys());
  }
  async authorizedAttestor() {
    return SIGNER;
  }
  async postEpoch({ epoch, root, dataUri }: { season: number; epoch: number; root: Hex; dataUri: string }) {
    if (this.failNextPost) {
      this.failNextPost = false;
      throw new Error("rpc down");
    }
    this.posts.push({ epoch, root, dataUri });
    const hash = `0x${String(this.posts.length).padStart(64, "0")}` as Hex;
    this.pending.set(hash, { epoch, root, revert: this.revertNext });
    this.revertNext = false;
    return hash;
  }
  async waitForReceipt(hash: Hex) {
    const p = this.pending.get(hash);
    if (!p) throw new Error("unknown tx");
    if (p.revert) return "reverted" as const;
    this.roots.set(p.epoch, p.root);
    return "success" as const;
  }
}

function setup(dryRun = false) {
  const store = new MemoryStore();
  const chain = new FakeChain();
  const metrics = createScorerMetrics("testnet");
  const logs: string[] = [];
  const runner = new EpochRunner({
    network: "testnet",
    store,
    chain,
    params: DEFAULT_PARAMS,
    apiBase: "https://api.example.test",
    settleDelayMs: SETTLE,
    dryRun,
    metrics,
    log: { info: (m) => void logs.push(m), warn: (m) => void logs.push(m), error: (m) => void logs.push(m) },
  });
  return { store, chain, metrics, runner, logs };
}

describe("EpochRunner", () => {
  it("skips empty epochs with a recorded reason and posts the scored one in order", async () => {
    const { store, chain, runner, metrics } = setup();
    await runner.tick(nowAfter(EPOCH));
    expect(store.runs.get(0)).toMatchObject({ status: "skipped", reason: "no book data for any arena market in the epoch window" });
    expect(store.runs.get(1)?.status).toBe("skipped");
    expect(store.runs.get(2)?.status).toBe("posted");
    expect(chain.posts.map((p) => p.epoch)).toEqual([2]);
    expect(chain.posts[0]!.root).toBe("0xdd4f9e94db975b5d21af83f6d1fdfcf6a833621676c80020fedf81d79280f3a9");
    const uri = parseDataUri(chain.posts[0]!.dataUri);
    expect(uri?.url).toBe("https://api.example.test/v1/epochs/1/2?network=testnet");
    expect(uri?.contentHash).toBe("0x" + store.saved[0]!.documentHash.slice(2));
    expect(metrics.render()).toContain('strata_scorer_epochs_skipped_total{network="testnet"} 2');
    expect(metrics.render()).toContain('strata_scorer_last_posted_epoch{network="testnet"} 2');
  });

  it("does nothing before an epoch has settled", async () => {
    const { chain, runner, store } = setup();
    await runner.tick(nowAfter(0) - 1);
    expect(store.runs.size).toBe(0);
    expect(chain.posts).toHaveLength(0);
  });

  it("never posts the same epoch twice across ticks", async () => {
    const { chain, runner, store } = setup();
    await runner.tick(nowAfter(EPOCH));
    await runner.tick(nowAfter(EPOCH) + 10_000);
    expect(chain.posts).toHaveLength(1);
    expect(store.loads.filter((e) => e === EPOCH)).toHaveLength(1);
  });

  it("resumes a submitted tx after a restart by waiting for its receipt instead of re-posting", async () => {
    const first = setup();
    first.chain.waitForReceipt = async () => {
      throw new Error("process killed");
    };
    await expect(first.runner.tick(nowAfter(EPOCH))).rejects.toThrow();
    expect(first.store.runs.get(EPOCH)?.status).toBe("failed");
    // A fresh process sharing the same store and chain.
    const chain = new FakeChain();
    chain.pending = first.chain.pending;
    chain.posts = first.chain.posts;
    const store = first.store;
    expect(store.runs.get(EPOCH)?.txHash).toBe(`0x${"1".padStart(64, "0")}`);
    const runner = new EpochRunner({ ...setup().runner.deps, store, chain });
    await runner.tick(nowAfter(EPOCH));
    expect(chain.posts).toHaveLength(1);
    expect(store.runs.get(EPOCH)?.status).toBe("posted");
  });

  it("abandons a tx whose receipt never shows up after repeated failures and posts again", async () => {
    const { chain, runner, store } = setup();
    chain.waitForReceipt = async () => {
      throw new Error("receipt not found");
    };
    for (let i = 0; i < 3; i++) await expect(runner.tick(nowAfter(EPOCH))).rejects.toThrow();
    expect(chain.posts).toHaveLength(1);
    expect(store.runs.get(EPOCH)?.attempts).toBe(3);
    await expect(runner.tick(nowAfter(EPOCH))).rejects.toThrow();
    expect(chain.posts).toHaveLength(2);
  });

  it("marks an epoch posted without re-posting when the chain already holds our root", async () => {
    const { chain, runner, store } = setup();
    chain.roots.set(EPOCH, "0xdd4f9e94db975b5d21af83f6d1fdfcf6a833621676c80020fedf81d79280f3a9");
    store.runs.set(EPOCH, { season: 1, epoch: EPOCH, status: "computed", merkleRoot: "0xdd4f9e94db975b5d21af83f6d1fdfcf6a833621676c80020fedf81d79280f3a9", dataUri: "x", txHash: null, reason: null, attempts: 0 });
    store.runs.set(0, { season: 1, epoch: 0, status: "skipped", merkleRoot: null, dataUri: null, txHash: null, reason: "r", attempts: 0 });
    store.runs.set(1, { season: 1, epoch: 1, status: "skipped", merkleRoot: null, dataUri: null, txHash: null, reason: "r", attempts: 0 });
    await runner.tick(nowAfter(EPOCH));
    expect(chain.posts).toHaveLength(0);
    expect(store.runs.get(EPOCH)?.status).toBe("posted");
  });

  it("records a root mismatch as skipped and raises the mismatch metric", async () => {
    const { chain, runner, store, metrics } = setup();
    chain.roots.set(EPOCH, ("0x" + "ee".repeat(32)) as Hex);
    await runner.tick(nowAfter(EPOCH));
    expect(chain.posts).toHaveLength(0);
    expect(store.runs.get(EPOCH)?.status).toBe("skipped");
    expect(store.runs.get(EPOCH)?.reason).toMatch(/different root/);
    expect(metrics.render()).toContain('strata_scorer_root_mismatch_total{network="testnet"} 1');
  });

  it("skips an epoch the chain has already moved past", async () => {
    const { chain, runner, store } = setup();
    chain.roots.set(5, ("0x" + "ee".repeat(32)) as Hex);
    await runner.tick(nowAfter(EPOCH));
    expect(store.runs.get(EPOCH)?.reason).toMatch(/already has epoch 5/);
    expect(chain.posts).toHaveLength(0);
  });

  it("counts a failed post, stops advancing, and succeeds on the next tick", async () => {
    const { chain, runner, store, metrics } = setup();
    chain.failNextPost = true;
    await expect(runner.tick(nowAfter(EPOCH + 1))).rejects.toThrow("rpc down");
    expect(store.runs.get(EPOCH)).toMatchObject({ status: "failed", attempts: 1 });
    expect(store.runs.has(EPOCH + 1)).toBe(false);
    expect(metrics.render()).toContain('strata_scorer_epoch_post_failures_total{network="testnet"} 1');
    await runner.tick(nowAfter(EPOCH + 1));
    expect(store.runs.get(EPOCH)?.status).toBe("posted");
    expect(store.runs.get(EPOCH + 1)?.status).toBe("skipped");
  });

  it("treats a reverted post as a failure", async () => {
    const { chain, runner, store, metrics } = setup();
    chain.revertNext = true;
    await expect(runner.tick(nowAfter(EPOCH))).rejects.toThrow(/reverted/);
    expect(store.runs.get(EPOCH)?.status).toBe("failed");
    expect(metrics.render()).toContain('strata_scorer_epoch_post_failures_total{network="testnet"} 1');
  });

  it("computes and stores but never posts in dry-run mode", async () => {
    const { chain, runner, store } = setup(true);
    await runner.tick(nowAfter(EPOCH));
    await runner.tick(nowAfter(EPOCH));
    expect(chain.posts).toHaveLength(0);
    expect(store.runs.get(EPOCH)?.status).toBe("computed");
    expect(store.saved).toHaveLength(1);
  });

  it("refuses to start when the signer is not the arena attestor", async () => {
    const { runner, chain } = setup();
    chain.authorizedAttestor = async () => "0x0000000000000000000000000000000000000bad" as Address;
    await expect(runner.preflight()).rejects.toThrow(/not the arena attestor/);
  });
});
