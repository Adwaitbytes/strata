/**
 * Closes agent_orders rows that are open in the DB but no longer on the book. The Indexer's
 * open-order list for the subaccount is the truth; rows posted within `graceMs` are left alone so
 * an order the Indexer has not caught up with yet is not closed early. Idempotent: closed rows are
 * never touched again (cancelled_at IS NULL filter). A row whose hash is on the book but whose
 * posted_at differs from the chain createdAt (written by an earlier writer) is a duplicate of the
 * canonical row and is closed too, so one resting order is never counted twice.
 */
import type { Sql } from "@strata/db";
import type { NetworkName } from "@strata/sdk";

export async function closeOrdersMissingFromChain(
  sql: Sql,
  args: { network: NetworkName; agentId: number; open: readonly { orderHash: string; postedAt: Date }[]; observedAt: Date; graceMs?: number },
): Promise<number> {
  const postedBefore = new Date(args.observedAt.getTime() - (args.graceMs ?? 15_000));
  const hashes = args.open.map((o) => o.orderHash.toLowerCase());
  const posted = args.open.map((o) => o.postedAt.toISOString());
  const res = await sql`
    UPDATE agent_orders a SET cancelled_at = ${args.observedAt}
    WHERE a.network = ${args.network} AND a.agent_id = ${args.agentId} AND a.cancelled_at IS NULL
      AND a.posted_at < ${postedBefore}
      AND NOT EXISTS (
        SELECT 1 FROM unnest(${hashes}::text[], ${posted}::timestamptz[]) AS o(order_hash, posted_at)
        WHERE o.order_hash = lower(a.order_hash) AND o.posted_at = a.posted_at)`;
  return res.count;
}
