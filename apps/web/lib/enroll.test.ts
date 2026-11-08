import { describe, expect, it } from "vitest";
import { NETWORKS } from "@strata/config";
import { buildEnrollPreview, metadataJson, starterKit, validateAgentName, validateErc8004Id, validateMetadataUri } from "./enroll";

const draft = {
  network: "testnet" as const,
  operator: "0xAbCdEf0123456789abcdef0123456789ABCDEF01" as const,
  erc8004Id: "42",
  name: "my-agent",
  marketIds: ["0x01"],
  metadataURI: "ipfs://bafyexample/agent.json",
};

describe("enroll helpers", () => {
  it("validates agent names", () => {
    expect(validateAgentName("my-agent")).toBeNull();
    expect(validateAgentName("My Agent")).not.toBeNull();
    expect(validateAgentName("-bad")).not.toBeNull();
  });

  it("validates ERC-8004 ids", () => {
    expect(validateErc8004Id("42")).toBeNull();
    expect(validateErc8004Id("0")).not.toBeNull();
    expect(validateErc8004Id("4a")).not.toBeNull();
  });

  it("accepts only https and ipfs metadata URIs, like the API", () => {
    expect(validateMetadataUri("")).toBeNull();
    expect(validateMetadataUri("https://example.com/agent.json")).toBeNull();
    expect(validateMetadataUri("ipfs://bafyexample/agent.json")).toBeNull();
    expect(validateMetadataUri("http://example.com/a.json")).not.toBeNull();
    expect(validateMetadataUri("data:application/json;base64,e30=")).not.toBeNull();
    expect(validateMetadataUri("javascript:alert(1)")).not.toBeNull();
  });

  it("produces the metadata document to host", () => {
    expect(JSON.parse(metadataJson(draft))).toEqual({ name: "my-agent", markets: ["0x01"], schema: "strata-agent/1" });
  });

  it("builds enroll args in contract order and a readable preview", () => {
    const p = buildEnrollPreview(draft);
    expect(p.chainId).toBe(1439);
    expect(p.args[0]).toBe(42n);
    expect(p.args[1]).toBe("0xabcdef0123456789abcdef0123456789abcdef01000000000000000000000000");
    expect(p.args[2]).toBe("ipfs://bafyexample/agent.json");
    expect(p.rows.find((r) => r.label === "Value sent")?.value).toBe("0 INJ");
    // The target is always the configured arena; when none is configured the preview says so instead of inventing an address.
    const arena = NETWORKS.testnet.contracts.arena;
    expect(p.contract).toBe(arena);
    expect(p.rows.find((r) => r.label === "Contract")?.value).toBe(arena ?? "Not deployed on this network yet");
  });

  it("starter kit never contains key material", () => {
    const kit = starterKit(draft, null);
    expect(kit.json).not.toMatch(/private|mnemonic|secret/i);
    expect(JSON.parse(kit.json).chainId).toBe(1439);
  });
});
