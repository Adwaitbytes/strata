#!/usr/bin/env bash
# Deploys, verifies and configures the STRATA contracts with Foundry.
#
# Usage (from repo root):
#   scripts/deploy-contracts.sh testnet              # dry run: simulate the deploy against the live testnet RPC
#   scripts/deploy-contracts.sh testnet --broadcast  # deploy, write deployments/testnet.json, then verify
#   scripts/deploy-contracts.sh testnet --verify     # (re)verify the addresses in deployments/testnet.json
#   scripts/deploy-contracts.sh testnet --configure  # start a season (if none active) and set arena markets
#
# Env (optional):
#   KEYSTORE       encrypted keystore   (default .secrets/keystores/strata-testnet-deployer)
#   PASSWORD_FILE  keystore passphrase  (default .secrets/strata-testnet-deployer.password)
#   OWNER          contract owner       (default: deployer on testnet; REQUIRED on mainnet, must be a Safe)
#   ATTESTOR       epoch poster         (default: deployer on testnet; REQUIRED on mainnet, must differ from OWNER)
#   IDENTITY_REGISTRY  override the ERC-8004 identity registry
#   --configure:   SEASON_END (unix seconds, required), SEASON_START (default now), EPOCH_SECONDS (default 3600)
#
# Network constants: docs.injective.network/developers-evm/network-information (PRD 4.3).
# Identity registries: github.com/InjectiveLabs/injective-agent-sdk packages/sdk/src/config.ts
#   (commit 381a27087a1c850d00003476979fafe9e9a2f2f8), checked live on chain (ERC-721 supportsInterface true).
# Injective EVM has no EIP-1559: legacy txs with gasPrice 160e6 (injective-evm-developer skill).
#
# Verification. Sourcify (sourcify.dev lists chain 1439 and 1776 as supported) is the primary verifier and
# returns an exact match. Blockscout is also attempted through its etherscan-compatible API on the explorer
# host; the host named in the docs (testnet.blockscout-api.injective.network) does not resolve. As of
# 2026-11-09 the Injective testnet Blockscout verifier answers "Fail - Unable to verify" for every submission,
# including a trivial Counter (control test), so its result is reported but does not fail the run.
#
# Mainnet is refused unless STRATA_ALLOW_MAINNET=yes, set only by the orchestrator after the PRD Section 16
# gate passes. Deploy.s.sol also refuses a mainnet OWNER that is not a contract or equals ATTESTOR.
set -euo pipefail

NETWORK="${1:-}"
MODE="${2:-}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACTS="$ROOT/packages/contracts"

case "$NETWORK" in
  testnet)
    CHAIN_ID=1439
    RPC_URL="https://k8s.testnet.json-rpc.injective.network/"
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
    EXPLORER="https://blockscout.injective.network"
    DEFAULT_REGISTRY="0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"
    : "${OWNER:?OWNER is required on mainnet (Safe)}"
    : "${ATTESTOR:?ATTESTOR is required on mainnet}"
    if [[ "$(echo "$OWNER" | tr 'A-F' 'a-f')" == "$(echo "$ATTESTOR" | tr 'A-F' 'a-f')" ]]; then
      echo "refusing mainnet: OWNER must differ from ATTESTOR" >&2
      exit 1
    fi
    ;;
  *)
    echo "usage: $0 <testnet|mainnet> [--broadcast|--verify|--configure]" >&2
    exit 1
    ;;
esac
BLOCKSCOUT_API="$EXPLORER/api/"

case "$MODE" in
  "" | --broadcast | --verify | --configure) ;;
  *) echo "unknown option: $MODE" >&2; exit 1 ;;
esac

KEYSTORE="${KEYSTORE:-$ROOT/.secrets/keystores/strata-testnet-deployer}"
PASSWORD_FILE="${PASSWORD_FILE:-$ROOT/.secrets/strata-testnet-deployer.password}"
[[ -f "$KEYSTORE" ]] || { echo "keystore not found: $KEYSTORE" >&2; exit 1; }
[[ -f "$PASSWORD_FILE" ]] || { echo "password file not found: $PASSWORD_FILE" >&2; exit 1; }

actual_chain="$(cast chain-id --rpc-url "$RPC_URL")"
[[ "$actual_chain" == "$CHAIN_ID" ]] || { echo "RPC chain id $actual_chain != expected $CHAIN_ID" >&2; exit 1; }

DEPLOYER="$(cast wallet address --keystore "$KEYSTORE" --password-file "$PASSWORD_FILE")"
OUT="$CONTRACTS/deployments/$NETWORK.json"
signer_args=(--keystore "$KEYSTORE" --password-file "$PASSWORD_FILE" --sender "$DEPLOYER")
tx_args=(--rpc-url "$RPC_URL" --legacy --with-gas-price 160000000)

json_get() { node -e 'const d=require(process.argv[1]);const v=process.argv[2].split(".").reduce((o,k)=>o?.[k],d);process.stdout.write(v??"")' "$OUT" "$1"; }

blockscout_status() {
  curl -s "$EXPLORER/api/v2/smart-contracts/$1" |
    node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const d=JSON.parse(s);process.stdout.write(String(d.is_verified===true))}catch{process.stdout.write("unknown")}})'
}

verify_one() {
  local address="$1" target="$2" args="$3"
  echo "verify $target at $address"
  if forge verify-contract --rpc-url "$RPC_URL" --verifier sourcify --constructor-args "$args" --watch \
    "$address" "$target"; then
    echo "  sourcify: verified"
  else
    echo "  sourcify: FAILED for $target at $address" >&2
    VERIFY_FAILED=1
  fi
  forge verify-contract --rpc-url "$RPC_URL" --verifier blockscout --verifier-url "$BLOCKSCOUT_API" \
    --constructor-args "$args" --watch "$address" "$target" >/dev/null 2>&1 || true
  echo "  blockscout is_verified: $(blockscout_status "$address") ($EXPLORER/address/$address)"
}

verify_all() {
  [[ -f "$OUT" ]] || { echo "no deployment file: $OUT" >&2; exit 1; }
  local owner attestor registry arena att rewards
  owner="$(json_get owner)"
  attestor="$(json_get attestor)"
  registry="$(json_get identityRegistry)"
  arena="$(json_get contracts.StrataArena.address)"
  att="$(json_get contracts.ScoreAttestor.address)"
  rewards="$(json_get contracts.RewardsDistributor.address)"
  VERIFY_FAILED=0
  cd "$CONTRACTS"
  verify_one "$arena" src/StrataArena.sol:StrataArena \
    "$(cast abi-encode 'c(address,address,address)' "$owner" "$attestor" "$registry")"
  verify_one "$att" src/ScoreAttestor.sol:ScoreAttestor "$(cast abi-encode 'c(address)' "$arena")"
  if [[ -n "$rewards" ]]; then
    verify_one "$rewards" src/RewardsDistributor.sol:RewardsDistributor "$(cast abi-encode 'c(address)' "$owner")"
  fi
  echo "Sourcify: https://repo.sourcify.dev/$CHAIN_ID/$arena"
  [[ "$VERIFY_FAILED" == 0 ]] || { echo "one or more Sourcify verifications failed" >&2; exit 1; }
}

if [[ "$MODE" == "--verify" ]]; then
  verify_all
  exit 0
fi

if [[ "$MODE" == "--configure" ]]; then
  : "${SEASON_END:?SEASON_END (unix seconds) is required}"
  ARENA="$(json_get contracts.StrataArena.address)"
  [[ -n "$ARENA" ]] || { echo "no StrataArena in $OUT" >&2; exit 1; }
  export ARENA SEASON_END
  export MARKETS_JSON="${MARKETS_JSON:-../config/src/generated/markets.$NETWORK.json}"
  cd "$CONTRACTS"
  forge script script/ConfigureSeason.s.sol:ConfigureSeason "${tx_args[@]}" "${signer_args[@]}" --broadcast --slow
  exit 0
fi

export OWNER="${OWNER:-$DEPLOYER}"
export ATTESTOR="${ATTESTOR:-$DEPLOYER}"
export IDENTITY_REGISTRY="${IDENTITY_REGISTRY:-$DEFAULT_REGISTRY}"

balance="$(cast balance "$DEPLOYER" --rpc-url "$RPC_URL")"
echo "network=$NETWORK chain=$CHAIN_ID deployer=$DEPLOYER balance=${balance}wei"
echo "owner=$OWNER attestor=$ATTESTOR identityRegistry=$IDENTITY_REGISTRY"

deploy_args=(script script/Deploy.s.sol:Deploy "${tx_args[@]}" "${signer_args[@]}")

cd "$CONTRACTS"
if [[ "$MODE" != "--broadcast" ]]; then
  echo "dry run (no --broadcast): simulating against $RPC_URL"
  forge "${deploy_args[@]}"
  exit 0
fi

if [[ "$balance" == "0" ]]; then
  echo "deployer $DEPLOYER has no INJ on $NETWORK; fund it first (https://testnet.faucet.injective.network/)" >&2
  exit 1
fi

forge "${deploy_args[@]}" --broadcast --slow

RUN_JSON="$CONTRACTS/broadcast/Deploy.s.sol/$CHAIN_ID/run-latest.json"
mkdir -p "$CONTRACTS/deployments"
export NETWORK CHAIN_ID DEPLOYER EXPLORER

node --input-type=module - "$RUN_JSON" "$OUT" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
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
// Foundry writes run.timestamp in milliseconds in current releases and seconds in older ones.
const tsMs = run.timestamp > 1e12 ? run.timestamp : run.timestamp * 1000;
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const out = {
  network: env.NETWORK,
  chainId: Number(env.CHAIN_ID),
  deployer: env.DEPLOYER,
  owner: env.OWNER,
  attestor: env.ATTESTOR,
  identityRegistry: env.IDENTITY_REGISTRY,
  explorer: env.EXPLORER,
  deployedAt: new Date(tsMs).toISOString(),
  gitCommit: commit,
  contracts,
};
writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${outPath}`);
NODE

verify_all
