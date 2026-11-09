/**
 * Testnet-only fund distribution from strata-test-1 to the other STRATA testnet wallets.
 *
 * Asset facts:
 *  - Native INJ on Injective EVM has 18 decimals and is sent as a plain value transfer.
 *  - Testnet USDC EVM address 0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d, 6 decimals
 *    (docs.injective.network/developers-defi/usdc-stablecoin, Testnet tab; verified eth_getCode).
 *  - Testnet USDT is the bank denom peggy0x87aB3B4C8661e07D6372361211B96ed4Dc36B1B5 (quote denom of
 *    the testnet USDT perps in the live market list), 6 decimals per the market quote_decimals.
 *    It is moved with a Cosmos bank MsgSend.
 */
import { open, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { ChainGrpcBankApi, MsgSend } from "@injectivelabs/sdk-ts";
import { NETWORKS } from "@strata/config";
import { KeystoreKeySource, defaultSecretsDir, evmToInjAddress, findRepoRoot, keystorePath } from "@strata/keys";
import type { KeyHandle } from "@strata/keys";
import { getEndpointSet, withFailover } from "./endpoints.js";
import { EvmRpc } from "./evm.js";
import { sleep } from "./retry.js";
import { CosmosSigner } from "./tx.js";
import { dec, plain } from "./units.js";

export const TESTNET_USDC_EVM = "0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d" as const;
export const TESTNET_USDC_DENOM = `erc20:${TESTNET_USDC_EVM}`;
export const TESTNET_USDT_DENOM = "peggy0x87aB3B4C8661e07D6372361211B96ed4Dc36B1B5";

const INJ = 10n ** 18n;
/** Keep at least this much INJ on the source for its own trading gas. */
const SOURCE_INJ_RESERVE = (3n * INJ) / 10n;
const MAX_GAS_GRANT = INJ / 4n;
const MIN_GAS_GRANT = INJ / 100n;

export interface Recipient {
  name: string;
  evmAddress: `0x${string}`;
  injAddress: string;
  /** Share of each stablecoin balance (0..1). Zero means gas only. */
  stableShare: number;
}

/** Hard guard: refuses anything that is not Injective testnet (EVM 1439, injective-888). */
export async function assertTestnet(evm: EvmRpc): Promise<void> {
  if (evm.network !== "testnet") throw new Error("distribution is testnet only");
  if (evm.chainId === NETWORKS.mainnet.evm.chainId) throw new Error("refusing mainnet chain id 1776");
  await evm.assertChainId();
  const set = getEndpointSet("testnet");
  if (set.cosmosChainId !== NETWORKS.testnet.evm.cosmosChainId || set.cosmosChainId === NETWORKS.mainnet.evm.cosmosChainId) {
    throw new Error(`refusing cosmos chain ${set.cosmosChainId}`);
  }
}

/** Reads the public `address` field of a v3 keystore without decrypting it. */
export async function keystoreAddress(path: string): Promise<`0x${string}`> {
  const json = JSON.parse(await readFile(path, "utf8")) as { address?: unknown };
  if (typeof json.address !== "string" || !/^(0x)?[0-9a-fA-F]{40}$/.test(json.address)) {
    throw new Error(`keystore ${path} has no address field`);
  }
  return (json.address.startsWith("0x") ? json.address : `0x${json.address}`) as `0x${string}`;
}

/**
 * The W1 deployer keystore is a Foundry keystore without the optional `address` field, so its
 * address is read from the W1 entry in docs/STATUS.md ("testnet deployer `0x...`").
 */
export async function deployerAddressFromStatus(statusPath: string): Promise<`0x${string}`> {
  const text = await readFile(statusPath, "utf8");
  const match = /testnet deployer `(0x[0-9a-fA-F]{40})`/.exec(text);
  if (match?.[1] === undefined) throw new Error(`no testnet deployer address in ${statusPath}`);
  return match[1] as `0x${string}`;
}

async function addressFor(path: string, statusPath: string): Promise<`0x${string}`> {
  try {
    return await keystoreAddress(path);
  } catch {
    return deployerAddressFromStatus(statusPath);
  }
}

export async function defaultRecipients(secretsDir = defaultSecretsDir()): Promise<Recipient[]> {
  const statusPath = join(findRepoRoot(), "docs", "STATUS.md");
  const spec: { name: string; path: string; stableShare: number }[] = [
    { name: "strata-test-2", path: keystorePath(secretsDir, "strata-test-2"), stableShare: 0.2 },
    { name: "strata-test-3", path: keystorePath(secretsDir, "strata-test-3"), stableShare: 0.2 },
    { name: "strata-options", path: keystorePath(secretsDir, "strata-options"), stableShare: 0.2 },
    { name: "strata-testnet-attestor", path: keystorePath(secretsDir, "strata-testnet-attestor"), stableShare: 0 },
    // W1 deployer keystore has no .json suffix (docs/STATUS.md W1 section).
    { name: "strata-testnet-deployer", path: `${secretsDir}/keystores/strata-testnet-deployer`, stableShare: 0 },
  ];
  const out: Recipient[] = [];
  for (const s of spec) {
    const evmAddress = s.name === "strata-testnet-deployer" ? await addressFor(s.path, statusPath) : await keystoreAddress(s.path);
    out.push({ name: s.name, evmAddress, injAddress: evmToInjAddress(evmAddress), stableShare: s.stableShare });
  }
  return out;
}

export interface Balances {
  injWei: bigint;
  usdc: bigint;
  usdt: bigint;
}

export async function readBalances(evm: EvmRpc, evmAddress: `0x${string}`, injAddress: string): Promise<Balances> {
  const set = getEndpointSet("testnet");
  const [injWei, usdc, usdt] = await Promise.all([
    evm.balance(evmAddress),
    evm.erc20Balance(TESTNET_USDC_EVM, evmAddress),
    withFailover(set, async (e) => {
      const b = await new ChainGrpcBankApi(e.grpc).fetchBalance({ accountAddress: injAddress, denom: TESTNET_USDT_DENOM });
      return BigInt(b.amount);
    }).catch(() => 0n),
  ]);
  return { injWei, usdc, usdt };
}

export function fmt(amount: bigint, decimals: number): string {
  return plain(dec(amount.toString()).div(dec(10).pow(decimals)));
}

export interface DistributionStep {
  kind: "inj" | "usdc" | "usdt";
  to: string;
  toAddress: string;
  amount: bigint;
}

/** Pure planning: given the source balance and recipient balances, decide transfers. */
export function planDistribution(source: Balances, recipients: (Recipient & { balances: Balances })[]): DistributionStep[] {
  const steps: DistributionStep[] = [];
  const needGas = recipients.filter((r) => r.balances.injWei < MIN_GAS_GRANT);
  if (needGas.length > 0 && source.injWei > SOURCE_INJ_RESERVE) {
    let grant = (source.injWei - SOURCE_INJ_RESERVE) / BigInt(needGas.length + 1);
    if (grant > MAX_GAS_GRANT) grant = MAX_GAS_GRANT;
    if (grant >= MIN_GAS_GRANT) {
      for (const r of needGas) steps.push({ kind: "inj", to: r.name, toAddress: r.evmAddress, amount: grant });
    }
  }
  for (const kind of ["usdc", "usdt"] as const) {
    const total = source[kind];
    if (total === 0n) continue;
    for (const r of recipients) {
      if (r.stableShare <= 0 || r.balances[kind] > 0n) continue;
      const amount = (total * BigInt(Math.round(r.stableShare * 10_000))) / 10_000n;
      if (amount > 0n) steps.push({ kind, to: r.name, toAddress: kind === "usdt" ? r.injAddress : r.evmAddress, amount });
    }
  }
  return steps;
}

export interface DistributeOptions {
  sourceName?: string;
  dryRun?: boolean;
  timeoutMs?: number;
  pollMs?: number;
  log?: (line: string) => void;
}

/**
 * Waits until the source has INJ, then sends gas and stablecoin shares. INJ and USDC go over the
 * EVM (this also registers the source pubkey on chain); USDT goes by Cosmos MsgSend afterwards.
 */
const LOCK_STALE_MS = 15 * 60_000;

/** Exclusive lock so two distribution runs cannot race and double-send (observed 2026-11-09). */
async function withLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  try {
    const st = await stat(path);
    if (Date.now() - st.mtimeMs > LOCK_STALE_MS) await rm(path, { force: true });
  } catch {
    // No lock file.
  }
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
  } catch {
    throw new Error(`another distribution run holds ${path}; wait for it or delete the file if it is stale`);
  }
  try {
    await handle.writeFile(String(process.pid));
    await handle.close();
    return await fn();
  } finally {
    await rm(path, { force: true });
  }
}

export async function distributeTestnetFunds(options: DistributeOptions = {}): Promise<DistributionStep[]> {
  if (options.dryRun === true) return distributeUnlocked(options);
  return withLock(join(defaultSecretsDir(), "distribute-testnet.lock"), () => distributeUnlocked(options));
}

async function distributeUnlocked(options: DistributeOptions): Promise<DistributionStep[]> {
  const log = options.log ?? ((l: string) => void process.stdout.write(`${l}\n`));
  const evm = new EvmRpc("testnet");
  await assertTestnet(evm);

  const source: KeyHandle = await new KeystoreKeySource().load(options.sourceName ?? "strata-test-1");
  const recipients = await defaultRecipients();
  log(`source ${source.name} ${source.evmAddress} ${source.injAddress}`);

  const deadline = Date.now() + (options.timeoutMs ?? 60 * 60_000);
  let bal = await readBalances(evm, source.evmAddress, source.injAddress);
  // Funded means: enough INJ to pay gas for the transfers. Gas grants are only sent when the
  // source holds more than its reserve (planDistribution); stablecoins are split regardless.
  while (bal.injWei < MIN_GAS_GRANT) {
    log(`waiting for funding: ${source.evmAddress} has ${fmt(bal.injWei, 18)} INJ, ${fmt(bal.usdc, 6)} USDC, ${fmt(bal.usdt, 6)} USDT`);
    if (Date.now() > deadline) throw new Error("timed out waiting for the source wallet to be funded");
    await sleep(options.pollMs ?? 30_000);
    bal = await readBalances(evm, source.evmAddress, source.injAddress);
  }
  log(`funded: ${fmt(bal.injWei, 18)} INJ, ${fmt(bal.usdc, 6)} USDC, ${fmt(bal.usdt, 6)} USDT`);

  const withBalances = await Promise.all(recipients.map(async (r) => ({ ...r, balances: await readBalances(evm, r.evmAddress, r.injAddress) })));
  const steps = planDistribution(bal, withBalances);
  if (steps.length === 0) log("nothing to send (recipients already funded)");

  let nonce = await evm.nonce(source.evmAddress);
  const usdtSteps: DistributionStep[] = [];
  for (const step of steps) {
    const human = step.kind === "inj" ? `${fmt(step.amount, 18)} INJ` : `${fmt(step.amount, 6)} ${step.kind.toUpperCase()}`;
    if (options.dryRun === true) {
      log(`dry-run ${human} -> ${step.to} ${step.toAddress}`);
      continue;
    }
    if (step.kind === "usdt") {
      usdtSteps.push(step);
      continue;
    }
    const hash =
      step.kind === "inj"
        ? await evm.sendLegacy(source, { to: step.toAddress as `0x${string}`, value: step.amount, gasLimit: 21_000n, nonce })
        : await evm.transferErc20(source, TESTNET_USDC_EVM, step.toAddress as `0x${string}`, step.amount, nonce);
    nonce += 1;
    const receipt = await evm.waitForReceipt(hash, 90_000).catch(() => null);
    log(`${human} -> ${step.to} ${step.toAddress} tx ${hash} ${receipt?.status ?? "receipt pending"}`);
  }

  if (usdtSteps.length > 0) {
    const signer = new CosmosSigner(getEndpointSet("testnet"), source);
    const msgs = usdtSteps.map((s) =>
      MsgSend.fromJSON({
        srcInjectiveAddress: source.injAddress,
        dstInjectiveAddress: s.toAddress,
        amount: { denom: TESTNET_USDT_DENOM, amount: s.amount.toString() },
      }),
    );
    const res = await signer.broadcast(msgs);
    for (const s of usdtSteps) log(`${fmt(s.amount, 6)} USDT -> ${s.to} ${s.toAddress} tx ${res.txHash}`);
  }
  return steps;
}
