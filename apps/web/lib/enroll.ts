/**
 * Pure helpers for the Join wizard: input validation, the enroll call preview, and the starter
 * kit. Kept free of React so they are unit tested.
 */
import { NETWORKS } from "@strata/config";
import type { NetworkName } from "@strata/sdk";
import { defaultSubaccountId } from "./chains";

export const AGENT_NAME = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

export function validateAgentName(name: string): string | null {
  if (!AGENT_NAME.test(name)) return "Use 3 to 32 lowercase letters, digits or hyphens, starting and ending with a letter or digit";
  return null;
}

export function validateErc8004Id(id: string): string | null {
  if (!/^\d{1,78}$/.test(id)) return "Enter the numeric token ID of your ERC-8004 identity";
  if (BigInt(id) === 0n) return "Token ID 0 is not a valid identity";
  return null;
}

export interface EnrollDraft {
  network: NetworkName;
  operator: `0x${string}`;
  erc8004Id: string;
  name: string;
  marketIds: string[];
  /** https:// or ipfs:// URL of the agent's metadata JSON, or "" for none. */
  metadataURI: string;
}

const IPFS = /^ipfs:\/\/[A-Za-z0-9._\-/]+$/;

/**
 * Same rule the API applies before showing a metadata link (apps/api/src/services/metadata-uri.ts):
 * only https:// and ipfs:// URIs, at most 512 characters. Empty means no metadata.
 */
export function validateMetadataUri(uri: string): string | null {
  if (uri === "") return null;
  if (uri.length > 512) return "Keep the URL under 512 characters";
  if (IPFS.test(uri)) return null;
  try {
    const u = new URL(uri);
    if (u.protocol === "https:" && u.hostname.length > 0 && uri.startsWith("https://")) return null;
  } catch {
    // Falls through to the message below.
  }
  return "Use an https:// or ipfs:// URL.";
}

/** The metadata document the operator hosts at metadataURI. */
export function metadataJson(d: Pick<EnrollDraft, "name" | "marketIds">): string {
  return `${JSON.stringify({ name: d.name, markets: d.marketIds, schema: "strata-agent/1" }, null, 2)}\n`;
}

export interface EnrollPreview {
  contract: `0x${string}` | null;
  chainId: number;
  functionName: "enroll";
  args: readonly [bigint, `0x${string}`, string];
  rows: { label: string; value: string; hint?: string }[];
}

export function buildEnrollPreview(d: EnrollDraft): EnrollPreview {
  const net = NETWORKS[d.network];
  const subaccountId = defaultSubaccountId(d.operator);
  return {
    contract: net.contracts.arena,
    chainId: net.evm.chainId,
    functionName: "enroll",
    args: [BigInt(d.erc8004Id), subaccountId, d.metadataURI],
    rows: [
      { label: "Network", value: `${d.network === "mainnet" ? "Injective mainnet" : "Injective testnet"} (chain ${net.evm.chainId})` },
      { label: "Contract", value: net.contracts.arena ?? "Not deployed on this network yet" },
      { label: "Action", value: "StrataArena.enroll", hint: "Registers your agent for scoring and moves no funds" },
      { label: "Operator", value: d.operator, hint: "The connected wallet, which controls the agent's enrollment" },
      { label: "ERC-8004 identity", value: `#${d.erc8004Id}` },
      { label: "Subaccount", value: subaccountId, hint: "Default Injective subaccount (index 0) of the operator" },
      { label: "Agent name", value: d.name },
      { label: "Metadata", value: d.metadataURI || "None", hint: d.metadataURI ? "Public JSON describing the agent" : "You can add it later with updateMetadata" },
      { label: "Markets", value: d.marketIds.length ? `${d.marketIds.length} selected` : "None" },
      { label: "Value sent", value: "0 INJ" },
      { label: "Gas", value: "Legacy transaction, 0.16 gwei gas price", hint: "Injective EVM recommends type 0 transactions" },
    ],
  };
}

export function starterKit(d: EnrollDraft, agentId: string | null): { filename: string; json: string; docker: string } {
  const net = NETWORKS[d.network];
  const config = {
    network: d.network,
    chainId: net.evm.chainId,
    cosmosChainId: net.evm.cosmosChainId,
    rpcUrl: net.evm.rpcUrls[0],
    arena: net.contracts.arena,
    agentId,
    agentName: d.name,
    operator: d.operator,
    subaccountId: defaultSubaccountId(d.operator),
    erc8004Id: d.erc8004Id,
    markets: d.marketIds,
    keySource: "keystore",
  };
  return {
    filename: `strata-agent-${d.name}.json`,
    json: `${JSON.stringify(config, null, 2)}\n`,
    // Image recipe: infra/docker/service.Dockerfile (built from the repo root).
    docker: [
      "docker build -f infra/docker/service.Dockerfile \\",
      "  --build-arg PACKAGE=@strata/agent --build-arg ENTRY=dist/core/main.js -t strata-agent .",
      "docker run --rm -it \\",
      `  -v "$PWD/strata-agent-${d.name}.json:/app/agent.json:ro" \\`,
      '  -v "$PWD/keystore:/run/secrets/keystore:ro" \\',
      `  -e STRATA_NETWORK=${d.network} -e STRATA_AGENT_CONFIG=/app/agent.json \\`,
      "  strata-agent",
    ].join("\n"),
  };
}
