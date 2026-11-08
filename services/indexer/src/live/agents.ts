/** Subaccount -> agent attribution, loaded from the agents table (populated by the arena poller). */
import type { Sql } from "@strata/db";
import type { NetworkName } from "@strata/sdk";

export interface AgentRef {
  agentId: number;
  subaccountId: string;
}

export async function loadAgents(sql: Sql, network: NetworkName): Promise<AgentRef[]> {
  const rows = await sql<{ agent_id: number; subaccount_id: string }[]>`
    SELECT agent_id, lower(subaccount_id) AS subaccount_id FROM agents WHERE network = ${network} ORDER BY agent_id`;
  return rows.map((r) => ({ agentId: r.agent_id, subaccountId: r.subaccount_id }));
}
