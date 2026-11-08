/**
 * Local end-to-end check of the real scorer process against the real contracts, with no testnet
 * funds and no key material in the repo:
 *   1. anvil on chain id 1439 (so the testnet network config applies), port 8547, base fee 0 so a
 *      160e6 legacy gas price is accepted as on Injective
 *   2. a throwaway encrypted keystore for the attestor (@strata/keys, temp secrets dir)
 *   3. MockIdentityRegistry, StrataArena, ScoreAttestor deployed with forge from an anvil unlocked account
 *   4. a throwaway Postgres database, migrated, seeded with the golden fixture shifted to "now"
 *   5. `tsx src/main.ts --once` run twice; the second run must not send a transaction
 *   6. every stored score verified onchain with ScoreAttestor.verifyScore
 *
 * Usage (from services/scorer): SCORER_IT_DATABASE_URL_FILE=../../.secrets/local_db_url npx tsx scripts/anvil-e2e.ts
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { createPublicClient, createWalletClient, http, parseEther, type Address, type Hex } from "viem";
import { eq } from "drizzle-orm";
import { getMarkets } from "@strata/config";
import { agentFills, agentOrders, agents, bookSnapshots, createDb, epochs, loadMigrations, migrate, scores } from "@strata/db";
import { createKeystore } from "@strata/keys";
import { scoreAttestorAbi, strataArenaAbi, toLeafInput } from "@strata/sdk";
import { EPOCH, FIXTURE, MKT_A, MKT_B, SEASON } from "../test/fixtures/epochFixture.js";

const RPC = "http://127.0.0.1:8547";
const GOLDEN_ROOT = "0xdd4f9e94db975b5d21af83f6d1fdfcf6a833621676c80020fedf81d79280f3a9";
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const CONTRACTS = here("../../../packages/contracts");
const SCORER = here("..");

function check(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(`E2E FAILED: ${msg}`);
  console.log(`ok  ${msg}`);
}

function forgeCreate(contract: string, from: Address, args: string[]): Address {
  const out = execFileSync(
    "forge",
    ["create", contract, "--rpc-url", RPC, "--unlocked", "--from", from, "--broadcast", "--legacy", ...(args.length ? ["--constructor-args", ...args] : [])],
    { cwd: CONTRACTS, encoding: "utf8" },
  );
  const m = /Deployed to: (0x[0-9a-fA-F]{40})/.exec(out);
  if (!m) throw new Error(`forge create ${contract} printed no address`);
  return m[1] as Address;
}

async function main() {
  const urlFile = process.env.SCORER_IT_DATABASE_URL_FILE;
  if (!urlFile) throw new Error("set SCORER_IT_DATABASE_URL_FILE");
  const anvil = spawn("anvil", ["--chain-id", "1439", "--port", "8547", "--block-base-fee-per-gas", "0", "--silent"], { stdio: "ignore" });
  const secretsDir = mkdtempSync(join(tmpdir(), "strata-e2e-"));
  const dbName = `strata_scorer_e2e_${process.pid}`;
  const admin = postgres(readFileSync(urlFile, "utf8").trim(), { max: 1, onnotice: () => {} });
  try {
    const client = createPublicClient({ transport: http(RPC) });
    for (let i = 0; i < 50; i++) {
      try {
        await client.getChainId();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    const [deployer] = await createWalletClient({ transport: http(RPC) }).getAddresses();
    if (!deployer) throw new Error("anvil has no unlocked account");
    const wallet = createWalletClient({ account: deployer, transport: http(RPC) });

    const key = await createKeystore("strata-testnet-attestor", { secretsDir, scryptN: 1024 });
    await client.waitForTransactionReceipt({ hash: await wallet.sendTransaction({ chain: null, to: key.evmAddress, value: parseEther("1") }) });

    const registry = forgeCreate("test/mocks/MockIdentityRegistry.sol:MockIdentityRegistry", deployer, []);
    const arena = forgeCreate("src/StrataArena.sol:StrataArena", deployer, [deployer, key.evmAddress, registry]);
    const attestor = forgeCreate("src/ScoreAttestor.sol:ScoreAttestor", deployer, [arena]);

    const block = await client.getBlock();
    const seasonStart = Math.floor(Number(block.timestamp) / 300) * 300 - 1_200;
    await client.waitForTransactionReceipt({
      hash: await wallet.writeContract({ chain: null, address: arena, abi: strataArenaAbi, functionName: "startSeason", args: [BigInt(seasonStart), BigInt(seasonStart + 86_400), 300] }),
    });

    // Seed: golden fixture shifted so its epoch 2 is this season's epoch 2, on real arena market IDs.
    await admin.unsafe(`CREATE DATABASE ${dbName}`);
    const u = new URL(readFileSync(urlFile, "utf8").trim());
    u.pathname = `/${dbName}`;
    const dbh = createDb(u.toString(), { max: 2 });
    await migrate(dbh.sql, loadMigrations(here("../../../packages/db/migrations")));
    const arenaMarkets = getMarkets("testnet").filter((m) => m.arenaEnabled);
    if (arenaMarkets.length < 2) throw new Error("need two arena-enabled testnet markets in packages/config");
    const marketMap = new Map([
      [MKT_A, arenaMarkets[0]!.marketId.toLowerCase()],
      [MKT_B, arenaMarkets[1]!.marketId.toLowerCase()],
    ]);
    const mkt = (id: string) => marketMap.get(id)!;
    const shift = seasonStart * 1_000 - SEASON.startMs;
    const at = (t: number) => new Date(t + shift);
    const db = dbh.db;
    await db.insert(agents).values(
      FIXTURE.agents.map((a) => ({ network: "testnet" as const, agentId: a.agentId, name: `e2e-${a.agentId}`, kind: "house", operator: a.operator, injAddress: "inj1e2e", subaccountId: a.subaccountId, marketIds: a.marketIds.map(mkt), status: a.status, simulated: false, enrolledAt: at(a.enrolledAt) })),
    );
    for (const [marketId, samples] of FIXTURE.book) {
      await db.insert(bookSnapshots).values(
        samples.map((b) => ({ network: "testnet" as const, marketId: mkt(marketId), at: at(b.at), provenance: "TESTNET" as const, mid: String(b.mid), spreadBps: b.spreadBps, depthUsd25: b.depthUsd25, strataDepthUsd25: 0, bids: [], asks: [], sessionState: "always_open" })),
      );
      await db.insert(bookSnapshots).values({ network: "testnet", marketId: mkt(marketId), at: at(SEASON.startMs - 86_400_000), provenance: "BASELINE", mid: "1", spreadBps: FIXTURE.baselineSpreadBps.get(marketId)!, depthUsd25: 0, strataDepthUsd25: 0, bids: [], asks: [], sessionState: "always_open" });
    }
    await db.insert(agentOrders).values(
      FIXTURE.orders.map((o) => ({ network: "testnet" as const, agentId: o.agentId, marketId: mkt(o.marketId), orderHash: o.orderHash, side: o.side, price: String(o.price), quantity: String(o.quantity), level: 0, postedAt: at(o.postedAt), cancelledAt: o.cancelledAt === null ? null : at(o.cancelledAt), provenance: "TESTNET" as const })),
    );
    await db.insert(agentFills).values(
      FIXTURE.fills.map((f) => {
        const [txHash, idx] = f.id.split(":");
        return { network: "testnet" as const, agentId: f.agentId, marketId: mkt(f.marketId), orderHash: f.orderHash, tradeId: f.id, txHash: txHash!, eventIndex: Number(idx), side: f.side, price: String(f.price), quantity: String(f.quantity), feeUsd: f.feeUsd, isMaker: true, counterpartySubaccountId: f.counterpartySubaccountId, executedAt: at(f.executedAt), provenance: "TESTNET" as const };
      }),
    );

    const env = {
      ...process.env,
      STRATA_NETWORK: "testnet",
      DATABASE_URL: u.toString(),
      DATABASE_URL_FILE: "",
      SCORER_RPC_URL: RPC,
      STRATA_ARENA_ADDRESS: arena,
      STRATA_SCORE_ATTESTOR_ADDRESS: attestor,
      STRATA_SECRETS_DIR: secretsDir,
      SCORER_API_BASE: "http://localhost:8080",
      SCORER_EPOCH_SECONDS: "300",
    };
    const runOnce = () => spawnSync("npx", ["tsx", "src/main.ts", "--once"], { cwd: SCORER, env, encoding: "utf8" });
    const first = runOnce();
    process.stdout.write(first.stdout.replaceAll(u.toString(), "<db>"));
    process.stderr.write(first.stderr.replaceAll(u.toString(), "<db>"));
    check(first.status === 0, "scorer --once exits 0");

    const [lastEpoch, any] = await client.readContract({ address: attestor, abi: scoreAttestorAbi, functionName: "lastEpoch", args: [1n] });
    // Epochs 1 and 3 overlap the fixture's book edges, so they may be posted or skipped; epoch 2 must be posted.
    check(any && lastEpoch >= BigInt(EPOCH), `onchain lastEpoch ${lastEpoch} is at least ${EPOCH}`);
    const rec = await client.readContract({ address: attestor, abi: scoreAttestorAbi, functionName: "getEpoch", args: [1n, BigInt(EPOCH)] });
    check(rec.merkleRoot === GOLDEN_ROOT, "onchain root equals the golden root");
    check(/#keccak256=0x[0-9a-f]{64}$/.test(rec.dataURI), `dataURI carries a content hash: ${rec.dataURI}`);

    const [row] = await db.select().from(epochs).where(eq(epochs.epoch, EPOCH));
    check(!!row?.txHash && !!row.postedAt, "epochs row has tx hash and postedAt");
    const tx = await client.getTransaction({ hash: row!.txHash as Hex });
    check(tx.type === "legacy" && tx.gasPrice === 160_000_000n, "postEpoch tx is legacy type 0 at 160e6 gas price");

    for (const s of await db.select().from(scores).where(eq(scores.epoch, EPOCH))) {
      const m = s.metrics as { quotedSpreadBps: number; depthUsd25: number; uptimeBps: number; pnlUsd: number };
      const l = toLeafInput({ season: s.season, epoch: s.epoch, agentId: s.agentId, score: s.score, quotedSpreadBps: m.quotedSpreadBps, depthUsd25: m.depthUsd25, uptimeBps: m.uptimeBps, pnlUsd: m.pnlUsd, flags: s.flags });
      const ok = await client.readContract({
        address: attestor,
        abi: scoreAttestorAbi,
        functionName: "verifyScore",
        args: [l.season, l.epoch, l.agentId, l.score, l.spreadCentiBps, l.depthUsd, l.uptimeBps, l.pnlUsdCents, l.flags, s.proof as Hex[]],
      });
      check(ok, `verifyScore true onchain for agent ${s.agentId} (score ${s.score})`);
    }

    const nonceBefore = await client.getTransactionCount({ address: key.evmAddress });
    const second = runOnce();
    check(second.status === 0, "second --once exits 0");
    check((await client.getTransactionCount({ address: key.evmAddress })) === nonceBefore, "second run sends no transaction (idempotent)");
    await dbh.close();
    console.log("E2E PASSED");
  } finally {
    anvil.kill();
    rmSync(secretsDir, { recursive: true, force: true });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => undefined);
    await admin.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
