/**
 * KeySource boundary (DECISIONS D16).
 *
 * A KeySource turns a key name into a KeyHandle. The handle can sign, but it never exposes the
 * private key: there is no getter, it does not serialize, and `util.inspect` prints a redacted
 * placeholder. Swapping the encrypted-keystore backend for AWS KMS later only means writing a
 * new KeySource that returns the same KeyHandle shape.
 */

/** 64-byte compact secp256k1 signature (r || s) plus the recovery bit. */
export interface CompactSignature {
  r: Uint8Array;
  s: Uint8Array;
  recovery: 0 | 1;
}

/** Legacy (type 0) EVM transaction. Injective EVM does not support EIP-1559 (PRD 4.4). */
export interface LegacyEvmTx {
  chainId: number;
  nonce: number;
  to: `0x${string}`;
  value: bigint;
  gasLimit: bigint;
  gasPrice: bigint;
  data?: `0x${string}`;
}

export interface KeyHandle {
  readonly name: string;
  /** Checksummed 0x address. */
  readonly evmAddress: `0x${string}`;
  /** bech32 `inj1...` address of the same key. */
  readonly injAddress: string;
  /** 33-byte compressed secp256k1 public key. */
  readonly publicKeyCompressed: Uint8Array;
  /** Signs a 32-byte digest. The caller is responsible for hashing (Injective Cosmos txs use keccak256). */
  signDigest(digest: Uint8Array): CompactSignature;
  /** Returns the RLP-serialized signed legacy transaction as 0x hex. */
  signLegacyEvmTx(tx: LegacyEvmTx): `0x${string}`;
}

export interface KeySource {
  readonly kind: string;
  load(name: string): Promise<KeyHandle>;
}

/** Raised for every key-related failure. Its message never contains key material. */
export class KeySourceError extends Error {
  override readonly name = "KeySourceError";
}
