#!/usr/bin/env bash
# Prepare .secrets/ for infra/compose/stack.yml without overwriting anything.
#   - generates random values for secrets that only machines read
#   - creates EMPTY placeholders for secrets the owner must supply (Telegram, Anthropic, Neon)
# Empty placeholders mean "not configured": services fall back safely (logs-only alerts,
# shadow-mode tuner). Never prints a secret value.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# Override only for testing the script against a scratch folder.
DIR="${STRATA_SECRETS_DIR:-$ROOT/.secrets}"
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

# Directories need the execute bit to be listable and traversable: 700. Files: 600.
# (A blanket chmod 600 on "$DIR"/* once made keystores/ unlistable.)
find "$DIR" -type d -exec chmod 700 {} +
find "$DIR" -type f -exec chmod 600 {} +

# Verify: fail loudly if anything is group or world accessible, or a directory lost owner rwx.
bad=0
while IFS= read -r d; do
  echo "BAD MODE (dir, want 700): $d" >&2; bad=1
done < <(find "$DIR" -type d \( -perm -g=r -o -perm -g=w -o -perm -g=x -o -perm -o=r -o -perm -o=w -o -perm -o=x -o ! -perm -u=rwx \))
while IFS= read -r f; do
  echo "BAD MODE (file, want 600): $f" >&2; bad=1
done < <(find "$DIR" -type f \( -perm -g=r -o -perm -g=w -o -perm -g=x -o -perm -o=r -o -perm -o=w -o -perm -o=x -o ! -perm -u=rw \))
if (( bad )); then
  echo "init-secrets: permission check failed" >&2
  exit 1
fi
echo "done. Directories 700, files 600 in $DIR (gitignored). Permission check passed."
