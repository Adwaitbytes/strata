#!/usr/bin/env bash
# Supervised baseline recorder: restarts on exit. Usage:
#   DATABASE_URL_FILE=<path> LOG_NAME=<name> nohup services/indexer/scripts/run-baseline.sh &
# Logs go to services/indexer/logs/ (gitignored). Stop with: kill $(cat services/indexer/logs/<name>.pid)
set -u
cd "$(dirname "$0")/.."
name="${LOG_NAME:-baseline}"
mkdir -p logs
echo $$ > "logs/${name}.pid"
trap 'kill "${child:-0}" 2>/dev/null; exit 0' TERM INT
while true; do
  node --import tsx src/bin/baseline.ts >> "logs/${name}.log" 2>&1 &
  child=$!
  wait "$child"
  echo "{\"t\":\"$(date -u +%FT%TZ)\",\"level\":\"error\",\"msg\":\"baseline exited, restarting in 5s\",\"code\":$?}" >> "logs/${name}.log"
  sleep 5
done
