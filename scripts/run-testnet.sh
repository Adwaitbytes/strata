#!/usr/bin/env bash
# Supervised testnet process on the host (fallback for the W9 compose stack, D25): restarts the
# child on exit, forwards SIGTERM so agents run their cancel-all before exiting.
#
#   nohup scripts/run-testnet.sh agent strata-test-1 >/dev/null 2>&1 &
#   nohup scripts/run-testnet.sh scorer >/dev/null 2>&1 &
#   nohup scripts/run-testnet.sh options >/dev/null 2>&1 &   (options writer, SIMULATED, no chain orders)
#
# Logs: .run/logs/<name>.log (gitignored). Supervisor pid: .run/<name>.pid, child pid: .run/<name>.child.
# Stop: kill "$(cat .run/<name>.pid)"   (TERM reaches the child, which cancels all orders, then the loop ends)
# Restart the child only (picks up .run/testnet.env changes): kill "$(cat .run/<name>.child)"
#
# Optional overrides, re-read before every start: .run/testnet.env (KEY=VALUE lines), for example
# KILL_SWITCH=true for the env-flag kill path (RUNBOOK 6.3). Testnet only: STRATA_NETWORK is fixed.
set -u
cd "$(dirname "$0")/.." || exit 1
root="$PWD"
kind="${1:?usage: run-testnet.sh <agent <name>|scorer|options>}"

case "$kind" in
  agent)
    name="${2:?agent name required}"
    [[ "$name" =~ ^strata-test-[0-9]+$ ]] || { echo "only testnet house agents (strata-test-N)" >&2; exit 2; }
    agent_id="$(node -e 'const r=require(process.argv[1]);const e=r[process.argv[2]];if(!e||!e.arenaAgentId)process.exit(1);console.log(e.arenaAgentId)' "$root/services/agent/config/enrollments.testnet.json" "$name")" \
      || { echo "$name is not enrolled (services/agent/config/enrollments.testnet.json)" >&2; exit 2; }
    port=$((9470 + ${name##*-}))
    workdir="$root/services/agent"
    cmd=(node --enable-source-maps dist/core/main.js)
    envs=(
      "STRATA_NETWORK=testnet" "AGENT_CONFIG=$name" "AGENT_ID=$agent_id"
      "SECRETS_DIR=$root/.secrets" "STRATA_SECRETS_DIR=$root/.secrets"
      "INTERNAL_KILL_TOKEN_FILE=$root/.secrets/internal_kill_token"
      "METRICS_HOST=127.0.0.1" "METRICS_PORT=$port"
      "ADMIN_OWNER_ADDRESS=0x7f4ae8c67872E0F3Eb8892e3712598622eFc9b54"
    )
    ;;
  scorer)
    name="scorer-testnet"
    workdir="$root/services/scorer"
    cmd=(node --import tsx src/main.ts)
    envs=(
      "STRATA_NETWORK=testnet" "SCORER_API_BASE=${SCORER_API_BASE:-https://strata-api-nine.vercel.app}"
      "SCORER_ATTESTOR_KEY=strata-testnet-attestor" "STRATA_SECRETS_DIR=$root/.secrets"
      "SCORER_METRICS_PORT=9480" "SCORER_EPOCH_SECONDS=3600"
    )
    ;;
  options)
    # PRD 9.8 options writer on the STRATA simulator (docs/OPTIONS.md). Loads no keys and sends no
    # transactions; underlying prices are read-only mainnet oracle queries.
    name="strata-options"
    workdir="$root/services/agent"
    cmd=(node --enable-source-maps dist/options/main.js)
    envs=("STRATA_NETWORK=testnet")
    ;;
  *) echo "unknown kind: $kind" >&2; exit 2 ;;
esac

mkdir -p .run/logs
log=".run/logs/${name}.log"
echo $$ > ".run/${name}.pid"
child=0
stopping=0
trap 'stopping=1; [ "$child" -gt 0 ] && kill -TERM "$child" 2>/dev/null' TERM INT

while [ "$stopping" -eq 0 ]; do
  extra=()
  if [ -f .run/testnet.env ]; then
    while IFS= read -r line; do
      [[ "$line" =~ ^[A-Z_][A-Z0-9_]*=.*$ ]] && extra+=("$line")
    done < .run/testnet.env
  fi
  echo "{\"t\":\"$(date -u +%FT%TZ)\",\"level\":\"info\",\"msg\":\"supervisor starting ${name}\"}" >> "$log"
  (cd "$workdir" && exec env "${envs[@]}" "DATABASE_URL_FILE=$root/.secrets/neon_url" ${extra[@]+"${extra[@]}"} "${cmd[@]}") >> "$log" 2>&1 &
  child=$!
  echo "$child" > ".run/${name}.child"
  wait "$child"
  code=$?
  # wait returns early when a trapped signal arrives; wait again so the child finishes its shutdown.
  while kill -0 "$child" 2>/dev/null; do wait "$child"; code=$?; done
  [ "$stopping" -eq 1 ] && break
  echo "{\"t\":\"$(date -u +%FT%TZ)\",\"level\":\"error\",\"msg\":\"${name} exited, restarting in 10s\",\"code\":${code}}" >> "$log"
  sleep 10 & wait $!
done
rm -f ".run/${name}.child"
echo "{\"t\":\"$(date -u +%FT%TZ)\",\"level\":\"info\",\"msg\":\"supervisor stopped ${name}\"}" >> "$log"
