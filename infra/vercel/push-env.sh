#!/usr/bin/env bash
# Push the secret API env vars to Vercel from .secrets/ files, so values never pass
# through shell history or process arguments. Run from the repo root AFTER the projects
# are linked (the orchestrator links and deploys; this script only sets env vars):
#   infra/vercel/push-env.sh
# Non-secret vars (CORS_ORIGINS, NEXT_PUBLIC_*) are listed in infra/vercel/*.env.example.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
API_DIR="$ROOT/apps/api"

if [[ ! -f "$API_DIR/.vercel/project.json" ]] || grep -q '_local_build_only' "$API_DIR/.vercel/project.json"; then
  echo "apps/api is not linked to a Vercel project yet; link it first (vercel link --cwd apps/api)." >&2
  exit 1
fi

push_secret() {
  local name="$1" env="$2" file="$3"
  if [[ ! -s "$file" ]]; then
    echo "skip $name ($env): $file is missing or empty" >&2
    return 0
  fi
  # rm first so re-running updates the value; ignore "not found".
  vercel env rm "$name" "$env" --yes --cwd "$API_DIR" >/dev/null 2>&1 || true
  # Strip the trailing newline so the stored value is exact.
  tr -d '\n' <"$file" | vercel env add "$name" "$env" --cwd "$API_DIR" >/dev/null
  echo "set $name ($env)"
}

push_secret DATABASE_URL production "$ROOT/.secrets/neon_url"
