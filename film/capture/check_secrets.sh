#!/bin/zsh
# Fails if any value from .secrets (or a common secret shape) appears in the film assets. Prints no secret.
set -u
root=${0:A:h:h:h}
targets=("$root/film/assets/data" "$root/film/assets/screens" "$root/film/assets/clips/clips.json" "$root/film/capture")
fail=0
for f in "$root"/.secrets/*(.N); do
  [[ -s $f ]] || continue
  while IFS= read -r v; do
    [[ ${#v} -ge 8 ]] || continue
    if grep -rqF --include='*.json' --include='*.txt' --include='*.mjs' --include='*.py' --include='*.sh' -- "$v" "${targets[@]}"; then
      echo "LEAK: a value from .secrets/${f:t} appears in film assets"; fail=1
    fi
  done < "$f"
done
if grep -rEn -i --include='*.json' --include='*.txt' -e 'postgres(ql)?://|neon\.tech|sk-ant-|AIza[0-9A-Za-z_-]{20}|mnemonic|passphrase *[=:]|BEGIN [A-Z ]*PRIVATE KEY' "${targets[@]}" >/dev/null; then
  echo "LEAK: secret-shaped string in film assets JSON/TXT"; fail=1
fi
if grep -rEn '\b([0-9]{1,3}\.){3}[0-9]{1,3}\b' "$root/film/assets/data" >/dev/null; then
  echo "IP-shaped string in film/assets/data:"; grep -rEon '\b([0-9]{1,3}\.){3}[0-9]{1,3}\b' "$root/film/assets/data" | head; fail=1
fi
[[ $fail -eq 0 ]] && echo "clean: no .secrets values, DB URLs, tokens, keys or IPs in film assets"
exit $fail
