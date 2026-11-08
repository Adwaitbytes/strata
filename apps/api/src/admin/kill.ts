/**
 * Signed kill switch (PRD 9.6 b, 16.2). The owner wallet signs an EIP-191 personal message
 * built from every request field; the server checks signer, expiry and a single-use nonce,
 * then records a kill command that agents pick up from the `kill_commands` table.
 */
import { randomUUID } from "node:crypto";
import { verifyMessage } from "viem";
import { killRequestMessage, type KillRequest } from "@strata/sdk";
import { HttpError } from "../errors.js";
import type { KillCommandInput, Repository } from "../repo/types.js";

/** A signed request may be valid for at most this long, which bounds the replay window. */
export const KILL_MAX_TTL_MS = 10 * 60_000;

/** Extra nonce constraints on top of the sdk schema (min 16): bounded length, URL-safe charset. */
export const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

async function signatureMatches(owner: `0x${string}`, req: KillRequest): Promise<boolean> {
  try {
    return await verifyMessage({ address: owner, message: killRequestMessage(req), signature: req.signature as `0x${string}` });
  } catch {
    // Malformed signatures throw inside viem; to the caller they are simply not the owner's.
    return false;
  }
}

export interface KillDeps {
  repo: Repository;
  owner: `0x${string}` | null;
  now: () => number;
}

export async function acceptKill(deps: KillDeps, req: KillRequest): Promise<KillCommandInput> {
  if (!deps.owner) throw new HttpError("unavailable", "admin is not configured");
  if (!NONCE_PATTERN.test(req.nonce)) throw new HttpError("bad_request", "invalid body: nonce");
  const now = deps.now();
  if (req.expiresAt > now + KILL_MAX_TTL_MS) throw new HttpError("bad_request", "invalid body: expiresAt too far ahead");
  if (req.expiresAt <= now) throw new HttpError("unauthorized", "request expired");
  if (!(await signatureMatches(deps.owner, req))) throw new HttpError("unauthorized", "signature not from owner");

  const cmd: KillCommandInput = {
    id: randomUUID(),
    network: req.network,
    targetAgentId: req.target === "all" ? null : req.target,
    closePositions: req.closePositions,
    signer: deps.owner,
    nonce: req.nonce,
    requestedAt: now,
    signatureExpiresAt: req.expiresAt,
  };
  const result = await deps.repo.insertKillCommand(cmd);
  if (result === "nonce_reused") throw new HttpError("unauthorized", "nonce already used");
  return cmd;
}
