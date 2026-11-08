import { mkdtemp, readFile, rm, stat, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import { SigningKey, Transaction, keccak256, recoverAddress, Signature, hexlify } from "ethers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  KeySourceError,
  KeystoreKeySource,
  createKeyHandle,
  createKeystore,
  envPassphrase,
  evmToInjAddress,
  filePassphrase,
  injToEvmAddress,
  keystorePath,
  redactSecrets,
} from "./index.js";

// Well-known secp256k1 test vector (scalar 1). Built at runtime so no 32-byte literal sits in the repo.
const TEST_KEY = "0x" + "0".repeat(63) + "1";
const TEST_KEY_ADDRESS = "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf";
const FAST_SCRYPT = 1024;

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "strata-keys-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("address conversion", () => {
  it("round-trips 0x and inj1 forms", () => {
    const inj = evmToInjAddress(TEST_KEY_ADDRESS);
    expect(inj).toMatch(/^inj1[02-9ac-hj-np-z]{38}$/);
    expect(injToEvmAddress(inj).toLowerCase()).toBe(TEST_KEY_ADDRESS.toLowerCase());
  });

  it("rejects a non-inj prefix", () => {
    expect(() => injToEvmAddress("cosmos1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu")).toThrow(KeySourceError);
  });
});

describe("KeyHandle", () => {
  const handle = createKeyHandle("unit", new SigningKey(TEST_KEY));

  it("derives the expected addresses and compressed pubkey", () => {
    expect(handle.evmAddress).toBe(TEST_KEY_ADDRESS);
    expect(handle.publicKeyCompressed).toHaveLength(33);
  });

  it("signs digests that recover to its address", () => {
    const digest = keccak256(new TextEncoder().encode("strata"));
    const sig = handle.signDigest(Uint8Array.from(Buffer.from(digest.slice(2), "hex")));
    const recovered = recoverAddress(digest, Signature.from({ r: hexlify(sig.r), s: hexlify(sig.s), yParity: sig.recovery }));
    expect(recovered).toBe(TEST_KEY_ADDRESS);
  });

  it("rejects digests that are not 32 bytes", () => {
    expect(() => handle.signDigest(new Uint8Array(31))).toThrow(KeySourceError);
  });

  it("signs legacy type 0 EVM transactions from its own address", () => {
    const raw = handle.signLegacyEvmTx({
      chainId: 1439,
      nonce: 0,
      to: TEST_KEY_ADDRESS,
      value: 1n,
      gasLimit: 21_000n,
      gasPrice: 160_000_000n,
    });
    const parsed = Transaction.from(raw);
    expect(parsed.type).toBe(0);
    expect(parsed.from).toBe(TEST_KEY_ADDRESS);
    expect(parsed.gasPrice).toBe(160_000_000n);
  });

  it("never exposes the private key through serialization or inspection", () => {
    const keyHex = TEST_KEY.slice(2);
    expect(JSON.stringify(handle)).not.toContain(keyHex);
    expect(inspect(handle, { showHidden: true, depth: 10 })).not.toContain(keyHex);
    expect(String(handle)).not.toContain(keyHex);
    expect(Object.keys(handle)).not.toContain("privateKey");
    expect(Object.isFrozen(handle)).toBe(true);
  });
});

describe("redactSecrets", () => {
  it("removes 32-byte hex strings with or without 0x", () => {
    const keyHex = "ab".repeat(32);
    expect(redactSecrets(`bad key 0x${keyHex} and ${keyHex}`)).toBe("bad key [REDACTED] and [REDACTED]");
  });

  it("leaves addresses alone", () => {
    expect(redactSecrets(TEST_KEY_ADDRESS)).toBe(TEST_KEY_ADDRESS);
  });
});

describe("keystore", () => {
  it("creates a keystore and passphrase with owner-only permissions, then loads it", async () => {
    const created = await createKeystore("unit-a", { secretsDir: dir, scryptN: FAST_SCRYPT });
    expect(created.evmAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(created.injAddress).toMatch(/^inj1/);

    const ksStat = await stat(keystorePath(dir, "unit-a"));
    expect(ksStat.mode & 0o077).toBe(0);
    const passStat = await stat(join(dir, "unit-a.pass"));
    expect(passStat.mode & 0o077).toBe(0);

    // Web3 Secret Storage v3; ethers writes the section as "Crypto", the spec allows either case.
    const json = JSON.parse(await readFile(keystorePath(dir, "unit-a"), "utf8")) as { version: number; Crypto?: { kdf: string }; crypto?: { kdf: string } };
    expect(json.version).toBe(3);
    expect((json.Crypto ?? json.crypto)?.kdf).toBe("scrypt");

    const source = new KeystoreKeySource({ secretsDir: dir, passphrases: [filePassphrase(dir)] });
    const handle = await source.load("unit-a");
    expect(handle.evmAddress).toBe(created.evmAddress);
    expect(handle.injAddress).toBe(created.injAddress);
  });

  it("refuses to overwrite an existing keystore", async () => {
    await createKeystore("unit-b", { secretsDir: dir, scryptN: FAST_SCRYPT });
    await expect(createKeystore("unit-b", { secretsDir: dir, scryptN: FAST_SCRYPT })).rejects.toThrow(/refusing to overwrite/);
  });

  it("rejects unsafe key names", async () => {
    await expect(createKeystore("../escape", { secretsDir: dir })).rejects.toThrow(KeySourceError);
    await expect(new KeystoreKeySource({ secretsDir: dir }).load("Bad Name")).rejects.toThrow(KeySourceError);
  });

  it("reads the passphrase from env before file", async () => {
    await createKeystore("unit-c", { secretsDir: dir, scryptN: FAST_SCRYPT });
    const real = (await readFile(join(dir, "unit-c.pass"), "utf8")).trim();
    await writeFile(join(dir, "unit-c.pass"), "wrong\n", { mode: 0o600 });
    const source = new KeystoreKeySource({
      secretsDir: dir,
      passphrases: [envPassphrase({ STRATA_KEY_PASS_UNIT_C: real }), filePassphrase(dir)],
    });
    await expect(source.load("unit-c")).resolves.toMatchObject({ name: "unit-c" });
  });

  it("refuses a passphrase file readable by others", async () => {
    await createKeystore("unit-d", { secretsDir: dir, scryptN: FAST_SCRYPT });
    await chmod(join(dir, "unit-d.pass"), 0o644);
    const source = new KeystoreKeySource({ secretsDir: dir, passphrases: [filePassphrase(dir)] });
    await expect(source.load("unit-d")).rejects.toThrow(/chmod 600/);
  });

  it("fails with a redacted error on a wrong passphrase", async () => {
    await createKeystore("unit-e", { secretsDir: dir, scryptN: FAST_SCRYPT });
    const source = new KeystoreKeySource({ secretsDir: dir, passphrases: [envPassphrase({ STRATA_KEY_PASS_UNIT_E: "nope" })] });
    const err = await source.load("unit-e").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KeySourceError);
    expect((err as Error).message).not.toMatch(/[0-9a-fA-F]{64}/);
  });

  it("reports which passphrase providers were tried", async () => {
    await createKeystore("unit-f", { secretsDir: dir, scryptN: FAST_SCRYPT, passphraseStore: "file" });
    await rm(join(dir, "unit-f.pass"));
    const source = new KeystoreKeySource({ secretsDir: dir, passphrases: [envPassphrase({}), filePassphrase(dir)] });
    await expect(source.load("unit-f")).rejects.toThrow(/tried env, file/);
  });
});
