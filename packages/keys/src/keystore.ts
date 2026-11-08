import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { SigningKey, Wallet, decryptKeystoreJson, encryptKeystoreJson, isKeystoreJson } from "ethers";
import { createKeyHandle } from "./handle.js";
import { describeError } from "./redact.js";
import type { KeyHandle, KeySource } from "./types.js";
import { KeySourceError } from "./types.js";

const execFileAsync = promisify(execFile);

/** Key names become file names and Keychain accounts, so keep them boring. */
const KEY_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function assertKeyName(name: string): void {
  if (!KEY_NAME.test(name)) {
    throw new KeySourceError(`invalid key name "${name}": use lowercase letters, digits and dashes`);
  }
}

/** Keychain service under which passphrases are stored (`security add-generic-password -s`). */
export const KEYCHAIN_SERVICE = "strata-keystore";

export interface PassphraseProvider {
  readonly label: string;
  get(name: string): Promise<string | null>;
}

/** `STRATA_KEY_PASS_<NAME>` with dashes as underscores. For container hosts (D16). */
export function envPassphrase(env: NodeJS.ProcessEnv = process.env): PassphraseProvider {
  return {
    label: "env",
    get: async (name) => env[`STRATA_KEY_PASS_${name.toUpperCase().replaceAll("-", "_")}`] ?? null,
  };
}

/** `<secretsDir>/<name>.pass`, must not be readable by group or others. */
export function filePassphrase(secretsDir: string): PassphraseProvider {
  return {
    label: "file",
    async get(name) {
      const path = join(secretsDir, `${name}.pass`);
      if (!existsSync(path)) return null;
      const mode = statSync(path).mode & 0o077;
      if (mode !== 0) throw new KeySourceError(`${path} is readable by group or others; run chmod 600`);
      const value = (await readFile(path, "utf8")).trim();
      return value.length > 0 ? value : null;
    },
  };
}

/** macOS Keychain generic password, service `strata-keystore`, account = key name. */
export function keychainPassphrase(): PassphraseProvider {
  return {
    label: "keychain",
    async get(name) {
      if (process.platform !== "darwin") return null;
      try {
        const { stdout } = await execFileAsync("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", name, "-w"]);
        const value = stdout.trim();
        return value.length > 0 ? value : null;
      } catch {
        return null;
      }
    },
  };
}

export async function storePassphraseInKeychain(name: string, passphrase: string): Promise<void> {
  assertKeyName(name);
  // -U updates an existing item. The passphrase is passed as an argv entry to a local process only.
  await execFileAsync("security", ["add-generic-password", "-U", "-s", KEYCHAIN_SERVICE, "-a", name, "-w", passphrase]);
}

/** Walks up from `start` to the directory holding pnpm-workspace.yaml. */
export function findRepoRoot(start: string = process.cwd()): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new KeySourceError("could not find repo root (pnpm-workspace.yaml)");
    dir = parent;
  }
}

export function defaultSecretsDir(): string {
  return process.env.STRATA_SECRETS_DIR ?? join(findRepoRoot(), ".secrets");
}

export function keystorePath(secretsDir: string, name: string): string {
  return join(secretsDir, "keystores", `${name}.json`);
}

export interface KeystoreKeySourceOptions {
  secretsDir?: string;
  /** Tried in order. Default: env, file, keychain. */
  passphrases?: PassphraseProvider[];
}

/** Encrypted JSON keystore (Web3 Secret Storage v3, scrypt) at `<secretsDir>/keystores/<name>.json`. */
export class KeystoreKeySource implements KeySource {
  readonly kind = "keystore";
  private readonly secretsDir: string;
  private readonly providers: PassphraseProvider[];

  constructor(options: KeystoreKeySourceOptions = {}) {
    this.secretsDir = options.secretsDir ?? defaultSecretsDir();
    this.providers = options.passphrases ?? [envPassphrase(), filePassphrase(this.secretsDir), keychainPassphrase()];
  }

  async load(name: string): Promise<KeyHandle> {
    assertKeyName(name);
    const path = keystorePath(this.secretsDir, name);
    if (!existsSync(path)) throw new KeySourceError(`no keystore for "${name}" at ${path}`);
    const json = await readFile(path, "utf8");
    if (!isKeystoreJson(json)) throw new KeySourceError(`${path} is not a Web3 Secret Storage keystore`);

    const passphrase = await this.resolvePassphrase(name);
    try {
      const account = await decryptKeystoreJson(json, passphrase);
      return createKeyHandle(name, new SigningKey(account.privateKey));
    } catch (err) {
      throw new KeySourceError(`could not decrypt keystore "${name}": ${describeError(err)}`);
    }
  }

  private async resolvePassphrase(name: string): Promise<string> {
    for (const provider of this.providers) {
      const value = await provider.get(name);
      if (value !== null) return value;
    }
    const tried = this.providers.map((p) => p.label).join(", ");
    throw new KeySourceError(`no passphrase for "${name}" (tried ${tried})`);
  }
}

export interface CreateKeystoreOptions {
  secretsDir?: string;
  /** Where the generated passphrase goes. */
  passphraseStore?: "file" | "keychain";
  /** scrypt N. Default is the ethers default (2^17). Lower only in tests. */
  scryptN?: number;
}

export interface CreatedKey {
  name: string;
  evmAddress: `0x${string}`;
  injAddress: string;
  keystorePath: string;
}

/**
 * Generates a fresh random key, encrypts it under a random 32-byte passphrase, and stores both.
 * Refuses to overwrite an existing keystore. Returns addresses only.
 */
export async function createKeystore(name: string, options: CreateKeystoreOptions = {}): Promise<CreatedKey> {
  assertKeyName(name);
  const secretsDir = options.secretsDir ?? defaultSecretsDir();
  const path = keystorePath(secretsDir, name);
  if (existsSync(path)) throw new KeySourceError(`keystore "${name}" already exists at ${path}; refusing to overwrite`);

  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(secretsDir, 0o700);
  await chmod(dirname(path), 0o700);

  const wallet = Wallet.createRandom();
  const passphrase = randomBytes(32).toString("base64url");
  const scryptOpts = options.scryptN === undefined ? {} : { scrypt: { N: options.scryptN } };
  const json = await encryptKeystoreJson({ address: wallet.address, privateKey: wallet.privateKey }, passphrase, scryptOpts);

  if ((options.passphraseStore ?? "file") === "keychain") {
    await storePassphraseInKeychain(name, passphrase);
  } else {
    await writeFile(join(secretsDir, `${name}.pass`), passphrase + "\n", { mode: 0o600, flag: "wx" });
  }
  await writeFile(path, json, { mode: 0o600, flag: "wx" });

  const handle = createKeyHandle(name, new SigningKey(wallet.privateKey));
  return { name, evmAddress: handle.evmAddress, injAddress: handle.injAddress, keystorePath: path };
}
