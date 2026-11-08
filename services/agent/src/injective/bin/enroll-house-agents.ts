/**
 * Registers an ERC-8004 identity for each testnet house agent and enrolls it in StrataArena,
 * signed by the agent's own key (the agent wallet is the operator, the identity owner and the
 * trader of its default subaccount, which StrataArena H-1 requires).
 *
 *   pnpm --filter @strata/agent inj:enroll -- strata-test-1 strata-test-2 strata-test-3
 *
 * Idempotent: results are written to config/enrollments.testnet.json (public data only: addresses,
 * ids, tx hashes). An agent with a recorded identity is not registered again, and an agent already
 * enrolled in the current season is not enrolled again. Testnet only.
 *
 * ERC-8004 registry ABI: InjectiveLabs/injective-agent-cli src/abi/IdentityRegistry.json
 * (`register(string agentURI)`, event `Registered(uint256 indexed agentId, string agentURI,
 * address indexed owner)`), the same call `inj-agent register` makes. Registry address from
 * @strata/config (verified in docs/INJECTIVE.md section 6).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getSubaccountId } from "@injectivelabs/sdk-ts";
import { NETWORKS } from "@strata/config";
import { KeystoreKeySource, defaultSecretsDir } from "@strata/keys";
import type { KeyHandle } from "@strata/keys";
import { strataArenaAbi } from "@strata/sdk";
import { decodeEventLog, decodeFunctionResult, encodeFunctionData, keccak256, parseAbi, toHex } from "viem";
import { EvmRpc } from "../evm.js";

const NETWORK = "testnet" as const;
const API_BASE = process.env["STRATA_API_BASE"] ?? "https://strata-api-nine.vercel.app";
const EXPLORER = NETWORKS[NETWORK].evm.explorer.replace(/\/$/, "");
const RECORD = fileURLToPath(new URL("../../../config/enrollments.testnet.json", import.meta.url));

const identityAbi = parseAbi([
  "function register(string agentURI) returns (uint256 agentId)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function balanceOf(address owner) view returns (uint256)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
]);
const REGISTERED_TOPIC = keccak256(toHex("Registered(uint256,string,address)"));

interface Enrollment {
  name: string;
  evmAddress: string;
  injAddress: string;
  subaccountId: string;
  erc8004Id: string;
  registerTx: string;
  arenaAgentId: number | null;
  season: number | null;
  enrollTx: string | null;
  metadataURI: string | null;
}

type Record_ = Record<string, Enrollment>;

function load(): Record_ {
  return existsSync(RECORD) ? (JSON.parse(readFileSync(RECORD, "utf8")) as Record_) : {};
}

function save(rec: Record_): void {
  writeFileSync(RECORD, `${JSON.stringify(rec, null, 2)}\n`);
}

const contracts = NETWORKS[NETWORK].contracts;
if (contracts.arena === null || contracts.identityRegistry === null) throw new Error("testnet arena or identity registry address missing in @strata/config");
const ARENA = contracts.arena as `0x${string}`;
const REGISTRY = contracts.identityRegistry as `0x${string}`;
const evm = new EvmRpc(NETWORK);

async function view<T>(to: `0x${string}`, data: `0x${string}`, decode: (raw: `0x${string}`) => T): Promise<T> {
  return decode(await evm.call<`0x${string}`>("eth_call", [{ to, data }, "latest"]));
}

const arenaRead = <F extends "agentCount" | "currentSeason" | "agentIdOf" | "agentSeason">(functionName: F, args: readonly unknown[] = []) =>
  view(ARENA, encodeFunctionData({ abi: strataArenaAbi, functionName, args } as never), (raw) => decodeFunctionResult({ abi: strataArenaAbi, functionName, data: raw } as never) as bigint);

async function send(key: KeyHandle, to: `0x${string}`, data: `0x${string}`, what: string): Promise<{ hash: string; logs: { topics: string[]; data: string; address: string }[] }> {
  const hash = await evm.sendLegacy(key, { to, data });
  const receipt = await evm.waitForReceipt(hash, 120_000);
  if (receipt.status !== "success") throw new Error(`${what} reverted: ${EXPLORER}/tx/${hash}`);
  const full = await evm.call<{ logs: { topics: string[]; data: string; address: string }[] }>("eth_getTransactionReceipt", [hash]);
  return { hash, logs: full.logs };
}

async function main(): Promise<void> {
  await evm.assertChainId();
  const names = process.argv.slice(2).filter((a) => a !== "--");
  if (names.length === 0) throw new Error("usage: inj:enroll -- <agent-name> [...]");
  const keys = new KeystoreKeySource({ secretsDir: process.env["STRATA_SECRETS_DIR"] ?? defaultSecretsDir() });
  const rec = load();
  const season = Number(await arenaRead("currentSeason"));

  for (const name of names) {
    const key = await keys.load(name);
    const subaccountId = getSubaccountId(key.injAddress, 0);
    if (subaccountId.slice(0, 42).toLowerCase() !== key.evmAddress.toLowerCase()) throw new Error(`${name}: subaccount prefix does not match the wallet`);
    let entry = rec[name];

    if (entry === undefined) {
      const owned = await view(REGISTRY, encodeFunctionData({ abi: identityAbi, functionName: "balanceOf", args: [key.evmAddress] }), (raw) =>
        decodeFunctionResult({ abi: identityAbi, functionName: "balanceOf", data: raw }),
      );
      if (owned > 0n) throw new Error(`${name} already owns ${owned} ERC-8004 identity token(s) but none is recorded in ${RECORD}; add it by hand`);
      const agentURI = `${API_BASE}/v1/agents?network=${NETWORK}#${name}`;
      const reg = await send(key, REGISTRY, encodeFunctionData({ abi: identityAbi, functionName: "register", args: [agentURI] }), `${name} register`);
      const log = reg.logs.find((l) => l.address.toLowerCase() === REGISTRY.toLowerCase() && l.topics[0] === REGISTERED_TOPIC);
      if (log === undefined) throw new Error(`${name}: no Registered event in ${reg.hash}`);
      const ev = decodeEventLog({ abi: identityAbi, eventName: "Registered", topics: log.topics as [`0x${string}`, ...`0x${string}`[]], data: log.data as `0x${string}` });
      if (ev.args.owner.toLowerCase() !== key.evmAddress.toLowerCase()) throw new Error(`${name}: identity minted to ${ev.args.owner}`);
      entry = {
        name,
        evmAddress: key.evmAddress,
        injAddress: key.injAddress,
        subaccountId,
        erc8004Id: ev.args.agentId.toString(),
        registerTx: reg.hash,
        arenaAgentId: null,
        season: null,
        enrollTx: null,
        metadataURI: null,
      };
      rec[name] = entry;
      save(rec);
      process.stdout.write(`${name} registered ERC-8004 id ${entry.erc8004Id} ${EXPLORER}/tx/${reg.hash}\n`);
    }

    const existing = Number(await arenaRead("agentIdOf", [key.evmAddress]));
    if (existing > 0 && Number(await arenaRead("agentSeason", [BigInt(existing)])) === season) {
      if (entry.arenaAgentId !== existing) {
        entry.arenaAgentId = existing;
        entry.season = season;
        save(rec);
      }
      process.stdout.write(`${name} already enrolled as arena agent ${existing} in season ${season}\n`);
      continue;
    }

    // The API serves the agent by its arena id; the id is the next agentCount, checked after the tx.
    const predicted = Number(await arenaRead("agentCount")) + 1;
    const metadataURI = `${API_BASE}/v1/agents/${predicted}?network=${NETWORK}`;
    const data = encodeFunctionData({ abi: strataArenaAbi, functionName: "enroll", args: [BigInt(entry.erc8004Id), subaccountId as `0x${string}`, metadataURI] });
    const tx = await send(key, ARENA, data, `${name} enroll`);
    const agentId = Number(await arenaRead("agentIdOf", [key.evmAddress]));
    if (agentId !== predicted) process.stdout.write(`${name}: arena id ${agentId} differs from predicted ${predicted}; run updateMetadata\n`);
    entry.arenaAgentId = agentId;
    entry.season = season;
    entry.enrollTx = tx.hash;
    entry.metadataURI = metadataURI;
    save(rec);
    process.stdout.write(`${name} enrolled as arena agent ${agentId} ${EXPLORER}/tx/${tx.hash}\n`);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`enroll failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
