/**
 * Minimal Injective EVM JSON-RPC client.
 *
 * Gotchas handled (injective-evm-developer skill, PRD 4.4):
 *  - Legacy (type 0) transactions only, explicit gasPrice (160e6 recommended).
 *  - `eth_getTransactionReceipt` can return internal errors: retried with backoff, never hard-failed.
 * RPC URLs and chain ids come from @strata/config (verified, PRD 4.3).
 */
import { NETWORKS } from "@strata/config";
import type { KeyHandle } from "@strata/keys";
import type { NetworkName } from "@strata/sdk";
import { encodeFunctionData, decodeFunctionResult, erc20Abi } from "viem";
import { backoffDelay, sleep } from "./retry.js";

export interface EvmReceipt {
  transactionHash: string;
  status: "success" | "reverted";
  blockNumber: bigint;
}

export class EvmRpc {
  readonly chainId: number;
  readonly gasPriceWei: bigint;
  private readonly urls: readonly string[];
  private nextId = 1;

  constructor(readonly network: NetworkName) {
    const cfg = NETWORKS[network];
    this.urls = cfg.evm.rpcUrls;
    this.chainId = cfg.evm.chainId;
    this.gasPriceWei = cfg.gasPriceWei;
  }

  async call<T>(method: string, params: unknown[], attempts = 3): Promise<T> {
    let last: unknown;
    for (let i = 0; i < attempts; i++) {
      for (const url of this.urls) {
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method, params }),
            signal: AbortSignal.timeout(15_000),
          });
          const body = (await res.json()) as { result?: T; error?: { code: number; message: string } };
          if (body.error !== undefined) throw new Error(`${method}: ${body.error.message} (${body.error.code})`);
          return body.result as T;
        } catch (err) {
          last = err;
        }
      }
      await sleep(backoffDelay(i, 250, 4_000));
    }
    throw last instanceof Error ? last : new Error(String(last));
  }

  async assertChainId(): Promise<void> {
    const raw = await this.call<string>("eth_chainId", []);
    const id = Number(BigInt(raw));
    if (id !== this.chainId) throw new Error(`EVM RPC reports chain ${id}, expected ${this.chainId} for ${this.network}`);
  }

  async balance(address: string): Promise<bigint> {
    return BigInt(await this.call<string>("eth_getBalance", [address, "latest"]));
  }

  async nonce(address: string): Promise<number> {
    return Number(BigInt(await this.call<string>("eth_getTransactionCount", [address, "pending"])));
  }

  async erc20Balance(token: `0x${string}`, holder: `0x${string}`): Promise<bigint> {
    const data = encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [holder] });
    const raw = await this.call<`0x${string}`>("eth_call", [{ to: token, data }, "latest"]);
    return decodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", data: raw });
  }

  async estimateGas(tx: { from: string; to: string; value?: bigint; data?: string }): Promise<bigint> {
    const raw = await this.call<string>("eth_estimateGas", [
      { from: tx.from, to: tx.to, value: tx.value === undefined ? undefined : `0x${tx.value.toString(16)}`, data: tx.data },
    ]);
    return BigInt(raw);
  }

  /** Signs and sends a legacy tx. Gas is estimated and padded by 30%. Returns the tx hash. */
  async sendLegacy(key: KeyHandle, tx: { to: `0x${string}`; value?: bigint; data?: `0x${string}`; gasLimit?: bigint; nonce?: number }): Promise<string> {
    const value = tx.value ?? 0n;
    const nonce = tx.nonce ?? (await this.nonce(key.evmAddress));
    const estimate =
      tx.gasLimit ??
      ((await this.estimateGas({ from: key.evmAddress, to: tx.to, value, ...(tx.data === undefined ? {} : { data: tx.data }) })) * 13n) / 10n;
    const raw = key.signLegacyEvmTx({
      chainId: this.chainId,
      nonce,
      to: tx.to,
      value,
      gasLimit: estimate,
      gasPrice: this.gasPriceWei,
      ...(tx.data === undefined ? {} : { data: tx.data }),
    });
    return this.call<string>("eth_sendRawTransaction", [raw], 1);
  }

  /** Polls for a receipt with backoff, tolerating the known internal errors. */
  async waitForReceipt(hash: string, timeoutMs = 60_000): Promise<EvmReceipt> {
    const deadline = Date.now() + timeoutMs;
    for (let i = 0; Date.now() < deadline; i++) {
      try {
        const r = await this.call<{ transactionHash: string; status: string; blockNumber: string } | null>("eth_getTransactionReceipt", [hash], 1);
        if (r !== null) {
          return { transactionHash: r.transactionHash, status: r.status === "0x1" ? "success" : "reverted", blockNumber: BigInt(r.blockNumber) };
        }
      } catch {
        // Known Injective EVM quirk: receipt queries can fail transiently. Keep polling.
      }
      await sleep(backoffDelay(i, 500, 5_000));
    }
    throw new Error(`no receipt for ${hash} within ${timeoutMs}ms`);
  }

  async transferErc20(key: KeyHandle, token: `0x${string}`, to: `0x${string}`, amount: bigint, nonce?: number): Promise<string> {
    const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] });
    // USDC transfers run an EVM compliance hook that can run out of gas under a tight estimate
    // (docs.injective.network/developers-defi/usdc-stablecoin, "restricted action" FAQ): pad generously.
    const est = await this.estimateGas({ from: key.evmAddress, to: token, data });
    return this.sendLegacy(key, { to: token, data, gasLimit: est * 2n, ...(nonce === undefined ? {} : { nonce }) });
  }
}
