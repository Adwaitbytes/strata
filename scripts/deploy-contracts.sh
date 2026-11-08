#!/usr/bin/env bash
# Deploys the STRATA contracts with Foundry and verifies them on Injective Blockscout.
#
# Usage (from repo root):
#   scripts/deploy-contracts.sh testnet            # dry run: simulate against the live testnet RPC
#   scripts/deploy-contracts.sh testnet --broadcast # deploy, verify, write packages/contracts/deployments/testnet.json
#
# Env (optional):
#   KEYSTORE       encrypted keystore   (default .secrets/keystores/strata-testnet-deployer)
#   PASSWORD_FILE  keystore passphrase  (default .secrets/strata-testnet-deployer.password)
#   OWNER          contract owner       (default: deployer address on testnet; REQUIRED on mainnet)
#   ATTESTOR       epoch poster         (default: deployer address on testnet; REQUIRED on mainnet)
#   IDENTITY_REGISTRY  override the ERC-8004 identity registry
#
# Network constants: docs.injective.network/developers-evm/network-information (PRD 4.3).
# Verifier URL: docs.injective.network/developers-evm/smart-contracts/verify-foundry.
# Identity registries: github.com/InjectiveLabs/injective-agent-sdk packages/sdk/src/config.ts
#   (commit 381a27087a1c850d00003476979fafe9e9a2f2f8), checked live on chain (ERC-721 supportsInterface true).
# Injective EVM has no EIP-1559: legacy txs with gasPrice 160e6 (injective-evm-developer skill).
#
# Mainnet is refused unless STRATA_ALLOW_MAINNET=yes, set only by the orchestrator after the
# PRD Section 16 gate passes with an owner-provided hardware wallet or Safe as OWNER.
set -euo pipefail

NETWORK="${1:-}"
MODE="${2:-}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACTS="$ROOT/packages/contracts"

case "$NETWORK" in
  testnet)
    CHAIN_ID=1439
    RPC_URL="https://k8s.testnet.json-rpc.injective.network/"
    VERIFIER_URL="https://testnet.blockscout-api.injective.network/api/"
    EXPLORER="https://testnet.blockscout.injective.network"
    DEFAULT_REGISTRY="0x8004A818BFB912233c491871b3d84c89A494BD9e"
    ;;
  mainnet)
    if [[ "${STRATA_ALLOW_MAINNET:-}" != "yes" ]]; then
      echo "refusing mainnet: set STRATA_ALLOW_MAINNET=yes only with the orchestrator's go-ahead" >&2
      exit 1
    fi
    CHAIN_ID=1776
    RPC_URL="https://sentry.evm-rpc.injective.network/"
    VERIFIER_URL="https://blockscout-api.injective.network/api/"
    EXPLORER="https://blockscout.injective.network"
    DEFAULT_REGISTRY="0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"
    : "${OWNER:?OWNER is required on mainnet (hardware wallet or Safe)}"
    : "${ATTESTOR:?ATTESTOR is required on mainnet}"
    ;;
  *)
    echo "usage: $0 <testnet|mainnet> [--broadcast]" >&2
    exit 1
    ;;
esac

case "$MODE" in
  "" | --broadcast) ;;
  *) echo "unknown option: $MODE" >&2; exit 1 ;;
esac

KEYSTORE="${KEYSTORE:-$ROOT/.secrets/keystores/strata-testnet-deployer}"
PASSWORD_FILE="${PASSWORD_FILE:-$ROOT/.secrets/strata-testnet-deployer.password}"
[[ -f "$KEYSTORE" ]] || { echo "keystore not found: $KEYSTORE" >&2; exit 1; }
[[ -f "$PASSWORD_FILE" ]] || { echo "password file not found: $PASSWORD_FILE" >&2; exit 1; }

actual_chain="$(cast chain-id --rpc-url "$RPC_URL")"
[[ "$actual_chain" == "$CHAIN_ID" ]] || { echo "RPC chain id $actual_chain != expected $CHAIN_ID" >&2; exit 1; }

DEPLOYER="$(cast wallet address --keystore "$KEYSTORE" --password-file "$PASSWORD_FILE")"
export OWNER="${OWNER:-$DEPLOYER}"
export ATTESTOR="${ATTESTOR:-$DEPLOYER}"
export IDENTITY_REGISTRY="${IDENTITY_REGISTRY:-$DEFAULT_REGISTRY}"

balance="$(cast balance "$DEPLOYER" --rpc-url "$RPC_URL")"
echo "network=$NETWORK chain=$CHAIN_ID deployer=$DEPLOYER balance=${balance}wei"
echo "owner=$OWNER attestor=$ATTESTOR identityRegistry=$IDENTITY_REGISTRY"

forge_args=(
  script script/Deploy.s.sol:Deploy
  --rpc-url "$RPC_URL"
  --keystore "$KEYSTORE" --password-file "$PASSWORD_FILE" --sender "$DEPLOYER"
  --legacy --with-gas-price 160000000
)

cd "$CONTRACTS"
if [[ "$MODE" != "--broadcast" ]]; then
  echo "dry run (no --broadcast): simulating against $RPC_URL"
  forge "${forge_args[@]}"
  exit 0
fi

if [[ "$balance" == "0" ]]; then
  echo "deployer $DEPLOYER has no INJ on $NETWORK; fund it first (https://testnet.faucet.injective.network/)" >&2
  exit 1
fi

forge "${forge_args[@]}" --broadcast --slow

RUN_JSON="$CONTRACTS/broadcast/Deploy.s.sol/$CHAIN_ID/run-latest.json"
OUT="$CONTRACTS/deployments/$NETWORK.json"
mkdir -p "$CONTRACTS/deployments"
export NETWORK CHAIN_ID DEPLOYER EXPLORER

node --input-type=module - "$RUN_JSON" "$OUT" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const [runPath, outPath] = process.argv.slice(2);
const run = JSON.parse(readFileSync(runPath, "utf8"));
const env = process.env;
const contracts = {};
for (const tx of run.transactions) {
  if (tx.transactionType !== "CREATE") continue;
  const receipt = run.receipts.find((r) => r.transactionHash === tx.hash);
  contracts[tx.contractName] = {
    address: tx.contractAddress,
    txHash: tx.hash,
    block: receipt ? Number(BigInt(receipt.blockNumber)) : null,
    constructorArgs: tx.arguments ?? [],
  };
}
for (const name of ["StrataArena", "ScoreAttestor"]) {
  if (!contracts[name]) throw new Error(`missing ${name} in ${runPath}`);
}
const out = {
  network: env.NETWORK,
  chainId: Number(env.CHAIN_ID),
  deployer: env.DEPLOYER,
  owner: env.OWNER,
  attestor: env.ATTESTOR,
  identityRegistry: env.IDENTITY_REGISTRY,
  explorer: env.EXPLORER,
  deployedAt: new Date(run.timestamp * 1000).toISOString(),
  contracts,
};
writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${outPath}`);
NODE

addr() { node -e 'const d=require(process.argv[1]);const c=d.contracts[process.argv[2]];process.stdout.write(c?c.address:"")' "$OUT" "$1"; }
ARENA="$(addr StrataArena)"
ATTESTOR_C="$(addr ScoreAttestor)"
REWARDS="$(addr RewardsDistributor)"

verify() {
  local address="$1" target="$2" args="$3"
  forge verify-contract --rpc-url "$RPC_URL" --verifier blockscout --verifier-url "$VERIFIER_URL" \
    --constructor-args "$args" --watch "$address" "$target" \
    || echo "verification failed for $target at $address; rerun this step" >&2
}
verify "$ARENA" src/StrataArena.sol:StrataArena "$(cast abi-encode 'c(address,address,address)' "$OWNER" "$ATTESTOR" "$IDENTITY_REGISTRY")"
verify "$ATTESTOR_C" src/ScoreAttestor.sol:ScoreAttestor "$(cast abi-encode 'c(address)' "$ARENA")"
if [[ -n "$REWARDS" ]]; then
  verify "$REWARDS" src/RewardsDistributor.sol:RewardsDistributor "$(cast abi-encode 'c(address)' "$OWNER")"
fi

echo "StrataArena        $EXPLORER/address/$ARENA"
echo "ScoreAttestor      $EXPLORER/address/$ATTESTOR_C"
[[ -n "$REWARDS" ]] && echo "RewardsDistributor $EXPLORER/address/$REWARDS"
