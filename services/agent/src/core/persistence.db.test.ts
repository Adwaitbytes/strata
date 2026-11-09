/**
 * Integration tests against a real Postgres with migrations applied (packages/db `pnpm migrate`).
 * Skipped unless STRATA_TEST_DATABASE_URL is set, for example the local compose DB on port 5433.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { INITIAL_RISK_STATE } from "@strata/risk";
import { DrizzleAgentStateStore, DrizzleHeartbeatSink, DrizzleKillCommandFeed, DrizzleNonceStore, persistable } from "./persistence.js";
import { DrizzleWriter } from "./recorder.js";

const url = process.env["STRATA_TEST_DATABASE_URL"];
const AGENT = 900_000 + Math.floor(Math.random() * 90_000);

describe.skipIf(!url)("Postgres persistence (integration)", () => {
  const sql = postgres(url ?? "postgres://unused", { max: 2 });
  const db = drizzle(sql);
  const created: string[] = [];

  afterAll(async () => {
    await sql`DELETE FROM agent_risk_state WHERE agent_id = ${AGENT}`;
    await sql`DELETE FROM guard_events WHERE agent_id = ${AGENT}`;
    await sql`DELETE FROM heartbeats WHERE service = ${`agent:${AGENT}`}`;
    await sql`DELETE FROM agent_orders WHERE agent_id = ${AGENT}`;
    await sql`DELETE FROM agent_fills WHERE agent_id = ${AGENT}`;
    await sql`DELETE FROM tuner_events WHERE agent_id = ${AGENT}`;
    if (created.length) {
      await sql`DELETE FROM kill_commands WHERE id IN ${sql(created)}`;
      await sql`DELETE FROM admin_nonces WHERE nonce IN ${sql(created.map((id) => `n-${id}`))}`;
    }
    await sql.end({ timeout: 5 });
  });

  it("saves, loads and overwrites agent risk state", async () => {
    const store = new DrizzleAgentStateStore(db);
    expect(await store.load("testnet", AGENT)).toBeNull();
    const s1 = persistable({ ...INITIAL_RISK_STATE, stoppedForSeason: true, peakEquityUsd: 1234.5 }, { killed: true, closePositions: true, source: "api", at: 5 });
    await store.save("testnet", AGENT, s1, Date.now());
    expect(await store.load("testnet", AGENT)).toEqual(s1);
    const s2 = { ...s1, risk: { ...s1.risk, stoppedForSeason: false } };
    await store.save("testnet", AGENT, s2, Date.now());
    expect(await store.load("testnet", AGENT)).toEqual(s2);
  });

  it("consumes a nonce exactly once", async () => {
    const id = randomUUID();
    created.push(id);
    const nonces = new DrizzleNonceStore(db);
    expect(await nonces.consume(`n-${id}`, 0, Date.now())).toBe(true);
    expect(await nonces.consume(`n-${id}`, 0, Date.now())).toBe(false);
  });

  it("returns unacknowledged kill commands for this agent and drops them once acked", async () => {
    const mine = randomUUID();
    const other = randomUUID();
    created.push(mine, other);
    for (const [id, target] of [
      [mine, AGENT],
      [other, AGENT + 1],
    ] as const) {
      await sql`INSERT INTO admin_nonces (nonce, used_at) VALUES (${`n-${id}`}, now()) ON CONFLICT DO NOTHING`;
      await sql`INSERT INTO kill_commands (id, network, target_agent_id, close_positions, signer, nonce, requested_at, signature_expires_at)
                VALUES (${id}, 'testnet', ${target}, true, '0x0000000000000000000000000000000000000001', ${`n-${id}`}, now(), now() + interval '5 minutes')`;
    }
    const feed = new DrizzleKillCommandFeed(db);
    const pending = await feed.pending("testnet", AGENT);
    expect(pending.map((p) => p.id)).toContain(mine);
    expect(pending.map((p) => p.id)).not.toContain(other);
    const writer = new DrizzleWriter(db);
    await writer.write([
      {
        kind: "guard",
        value: {
          network: "testnet",
          provenance: "TESTNET",
          id: randomUUID(),
          agentId: AGENT,
          marketId: null,
          guard: "kill_switch",
          action: "halt",
          reason: "kill_switch_api",
          detail: "ack",
          observed: { killCommandId: mine },
          at: Date.now(),
        },
      },
    ]);
    expect((await feed.pending("testnet", AGENT)).map((p) => p.id)).not.toContain(mine);
  });

  it("records quotes, cancels, fills and tuner events idempotently", async () => {
    const writer = new DrizzleWriter(db);
    const M = `0x${"c".repeat(64)}`;
    const hash = `h-${randomUUID()}`;
    const params = { gamma: 0.1, minHalfSpreadBps: 10, levels: 3, sizeMultiplier: 1, offHoursQuoting: false };
    const batch = [
      { kind: "quote" as const, value: { network: "testnet" as const, provenance: "TESTNET" as const, agentId: AGENT, marketId: M, orderHash: hash, side: "buy" as const, price: "99.9", quantity: "0.25", level: 0, postedAt: 1_000, cancelledAt: null } },
      { kind: "fill" as const, value: { network: "testnet" as const, provenance: "TESTNET" as const, agentId: AGENT, marketId: M, orderHash: hash, tradeId: "t", txHash: `0x${randomUUID().replace(/-/g, "")}`, eventIndex: 0, side: "buy" as const, price: "99.9", quantity: "0.1", feeUsd: 0, isMaker: true, counterpartySubaccountId: null, executedAt: 1_500 } },
      { kind: "tuner" as const, value: { network: "testnet" as const, id: randomUUID(), agentId: AGENT, marketId: M, mode: "shadow" as const, model: "stub", before: params, suggested: params, applied: null, clamped: [], rationale: "No change.", rejected: false, rejectReason: null, at: 2_000 } },
    ];
    await writer.write(batch);
    await writer.write(batch);
    await writer.write([{ kind: "cancel", value: { network: "testnet", orderHash: hash, cancelledAt: 3_000 } }]);
    const orders = await sql`SELECT cancelled_at FROM agent_orders WHERE agent_id = ${AGENT}`;
    expect(orders).toHaveLength(1);
    expect(new Date(orders[0]!["cancelled_at"] as string).getTime()).toBe(3_000);
    expect(await sql`SELECT 1 FROM agent_fills WHERE agent_id = ${AGENT}`).toHaveLength(1);
    expect(await sql`SELECT 1 FROM tuner_events WHERE agent_id = ${AGENT}`).toHaveLength(1);
  });

  it("upserts the agent heartbeat", async () => {
    const hb = new DrizzleHeartbeatSink(db);
    await hb.write("testnet", `agent:${AGENT}`, Date.now(), { capitalUsd: 1000, limits: { maxDailyLossUsd: 50 } });
    await hb.write("testnet", `agent:${AGENT}`, Date.now(), { capitalUsd: 900, limits: { maxDailyLossUsd: 50 } });
    const rows = await sql`SELECT detail FROM heartbeats WHERE network = 'testnet' AND service = ${`agent:${AGENT}`}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!["detail"]).toMatchObject({ capitalUsd: 900 });
  });
});
