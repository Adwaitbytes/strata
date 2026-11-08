/**
 * Agent metadata URIs come from operators on chain, so they are untrusted. Only https: and
 * ipfs: are ever emitted (security finding L-8); anything else (javascript:, data:, http:,
 * whitespace tricks) is replaced by "" before it reaches a client that might render a link.
 */
import { z } from "zod";

const IPFS = /^ipfs:\/\/[A-Za-z0-9._\-/]+$/;

export function isSafeMetadataUri(uri: string): boolean {
  if (uri.length > 512) return false;
  if (IPFS.test(uri)) return true;
  if (!uri.startsWith("https://")) return false;
  try {
    const u = new URL(uri);
    return u.protocol === "https:" && u.hostname.length > 0 && u.href.length <= 1024;
  } catch {
    return false;
  }
}

export const SafeMetadataUri = z.string().max(512).refine(isSafeMetadataUri, "metadataURI must be an https:// or ipfs:// URI");
