import { inspect } from "node:util";
import { bech32 } from "bech32";
import { SigningKey, Transaction, computeAddress, getBytes, hexlify } from "ethers";
import type { CompactSignature, KeyHandle, LegacyEvmTx } from "./types.js";
import { KeySourceError } from "./types.js";

/**
 * Injective addresses: the same 20 address bytes encoded as 0x hex (EVM) or bech32 with the
 * `inj` prefix (Cosmos). Source: https://docs.injective.network/developers/convert-addresses
 * and the injective-wallet-ops skill (".claude/skills/injective-wallet-ops/SKILL.md").
 */
export function evmToInjAddress(evmAddress: string): string {
  const bytes = getBytes(evmAddress);
  if (bytes.length !== 20) throw new KeySourceError("expected a 20-byte EVM address");
  return bech32.encode("inj", bech32.toWords(bytes));
}

export function injToEvmAddress(injAddress: string): `0x${string}` {
  const { prefix, words } = bech32.decode(injAddress);
  if (prefix !== "inj") throw new KeySourceError(`expected inj prefix, got ${prefix}`);
  return hexlify(Uint8Array.from(bech32.fromWords(words))) as `0x${string}`;
}

const REDACTED = "[KeyHandle redacted]";

/**
 * Wraps a SigningKey in a handle. The SigningKey lives only in this closure; nothing on the
 * returned object references it, so JSON.stringify, spread and inspect cannot reach it.
 */
export function createKeyHandle(name: string, signingKey: SigningKey): KeyHandle {
  const evmAddress = computeAddress(signingKey.publicKey) as `0x${string}`;
  const injAddress = evmToInjAddress(evmAddress);
  const publicKeyCompressed = getBytes(SigningKey.computePublicKey(signingKey.publicKey, true));

  const handle: KeyHandle = {
    name,
    evmAddress,
    injAddress,
    publicKeyCompressed,
    signDigest(digest: Uint8Array): CompactSignature {
      if (digest.length !== 32) throw new KeySourceError("signDigest expects a 32-byte digest");
      const sig = signingKey.sign(digest);
      return { r: getBytes(sig.r), s: getBytes(sig.s), recovery: sig.yParity };
    },
    signLegacyEvmTx(tx: LegacyEvmTx): `0x${string}` {
      const unsigned = Transaction.from({
        type: 0,
        chainId: tx.chainId,
        nonce: tx.nonce,
        to: tx.to,
        value: tx.value,
        gasLimit: tx.gasLimit,
        gasPrice: tx.gasPrice,
        data: tx.data ?? "0x",
      });
      unsigned.signature = signingKey.sign(unsigned.unsignedHash);
      return unsigned.serialized as `0x${string}`;
    },
  };

  Object.defineProperties(handle, {
    toJSON: { value: () => ({ name, evmAddress, injAddress }), enumerable: false },
    [inspect.custom]: { value: () => `${REDACTED} ${name} ${evmAddress}`, enumerable: false },
    toString: { value: () => `${REDACTED} ${name} ${evmAddress}`, enumerable: false },
  });
  return Object.freeze(handle);
}
