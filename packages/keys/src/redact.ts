/**
 * Strips anything shaped like a raw secp256k1 private key (32 bytes of hex, with or without 0x)
 * and mnemonic-like word runs from a message. Used on every error leaving this package.
 */
const HEX_32 = /(0x)?[0-9a-fA-F]{64}(?![0-9a-fA-F])/g;

export function redactSecrets(text: string): string {
  return text.replace(HEX_32, "[REDACTED]");
}

export function describeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return redactSecrets(raw);
}
