import { describe, expect, it } from "vitest";
import {
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  parseTransaction,
  serializeTransaction,
  zeroHash,
  type Address,
  type Hex,
} from "viem";
import { NETWORKS } from "@strata/config";
import { scoreAttestorAbi, strataArenaAbi } from "@strata/sdk";
import { createAttestorChain, type AttestorSigner } from "./chain.js";

const ARENA = "0x00000000000000000000000000000000000a7e4a" as Address;
const ATTESTOR = "0x000000000000000000000000000000000a77e570" as Address;
const SIGNER = "0x00000000000000000000000000000000000051e7" as Address;
const ROOT = ("0x" + "ab".repeat(32)) as Hex;
const TX = ("0x" + "cd".repeat(32)) as Hex;

interface FakeState {
  chainId: number;
  currentSeason: bigint;
  epochRoot: Hex;
  lastEpoch: [bigint, boolean];
  sent: Hex[];
  receiptFailures: number;
  receiptStatus: "0x1" | "0x0";
  estimateCalls: number;
}

function fakeRpc(state: FakeState) {
  return custom({
    async request({ method, params }: { method: string; params?: unknown }) {
      const p = (params ?? []) as [{ to: Address; data: Hex; from?: Address }];
      switch (method) {
        case "eth_chainId":
          return `0x${state.chainId.toString(16)}`;
        case "eth_call": {
          const { to, data } = p[0];
          if (to.toLowerCase() === ARENA.toLowerCase()) {
            const call = decodeFunctionData({ abi: strataArenaAbi, data });
            if (call.functionName === "currentSeason") return encodeFunctionResult({ abi: strataArenaAbi, functionName: "currentSeason", result: state.currentSeason });
            if (call.functionName === "seasons")
              return encodeFunctionResult({ abi: strataArenaAbi, functionName: "seasons", result: [1_765_000_000n, 1_765_086_400n, 3_600, true] });
            if (call.functionName === "attestor") return encodeFunctionResult({ abi: strataArenaAbi, functionName: "attestor", result: SIGNER });
          }
          const call = decodeFunctionData({ abi: scoreAttestorAbi, data });
          if (call.functionName === "getEpoch")
            return encodeFunctionResult({ abi: scoreAttestorAbi, functionName: "getEpoch", result: { merkleRoot: state.epochRoot, postedAt: 0n, dataURI: "" } });
          if (call.functionName === "lastEpoch") return encodeFunctionResult({ abi: scoreAttestorAbi, functionName: "lastEpoch", result: state.lastEpoch });
          throw new Error(`unexpected call ${call.functionName}`);
        }
        case "eth_estimateGas":
          state.estimateCalls++;
          expect(p[0].from?.toLowerCase()).toBe(SIGNER.toLowerCase());
          return "0x186a0"; // 100000
        case "eth_getTransactionCount":
          return "0x7";
        case "eth_sendRawTransaction":
          state.sent.push((params as [Hex])[0]);
          return TX;
        case "eth_getTransactionReceipt":
          if (state.receiptFailures > 0) {
            state.receiptFailures--;
            throw new Error("internal error");
          }
          return {
            transactionHash: TX,
            status: state.receiptStatus,
            blockNumber: "0x10",
            blockHash: "0x" + "11".repeat(32),
            transactionIndex: "0x0",
            from: SIGNER,
            to: ATTESTOR,
            cumulativeGasUsed: "0x1",
            gasUsed: "0x1",
            effectiveGasPrice: "0x1",
            logs: [],
            logsBloom: "0x" + "00".repeat(256),
            contractAddress: null,
            type: "0x0",
          };
        default:
          throw new Error(`unexpected method ${method}`);
      }
    },
  }, { retryCount: 0 });
}

/** Test signer: serializes with a fixed dummy signature so the raw tx can be decoded. */
const signer: AttestorSigner = {
  evmAddress: SIGNER,
  signLegacyEvmTx: (tx) =>
    serializeTransaction(
      { type: "legacy", chainId: tx.chainId, nonce: tx.nonce, to: tx.to, value: tx.value, gas: tx.gasLimit, gasPrice: tx.gasPrice, data: tx.data ?? "0x" },
      { r: ("0x" + "01".repeat(32)) as Hex, s: ("0x" + "02".repeat(32)) as Hex, v: 27n },
    ),
};

function setup(over: Partial<FakeState> = {}, network = NETWORKS.testnet, allowMainnet = false) {
  const state: FakeState = {
    chainId: network.evm.chainId,
    currentSeason: 1n,
    epochRoot: zeroHash,
    lastEpoch: [0n, false],
    sent: [],
    receiptFailures: 0,
    receiptStatus: "0x1",
    estimateCalls: 0,
    ...over,
  };
  const chain = createAttestorChain({
    network,
    arena: ARENA,
    attestor: ATTESTOR,
    signer,
    allowMainnet,
    transport: fakeRpc(state),
    receiptRetry: { attempts: 5, baseDelayMs: 1, maxDelayMs: 1 },
  });
  return { chain, state };
}

describe("createAttestorChain", () => {
  it("refuses mainnet unless mainnet posting is explicitly enabled", () => {
    expect(() => setup({}, NETWORKS.mainnet)).toThrow(/mainnet/);
    expect(() => setup({}, NETWORKS.mainnet, true)).not.toThrow();
  });

  it("refuses an RPC whose chain id does not match the configured network", async () => {
    const { chain } = setup({ chainId: 2525 });
    await expect(chain.verifyNetwork()).rejects.toThrow(/chain id/);
  });

  it("reads the current season in milliseconds and null when no season exists", async () => {
    expect(await setup().chain.getSeason()).toEqual({ season: 1, startMs: 1_765_000_000_000, endMs: 1_765_086_400_000, epochSeconds: 3_600, active: true });
    expect(await setup({ currentSeason: 0n }).chain.getSeason()).toBeNull();
  });

  it("reads posted roots and the last posted epoch", async () => {
    expect(await setup().chain.getPostedRoot(1, 3)).toBeNull();
    expect(await setup({ epochRoot: ROOT }).chain.getPostedRoot(1, 3)).toBe(ROOT);
    expect(await setup().chain.lastPostedEpoch(1)).toBeNull();
    expect(await setup({ lastEpoch: [4n, true] }).chain.lastPostedEpoch(1)).toBe(4);
    expect(await setup().chain.authorizedAttestor()).toBe(SIGNER);
  });

  it("posts a legacy type 0 tx at 160e6 gas price with estimated gas plus a 20% buffer", async () => {
    const { chain, state } = setup();
    const hash = await chain.postEpoch({ season: 1, epoch: 3, root: ROOT, dataUri: "https://api.example.test/v1/epochs/1/3#keccak256=0x00" });
    expect(hash).toBe(TX);
    expect(state.estimateCalls).toBe(1);
    const tx = parseTransaction(state.sent[0]!);
    expect(tx.type).toBe("legacy");
    expect(tx.gasPrice).toBe(160_000_000n);
    expect(tx.gas).toBe(120_000n);
    expect(tx.nonce).toBe(7);
    expect(tx.chainId).toBe(1439);
    expect(tx.to?.toLowerCase()).toBe(ATTESTOR.toLowerCase());
    const call = decodeFunctionData({ abi: scoreAttestorAbi, data: tx.data! });
    expect(call.functionName).toBe("postEpoch");
    expect(call.args).toEqual([1n, 3n, ROOT, "https://api.example.test/v1/epochs/1/3#keccak256=0x00"]);
  });

  it("retries receipt lookups that fail with internal errors", async () => {
    const { chain } = setup({ receiptFailures: 3 });
    expect(await chain.waitForReceipt(TX)).toBe("success");
  });

  it("reports a reverted receipt", async () => {
    const { chain } = setup({ receiptStatus: "0x0" });
    expect(await chain.waitForReceipt(TX)).toBe("reverted");
  });

  it("cannot post without a signer", async () => {
    const state: FakeState = { chainId: 1439, currentSeason: 1n, epochRoot: zeroHash, lastEpoch: [0n, false], sent: [], receiptFailures: 0, receiptStatus: "0x1", estimateCalls: 0 };
    const chain = createAttestorChain({ network: NETWORKS.testnet, arena: ARENA, attestor: ATTESTOR, signer: null, allowMainnet: false, transport: fakeRpc(state) });
    await expect(chain.postEpoch({ season: 1, epoch: 0, root: ROOT, dataUri: "x" })).rejects.toThrow(/signer/);
  });
});
