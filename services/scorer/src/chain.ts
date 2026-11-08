/**
 * ScoreAttestor / StrataArena access over Injective EVM JSON-RPC with viem.
 *
 * Injective EVM rules (PRD 4.4, .claude/skills/injective-evm-developer): legacy type 0
 * transactions with an explicit gasPrice (160e6 from packages/config), gas from eth_estimateGas,
 * and eth_getTransactionReceipt can return internal errors, so receipts are polled with backoff.
 * The scorer signs through the KeyHandle from @strata/keys (D16); it never sees a private key.
 */
import { createPublicClient, encodeFunctionData, http, zeroHash, type Address, type Hex, type Transport } from "viem";
import { FORBIDDEN_CHAIN_IDS, type NetworkConfig } from "@strata/config";
import { scoreAttestorAbi, strataArenaAbi } from "@strata/sdk";
import type { SeasonInfo } from "./epoch.js";
import { retryWithBackoff, type RetryOptions } from "./retry.js";

/** Structural subset of `KeyHandle` from @strata/keys. */
export interface AttestorSigner {
  readonly evmAddress: Address;
  signLegacyEvmTx(tx: { chainId: number; nonce: number; to: Address; value: bigint; gasLimit: bigint; gasPrice: bigint; data?: Hex }): Hex;
}

export interface AttestorChain {
  readonly contract: Address;
  readonly signerAddress: Address | null;
  /** Throws unless the RPC reports the configured chain id. */
  verifyNetwork(): Promise<void>;
  getSeason(): Promise<SeasonInfo | null>;
  getPostedRoot(season: number, epoch: number): Promise<Hex | null>;
  lastPostedEpoch(season: number): Promise<number | null>;
  /** The only address ScoreAttestor accepts posts from (StrataArena.attestor(), D21). */
  authorizedAttestor(): Promise<Address>;
  /** Broadcasts postEpoch and returns the tx hash without waiting for inclusion. */
  postEpoch(args: { season: number; epoch: number; root: Hex; dataUri: string }): Promise<Hex>;
  waitForReceipt(txHash: Hex): Promise<"success" | "reverted">;
}

export interface AttestorChainOptions {
  network: NetworkConfig;
  arena: Address;
  attestor: Address;
  signer: AttestorSigner | null;
  /** Defaults to the network's first configured RPC URL. */
  rpcUrl?: string;
  /** Mainnet posting needs this set by an explicit operator decision (CLAUDE.md: testnet first). */
  allowMainnet: boolean;
  transport?: Transport;
  receiptRetry?: Omit<RetryOptions, "shouldRetry">;
}

/** Headroom over eth_estimateGas, since state can shift between estimate and inclusion. */
const GAS_BUFFER_PERCENT = 20n;
const DEFAULT_RECEIPT_RETRY = { attempts: 12, baseDelayMs: 1_000, maxDelayMs: 15_000 } as const;

export function createAttestorChain(opts: AttestorChainOptions): AttestorChain {
  const { network } = opts;
  if (FORBIDDEN_CHAIN_IDS.includes(network.evm.chainId)) throw new Error(`chain ${network.evm.chainId} is forbidden`);
  if (network.name === "mainnet" && !opts.allowMainnet) {
    throw new Error("refusing to post to mainnet: set SCORER_ALLOW_MAINNET_POSTING=true only after the orchestrator approves");
  }
  const rpcUrl = opts.rpcUrl ?? network.evm.rpcUrls[0];
  if (!opts.transport && !rpcUrl) throw new Error(`no RPC URL configured for ${network.name}`);
  const client = createPublicClient({ transport: opts.transport ?? http(rpcUrl) });
  const receiptRetry = opts.receiptRetry ?? DEFAULT_RECEIPT_RETRY;

  return {
    contract: opts.attestor,
    signerAddress: opts.signer?.evmAddress ?? null,

    async verifyNetwork() {
      const id = await client.getChainId();
      if (id !== network.evm.chainId) throw new Error(`RPC chain id ${id} does not match ${network.name} (${network.evm.chainId})`);
    },

    async getSeason() {
      const season = await client.readContract({ address: opts.arena, abi: strataArenaAbi, functionName: "currentSeason" });
      if (season === 0n) return null;
      const [startTime, endTime, epochSeconds, active] = await client.readContract({
        address: opts.arena,
        abi: strataArenaAbi,
        functionName: "seasons",
        args: [season],
      });
      return { season: Number(season), startMs: Number(startTime) * 1_000, endMs: Number(endTime) * 1_000, epochSeconds: Number(epochSeconds), active };
    },

    async getPostedRoot(season, epoch) {
      const rec = await client.readContract({ address: opts.attestor, abi: scoreAttestorAbi, functionName: "getEpoch", args: [BigInt(season), BigInt(epoch)] });
      return rec.merkleRoot === zeroHash ? null : rec.merkleRoot;
    },

    async lastPostedEpoch(season) {
      const [epoch, any] = await client.readContract({ address: opts.attestor, abi: scoreAttestorAbi, functionName: "lastEpoch", args: [BigInt(season)] });
      return any ? Number(epoch) : null;
    },

    async authorizedAttestor() {
      return client.readContract({ address: opts.arena, abi: strataArenaAbi, functionName: "attestor" });
    },

    async postEpoch({ season, epoch, root, dataUri }) {
      const signer = opts.signer;
      if (!signer) throw new Error("no attestor signer loaded; run with a KeySource or in dry-run mode");
      const data = encodeFunctionData({ abi: scoreAttestorAbi, functionName: "postEpoch", args: [BigInt(season), BigInt(epoch), root, dataUri] });
      const estimate = await client.estimateGas({ account: signer.evmAddress, to: opts.attestor, data });
      const nonce = await client.getTransactionCount({ address: signer.evmAddress, blockTag: "pending" });
      const raw = signer.signLegacyEvmTx({
        chainId: network.evm.chainId,
        nonce,
        to: opts.attestor,
        value: 0n,
        gasLimit: estimate + (estimate * GAS_BUFFER_PERCENT) / 100n,
        gasPrice: network.gasPriceWei,
        data,
      });
      return client.sendRawTransaction({ serializedTransaction: raw });
    },

    async waitForReceipt(txHash) {
      const receipt = await retryWithBackoff(() => client.getTransactionReceipt({ hash: txHash }), receiptRetry);
      return receipt.status;
    },
  };
}
