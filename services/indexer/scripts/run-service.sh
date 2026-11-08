#!/usr/bin/env bash
# Supervised long-running service: restarts on exit. Usage:
#   DATABASE_URL_FILE=<path> LOG_NAME=<name> nohup services/indexer/scripts/run-service.sh <baseline|indexer> &
# Logs go to services/indexer/logs/<name>.log (gitignored). Stop with: kill $(cat services/indexer/logs/<name>.pid)
set -u
cd "$(dirname "$0")/.."
service="${1:?usage: run-service.sh <baseline|indexer>}"
case "$service" in baseline|indexer) ;; *) echo "unknown service: $service" >&2; exit 2 ;; esac
name="${LOG_NAME:-$service}"
mkdir -p logs
echo $$ > "logs/${name}.pid"
child=0
trap 'kill "$child" 2>/dev/null; exit 0' TERM INT
while true; do
  node --import tsx "src/bin/${service}.ts" >> "logs/${name}.log" 2>&1 &
  child=$!
  wait "$child"
  code=$?
  echo "{\"t\":\"$(date -u +%FT%TZ)\",\"level\":\"error\",\"msg\":\"${service} exited, restarting in 5s\",\"code\":${code}}" >> "logs/${name}.log"
  sleep 5
done
