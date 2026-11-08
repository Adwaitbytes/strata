#!/usr/bin/env bash
# Prepare .secrets/ for infra/compose/stack.yml without overwriting anything.
#   - generates random values for secrets that only machines read
#   - creates EMPTY placeholders for secrets the owner must supply (Telegram, Anthropic, Neon)
# Empty placeholders mean "not configured": services fall back safely (logs-only alerts,
# shadow-mode tuner). Never prints a secret value.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DIR="$ROOT/.secrets"
umask 077
mkdir -p "$DIR" "$DIR/keystores"
chmod 700 "$DIR" "$DIR/keystores"

gen() {
  local name="$1"
  if [[ -s "$DIR/$name" ]]; then
    echo "keep      .secrets/$name"
  else
    openssl rand -hex 32 >"$DIR/$name"
    echo "generated .secrets/$name"
  fi
}

placeholder() {
  local name="$1" hint="$2"
  if [[ -e "$DIR/$name" ]]; then
    if [[ -s "$DIR/$name" ]]; then echo "keep      .secrets/$name"; else echo "EMPTY     .secrets/$name  ($hint)"; fi
  else
    : >"$DIR/$name"
    echo "created   .secrets/$name (empty: $hint)"
  fi
}

gen internal_kill_token
gen grafana_admin_password
gen db_password
placeholder telegram_bot_token "owner: BotFather token, docs/RUNBOOK.md Telegram setup"
placeholder telegram_chat_ids "owner: chat id(s), docs/RUNBOOK.md Telegram setup"
placeholder anthropic_api_key "owner (D29): leave empty for shadow-mode tuner"
placeholder neon_url "owner (D26): Neon connection string"

chmod 600 "$DIR"/* 2>/dev/null || true
echo "done. Files are mode 600 in $DIR (gitignored)."
