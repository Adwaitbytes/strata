#!/usr/bin/env bash
# Copy rules gate (CLAUDE.md, PRD 0.10 and 12.9). Run locally or in CI:
#   scripts/check-copy.sh            scan tracked and untracked (not ignored) files
#   scripts/check-copy.sh --staged   scan staged content of files changed in this commit (pre-commit hook)
# Fails on:
#   1. the em dash (U+2014) anywhere, except vendored or source-of-truth paths
#   2. hype words from PRD 12.9 in UI copy under apps/web
#   3. emoji in UI copy under apps/web
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

MODE="${1:-all}"
case "$MODE" in
  all)
    SCOPE=(--untracked)
    TARGETS=(.)
    ;;
  --staged)
    SCOPE=(--cached)
    # Only files this commit adds or changes, so an old violation elsewhere never blocks it.
    TARGETS=()
    while IFS= read -r f; do TARGETS+=(":(literal)$f"); done < <(git diff --cached --name-only --diff-filter=ACMR)
    if (( ${#TARGETS[@]} == 0 )); then echo "check-copy: nothing staged"; exit 0; fi
    ;;
  *) echo "usage: $0 [--staged]" >&2; exit 2 ;;
esac

# Byte sequence for U+2014 so this file itself never contains the character.
EM_DASH="$(printf '\xe2\x80\x94')"

EXCLUDES=(
  ':(exclude)packages/contracts/lib/**'
  ':(exclude).claude/skills/**'
  ':(exclude)docs/PRD.md'
  ':(exclude)pnpm-lock.yaml'
)

# git grep exits 1 for "no match", >1 for a real error; keep the two apart.
run_grep() {
  local out rc=0
  out="$(git grep "${SCOPE[@]}" "$@")" || rc=$?
  if (( rc > 1 )); then echo "check-copy: git grep failed ($rc)" >&2; exit "$rc"; fi
  printf '%s' "$out"
}

failed=0

hits="$(run_grep -n -I -F -e "$EM_DASH" -- "${TARGETS[@]}" "${EXCLUDES[@]}")"
if [[ -n "$hits" ]]; then
  echo "Em dash (U+2014) found. Use a comma, colon or period:"
  printf '%s\n' "$hits"
  failed=1
fi

UI_PATHS=(
  'apps/web/**/*.tsx' 'apps/web/**/*.ts' 'apps/web/**/*.jsx' 'apps/web/**/*.js'
  'apps/web/**/*.mdx' 'apps/web/**/*.md' 'apps/web/**/*.json' 'apps/web/**/*.html'
)
UI_EXCLUDES=(':(exclude)apps/web/AGENTS.md' ':(exclude)apps/web/CLAUDE.md' ':(exclude)apps/web/package.json')
# In staged mode, intersect with the changed files: git grep ORs positive pathspecs, so
# filter the staged list down to apps/web UI files instead.
if [[ "$MODE" == "--staged" ]]; then
  UI_TARGETS=()
  for t in "${TARGETS[@]}"; do
    f="${t#:(literal)}"
    if [[ "$f" == apps/web/* && "$f" =~ \.(tsx|ts|jsx|js|mdx|md|json|html)$ ]]; then UI_TARGETS+=("$t"); fi
  done
  if (( ${#UI_TARGETS[@]} > 0 )); then UI_PATHS=("${UI_TARGETS[@]}"); else UI_PATHS=(); fi
fi

HYPE='revolutionary|revolutionize[sd]?|revolutionizing|game-chang(ing|er|ers)|seamless(ly)?|unleash(es|ed|ing)?|supercharg(e|es|ed|ing)|empower(s|ed|ing|ment)?'
hits=""
if (( ${#UI_PATHS[@]} > 0 )); then hits="$(run_grep -n -I -i -w -E "$HYPE" -- "${UI_PATHS[@]}" "${UI_EXCLUDES[@]}")"; fi
if [[ -n "$hits" ]]; then
  echo "Hype words in apps/web UI copy (PRD 12.9). Say the specific thing instead:"
  printf '%s\n' "$hits"
  failed=1
fi

# Pictographic emoji ranges. perl handles UTF-8 portably on macOS and Linux.
files=""
if (( ${#UI_PATHS[@]} > 0 )); then files="$(run_grep -l -I -e '' -- "${UI_PATHS[@]}" "${UI_EXCLUDES[@]}")"; fi
if [[ -n "$files" ]]; then
  hits="$(printf '%s\n' "$files" | while IFS= read -r f; do
    [[ -f "$f" ]] || continue
    if [[ "$MODE" == "--staged" ]]; then git show ":$f"; else cat -- "$f"; fi |
      perl -CSD -ne 'print "'"$f"':$.: $_" if /[\x{1F300}-\x{1FAFF}\x{1F000}-\x{1F2FF}\x{2600}-\x{26FF}\x{2700}-\x{27BF}\x{FE0F}]/'
  done)"
  if [[ -n "$hits" ]]; then
    echo "Emoji in apps/web UI copy (PRD 12.9). Use an SVG icon instead:"
    printf '%s\n' "$hits"
    failed=1
  fi
fi

if (( failed )); then exit 1; fi
echo "check-copy: clean"
