#!/usr/bin/env node
/**
 * strata-keys CLI. Prints addresses only, never key material.
 *
 *   pnpm --filter @strata/keys new-testnet-key <name> [--keychain]
 *   pnpm --filter @strata/keys show-address <name>
 */
import { KeystoreKeySource, createKeystore } from "./keystore.js";
import { describeError } from "./redact.js";

async function main(argv: string[]): Promise<number> {
  const [command, name, ...flags] = argv;
  if (command === undefined || name === undefined) {
    process.stderr.write("usage: strata-keys <new-testnet-key|show-address> <name> [--keychain]\n");
    return 2;
  }
  switch (command) {
    case "new-testnet-key": {
      const created = await createKeystore(name, { passphraseStore: flags.includes("--keychain") ? "keychain" : "file" });
      process.stdout.write(`${created.name}\n  0x:   ${created.evmAddress}\n  inj:  ${created.injAddress}\n`);
      return 0;
    }
    case "show-address": {
      const handle = await new KeystoreKeySource().load(name);
      process.stdout.write(`${handle.name}\n  0x:   ${handle.evmAddress}\n  inj:  ${handle.injAddress}\n`);
      return 0;
    }
    default:
      process.stderr.write(`unknown command ${command}\n`);
      return 2;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`error: ${describeError(err)}\n`);
    process.exit(1);
  },
);
