import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { ApiError, killRequestMessage, type KillRequest } from "@strata/sdk";
import { buildApp } from "../src/create-app.js";
import { KILL_MAX_TTL_MS } from "../src/admin/kill.js";
import { MemoryRepo } from "./support/memory-repo.js";
import { testConfig } from "./support/config.js";
import { NOW } from "./support/fixtures.js";

// Ephemeral keys generated per run; they hold nothing and are never printed.
const owner: PrivateKeyAccount = privateKeyToAccount(generatePrivateKey());
const stranger: PrivateKeyAccount = privateKeyToAccount(generatePrivateKey());

let repo: MemoryRepo;
let app: FastifyInstance;

beforeEach(async () => {
  repo = new MemoryRepo();
  app = await buildApp({ config: testConfig({ STRATA_OWNER_ADDRESS: owner.address }), repo, now: () => NOW });
});
afterEach(async () => {
  await app.close();
});

type Unsigned = Omit<KillRequest, "signature">;

function unsigned(over: Partial<Unsigned> = {}): Unsigned {
  return { target: "all", closePositions: true, network: "testnet", nonce: "n-0123456789abcdef", expiresAt: NOW + 60_000, ...over };
}

async function signed(u: Unsigned, signer: PrivateKeyAccount = owner): Promise<KillRequest> {
  return { ...u, signature: await signer.signMessage({ message: killRequestMessage(u) }) };
}

const post = (payload: unknown) => app.inject({ method: "POST", url: "/v1/admin/kill", payload: payload as object });

describe("POST /v1/admin/kill", () => {
  it("accepts an owner-signed request and records one kill command", async () => {
    const res = await post(await signed(unsigned()));
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ accepted: true, network: "testnet", target: "all", closePositions: true });
    expect(repo.killCommands).toHaveLength(1);
    expect(repo.killCommands[0]).toMatchObject({ targetAgentId: null, closePositions: true, nonce: "n-0123456789abcdef", signer: owner.address });
  });

  it("targets a single agent", async () => {
    const res = await post(await signed(unsigned({ target: 7, closePositions: false })));
    expect(res.statusCode).toBe(202);
    expect(repo.killCommands[0]?.targetAgentId).toBe(7);
  });

  it("rejects a replayed nonce", async () => {
    const req = await signed(unsigned());
    expect((await post(req)).statusCode).toBe(202);
    const replay = await post(req);
    expect(replay.statusCode).toBe(401);
    expect(ApiError.parse(replay.json()).error.code).toBe("unauthorized");
    expect(repo.killCommands).toHaveLength(1);
  });

  it("rejects a signature from any other address", async () => {
    const res = await post(await signed(unsigned(), stranger));
    expect(res.statusCode).toBe(401);
    expect(repo.killCommands).toHaveLength(0);
  });

  it("rejects a request whose fields were changed after signing", async () => {
    const req = await signed(unsigned({ closePositions: false }));
    const res = await post({ ...req, closePositions: true });
    expect(res.statusCode).toBe(401);
  });

  it("rejects an expired request", async () => {
    const res = await post(await signed(unsigned({ expiresAt: NOW - 1 })));
    expect(res.statusCode).toBe(401);
  });

  it("rejects an expiry too far in the future", async () => {
    const res = await post(await signed(unsigned({ expiresAt: NOW + KILL_MAX_TTL_MS + 1 })));
    expect(res.statusCode).toBe(400);
  });

  it("rejects a malformed body with 400", async () => {
    expect((await post({ target: "everyone" })).statusCode).toBe(400);
    expect((await post(await signed(unsigned({ nonce: "short" })))).statusCode).toBe(400);
  });

  it("rejects a garbage signature with 401, not 500", async () => {
    const res = await post({ ...unsigned(), signature: "0xdeadbeef" });
    expect(res.statusCode).toBe(401);
  });

  it("is unavailable when no owner address is configured", async () => {
    const bare = await buildApp({ config: testConfig(), repo, now: () => NOW });
    const res = await bare.inject({ method: "POST", url: "/v1/admin/kill", payload: await signed(unsigned()) });
    expect(res.statusCode).toBe(503);
    await bare.close();
  });
});

