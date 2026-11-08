#!/bin/sh
# Container entrypoint for the scorer (D25: long-running process, restart: always).
# Run from the repo root image with the workspace installed. exec hands PID 1 to node so
# SIGTERM from `docker stop` reaches the scheduler and it shuts down cleanly.
# Required env: STRATA_NETWORK, SCORER_API_BASE, DATABASE_URL or DATABASE_URL_FILE, and contract
# addresses unless packages/config has them. Keys: STRATA_SECRETS_DIR plus the attestor keystore (D16).
set -eu
cd "$(dirname "$0")/.."
exec node --import tsx src/main.ts "$@"
