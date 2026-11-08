/**
 * Anti-gaming checks (PRD 10.5). Produces the ScoreFlag bitmask per agent, the fills to exclude
 * from markout, and a plain-language evidence list for the Transparency page.
 *
 * - SELF_TRADE: the counterparty subaccount belongs to the agent's own trader address
 *   (any subaccount nonce). Injective subaccount IDs are the 20-byte trader address followed by a
 *   12-byte nonce (source: .claude/skills/injective-funding/SKILL.md, get_subaccount_id).
 * - WASH: the counterparty is linked to the agent without being the same trader: it is the agent's
 *   operator wallet, it belongs to another agent with the same operator, or the two addresses share
 *   a funding source within `fundingHops` hops of bank transfers. Funders listed in
 *   `ignoredFunders` (faucets, bridges, exchanges) and hubs that funded more than
 *   `fundingHubFanout` distinct addresses do not create links.
 * - SPAM: more than `spamMaxOrdersPerMinute` orders posted inside any rolling 60 s window.
 * - SUSPENDED: the arena owner suspended the agent.
 * - DATA_GAP: the scorer saw a fresh book for fewer than `minCoverage` of the agent's samples,
 *   so the epoch cannot be scored fairly.
 * Flicker quotes (alive under 1 s) are handled in metrics.ts by excluding them from book metrics.
 */
import { ScoreFlag, type ScoreFlagName } from "@strata/sdk";
import type { AgentRecord, FillRecord, FundingEdge, OrderRecord } from "./model.js";

export interface AntiGamingParams {
  spamMaxOrdersPerMinute: number;
  fundingHops: number;
  fundingHubFanout: number;
  ignoredFunders: ReadonlySet<string>;
  minCoverage: number;
}

export const DEFAULT_ANTI_GAMING_PARAMS: AntiGamingParams = {
  spamMaxOrdersPerMinute: 1_200,
  fundingHops: 2,
  fundingHubFanout: 25,
  ignoredFunders: new Set(),
  minCoverage: 0.5,
};

export interface AbuseInput {
  agents: readonly AgentRecord[];
  /** Fills executed inside the epoch window. */
  fills: readonly FillRecord[];
  /** Orders posted inside the epoch window. */
  orders: readonly OrderRecord[];
  fundingEdges: readonly FundingEdge[];
  /** Sample coverage per agent (0..1), from metrics. When absent, DATA_GAP is not evaluated. */
  coverage?: ReadonlyMap<number, number>;
  params: AntiGamingParams;
}

export interface FlagEvidence {
  agentId: number;
  flag: ScoreFlagName;
  detail: string;
}

export interface AbuseResult {
  flags: Map<number, number>;
  excludedFillIds: Set<string>;
  evidence: FlagEvidence[];
}

const ADDRESS_HEX_LEN = 42;

export function subaccountOwner(subaccountId: string): string {
  return subaccountId.slice(0, ADDRESS_HEX_LEN).toLowerCase();
}

export function flagNames(bits: number): ScoreFlagName[] {
  return (Object.keys(ScoreFlag) as ScoreFlagName[]).filter((name) => (bits & ScoreFlag[name]) !== 0);
}

/** Addresses reachable by walking "funded by" edges backwards up to `hops` times, including the start. */
function fundingAncestors(start: string, fundersOf: ReadonlyMap<string, readonly string[]>, hops: number, skip: (a: string) => boolean): Set<string> {
  const seen = new Set([start]);
  let frontier = [start];
  for (let depth = 0; depth < hops && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const a of frontier) {
      for (const f of fundersOf.get(a) ?? []) {
        if (skip(f) || seen.has(f)) continue;
        seen.add(f);
        next.push(f);
      }
    }
    frontier = next;
  }
  return seen;
}

function maxOrdersInWindow(postedAt: number[], windowMs: number): number {
  postedAt.sort((a, b) => a - b);
  let best = 0;
  let lo = 0;
  for (let hi = 0; hi < postedAt.length; hi++) {
    while (postedAt[hi]! - postedAt[lo]! >= windowMs) lo++;
    best = Math.max(best, hi - lo + 1);
  }
  return best;
}

export function detectAbuse(input: AbuseInput): AbuseResult {
  const { params } = input;
  const flags = new Map<number, number>();
  const excludedFillIds = new Set<string>();
  const evidence: FlagEvidence[] = [];
  const raise = (agentId: number, flag: ScoreFlagName, detail: string) => {
    const before = flags.get(agentId) ?? 0;
    if ((before & ScoreFlag[flag]) === 0) evidence.push({ agentId, flag, detail });
    flags.set(agentId, before | ScoreFlag[flag]);
  };

  const fundersOf = new Map<string, string[]>();
  const fanout = new Map<string, Set<string>>();
  for (const e of input.fundingEdges) {
    const from = e.from.toLowerCase();
    const to = e.to.toLowerCase();
    const funders = fundersOf.get(to);
    if (funders) funders.push(from);
    else fundersOf.set(to, [from]);
    fanout.set(from, (fanout.get(from) ?? new Set()).add(to));
  }
  const skipFunder = (a: string) => params.ignoredFunders.has(a) || (fanout.get(a)?.size ?? 0) > params.fundingHubFanout;
  const ancestorCache = new Map<string, Set<string>>();
  const ancestors = (a: string) => {
    let s = ancestorCache.get(a);
    if (!s) {
      s = fundingAncestors(a, fundersOf, params.fundingHops, skipFunder);
      ancestorCache.set(a, s);
    }
    return s;
  };
  const fundingLinked = (a: string, b: string) => {
    const sa = ancestors(a);
    for (const x of ancestors(b)) if (sa.has(x)) return true;
    return false;
  };

  const byId = new Map(input.agents.map((a) => [a.agentId, a]));
  for (const a of input.agents) flags.set(a.agentId, 0);

  for (const f of input.fills) {
    const a = byId.get(f.agentId);
    if (!a || f.counterpartySubaccountId === null) continue;
    const trader = subaccountOwner(a.subaccountId);
    const operator = a.operator.toLowerCase();
    const cp = subaccountOwner(f.counterpartySubaccountId);
    if (cp === trader) {
      excludedFillIds.add(f.id);
      raise(a.agentId, "SELF_TRADE", `Fill ${f.id} matched another subaccount of the agent's own trader address.`);
      continue;
    }
    const sameOperatorAgent = input.agents.find(
      (b) => b.agentId !== a.agentId && b.operator.toLowerCase() === operator && (subaccountOwner(b.subaccountId) === cp || b.operator.toLowerCase() === cp),
    );
    let reason: string | null = null;
    if (cp === operator) reason = "the counterparty is the agent's operator wallet";
    else if (sameOperatorAgent) reason = `the counterparty is agent ${sameOperatorAgent.agentId}, which has the same operator`;
    else if (fundingLinked(trader, cp) || fundingLinked(operator, cp)) reason = `the counterparty shares a funding source within ${params.fundingHops} hops`;
    if (reason) {
      excludedFillIds.add(f.id);
      raise(a.agentId, "WASH", `Fill ${f.id}: ${reason}.`);
    }
  }

  const postedByAgent = new Map<number, number[]>();
  for (const o of input.orders) {
    const posted = postedByAgent.get(o.agentId);
    if (posted) posted.push(o.postedAt);
    else postedByAgent.set(o.agentId, [o.postedAt]);
  }
  for (const [agentId, posted] of postedByAgent) {
    if (!byId.has(agentId)) continue;
    const peak = maxOrdersInWindow(posted, 60_000);
    if (peak > params.spamMaxOrdersPerMinute) {
      raise(agentId, "SPAM", `Posted ${peak} orders inside one minute; the limit is ${params.spamMaxOrdersPerMinute}.`);
    }
  }

  for (const a of input.agents) {
    if (a.status === "suspended") raise(a.agentId, "SUSPENDED", "Suspended by the arena owner.");
    if (input.coverage) {
      const gap = checkCoverage(a.agentId, input.coverage.get(a.agentId) ?? 0, params);
      if (gap) raise(a.agentId, gap.flag, gap.detail);
    }
  }
  return { flags, excludedFillIds, evidence };
}

/** DATA_GAP evidence when the agent's sample coverage is below the minimum, else null. */
export function checkCoverage(agentId: number, coverage: number, params: AntiGamingParams): FlagEvidence | null {
  if (coverage >= params.minCoverage) return null;
  return {
    agentId,
    flag: "DATA_GAP",
    detail: `Book data covered ${(coverage * 100).toFixed(1)}% of samples; at least ${params.minCoverage * 100}% is required.`,
  };
}
