/**
 * Cosmos transaction signer for Injective that never holds a raw private key.
 *
 * Mirrors what sdk-ts `MsgBroadcasterWithPk.prepareTxForBroadcast` does (createTransaction,
 * then sign keccak256(signBytes) and attach r||s), but signs through a KeyHandle from @strata/keys
 * and keeps the account sequence locally so a 1 to 3 s quoting loop does not re-read the account
 * on every cycle. Because we pass our own public key, a fresh account (no pubkey on chain yet)
 * can still sign, which sidesteps the MsgBroadcasterWithPk "invalid secp256k1 public key" issue
 * from the injective-evm-developer skill. The account must still exist (have received funds).
 *
 * Fee: gas price 160e6 inj per gas unit (`DEFAULT_GAS_PRICE` in @injectivelabs/utils, same
 * figure as the EVM recommendation in PRD 4.4).
 */
import {
  ChainGrpcAuthApi,
  ChainGrpcTendermintApi,
  TxGrpcApi,
  createTransaction,
} from "@injectivelabs/sdk-ts";
import type { Msgs, TxResponse } from "@injectivelabs/sdk-ts";
import { DEFAULT_GAS_PRICE } from "@injectivelabs/utils";
import type { KeyHandle } from "@strata/keys";
import { keccak256 } from "viem";
import type { EndpointSet } from "./endpoints.js";
import { backoffDelay, sleep } from "./retry.js";

export interface BroadcastResult {
  txHash: string;
  height: number;
  code: number;
  rawLog: string;
  /** Hex or base64 TxMsgData as returned by the node, used to decode msg responses. */
  data: string | undefined;
  gasUsed: number;
}

export class TxFailedError extends Error {
  override readonly name = "TxFailedError";
  constructor(
    message: string,
    readonly txHash: string | null,
    readonly code: number | null,
  ) {
    super(message);
  }
}

const SEQUENCE_MISMATCH = /account sequence mismatch|incorrect account sequence/i;
const TIMEOUT_BLOCKS = 40;
const GAS_PAD_NUM = 13n;
const GAS_PAD_DEN = 10n;

export interface CosmosSignerOptions {
  /** Fixed gas limit; when absent we simulate and pad 30%. */
  fixedGas?: bigint;
  memo?: string;
}

function toHex(bytes: Uint8Array): `0x${string}` {
  return `0x${Buffer.from(bytes).toString("hex")}`;
}

export class CosmosSigner {
  private accountNumber: number | null = null;
  private sequence: number | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly pubKeyB64: string;

  constructor(
    private readonly endpoints: EndpointSet,
    private readonly key: KeyHandle,
  ) {
    this.pubKeyB64 = Buffer.from(key.publicKeyCompressed).toString("base64");
  }

  get address(): string {
    return this.key.injAddress;
  }

  private grpc(i = 0): string {
    const b = this.endpoints.bundles[i % this.endpoints.bundles.length];
    if (b === undefined) throw new Error("no endpoints");
    return b.grpc;
  }

  async refreshAccount(): Promise<{ accountNumber: number; sequence: number }> {
    let last: unknown;
    for (let i = 0; i < this.endpoints.bundles.length * 2; i++) {
      try {
        const acct = await new ChainGrpcAuthApi(this.grpc(i)).fetchAccount(this.key.injAddress);
        this.accountNumber = acct.baseAccount.accountNumber;
        this.sequence = acct.baseAccount.sequence;
        return { accountNumber: this.accountNumber, sequence: this.sequence };
      } catch (err) {
        last = err;
        await sleep(backoffDelay(i, 200, 2_000));
      }
    }
    throw new TxFailedError(`account ${this.key.injAddress} not found on chain (fund it first): ${String(last)}`, null, null);
  }

  /** Latest block height and time from the chain (never the local clock). */
  async latestBlock(): Promise<{ height: number; timeMs: number }> {
    let last: unknown;
    for (let i = 0; i < this.endpoints.bundles.length * 2; i++) {
      try {
        const block = await new ChainGrpcTendermintApi(this.grpc(i)).fetchLatestBlock();
        const header = block?.header;
        if (header === undefined) throw new Error("latest block has no header");
        const time = header.time;
        const timeMs = time === undefined ? NaN : Number(time.seconds) * 1000 + Math.floor(time.nanos / 1e6);
        return { height: Number(header.height), timeMs };
      } catch (err) {
        last = err;
        await sleep(backoffDelay(i, 200, 2_000));
      }
    }
    throw last instanceof Error ? last : new Error(String(last));
  }

  /** Serializes broadcasts so the local sequence stays consistent. */
  broadcast(msgs: Msgs | Msgs[], options: CosmosSignerOptions = {}): Promise<BroadcastResult> {
    const run = this.queue.then(
      () => this.broadcastOnce(msgs, options, true),
      () => this.broadcastOnce(msgs, options, true),
    );
    this.queue = run.catch(() => undefined);
    return run;
  }

  private build(msgs: Msgs | Msgs[], gas: bigint, timeoutHeight: number, memo: string, signed: boolean) {
    if (this.accountNumber === null || this.sequence === null) throw new Error("account not loaded");
    const { txRaw, signBytes } = createTransaction({
      message: msgs,
      memo,
      fee: { amount: [{ denom: "inj", amount: (gas * BigInt(DEFAULT_GAS_PRICE)).toString() }], gas: gas.toString() },
      pubKey: this.pubKeyB64,
      sequence: this.sequence,
      accountNumber: this.accountNumber,
      chainId: this.endpoints.cosmosChainId,
      timeoutHeight,
    });
    if (signed) {
      const digest = keccak256(signBytes, "bytes");
      const sig = this.key.signDigest(digest);
      const compact = new Uint8Array(64);
      compact.set(sig.r, 0);
      compact.set(sig.s, 32);
      txRaw.signatures = [compact];
    } else {
      txRaw.signatures = [new Uint8Array(0)];
    }
    return txRaw;
  }

  private async broadcastOnce(msgs: Msgs | Msgs[], options: CosmosSignerOptions, retryOnSequence: boolean): Promise<BroadcastResult> {
    if (this.sequence === null) await this.refreshAccount();
    const { height } = await this.latestBlock();
    const timeoutHeight = height + TIMEOUT_BLOCKS;
    const memo = options.memo ?? "";

    let gas = options.fixedGas;
    if (gas === undefined) {
      try {
        const sim = await new TxGrpcApi(this.grpc()).simulate(this.build(msgs, 2_000_000n, timeoutHeight, memo, false));
        gas = (BigInt(sim.gasInfo.gasUsed) * GAS_PAD_NUM) / GAS_PAD_DEN + 20_000n;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (retryOnSequence && SEQUENCE_MISMATCH.test(msg)) {
          await this.refreshAccount();
          return this.broadcastOnce(msgs, options, false);
        }
        throw new TxFailedError(`simulation failed: ${msg}`, null, null);
      }
    }

    const txRaw = this.build(msgs, gas, timeoutHeight, memo, true);
    let res: TxResponse;
    try {
      res = await new TxGrpcApi(this.grpc()).broadcast(txRaw, { txTimeout: TIMEOUT_BLOCKS });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (retryOnSequence && SEQUENCE_MISMATCH.test(msg)) {
        await this.refreshAccount();
        return this.broadcastOnce(msgs, options, false);
      }
      // Sequence state is unknown after a failed broadcast; reload before the next tx.
      this.sequence = null;
      throw new TxFailedError(`broadcast failed: ${msg}`, null, null);
    }

    // The ante handler bumps the sequence for any tx included in a block, even if execution failed.
    this.sequence = (this.sequence ?? 0) + 1;
    if (res.code !== 0) {
      throw new TxFailedError(`tx ${res.txHash} failed with code ${res.code}: ${res.rawLog}`, res.txHash, res.code);
    }
    return { txHash: res.txHash, height: res.height, code: res.code, rawLog: res.rawLog, data: res.data, gasUsed: res.gasUsed };
  }
}

export { toHex };
