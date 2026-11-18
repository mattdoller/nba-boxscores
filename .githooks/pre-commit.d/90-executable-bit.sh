#!/usr/bin/env bash
# Files with a shebang under scripts/, bin/ and .githooks/ must be executable.
# A forgotten chmod +x on a hook silently disables it.
set -uo pipefail
# shellcheck source=../lib.sh
source "$(dirname "$0")/../lib.sh"

status=0
while IFS= read -r file; do
  [[ -n "${file}" ]] || continue

  case "${file}" in
    .githooks/lib.sh|.githooks/config.sh) continue ;;
    .githooks/*|scripts/*|bin/*) ;;
    *) continue ;;
  esac

  if ! git show ":${file}" | head -c 2 | grep -q '^#!'; then
    continue
  fi

  mode="$(git ls-files --stage -- "${file}" | awk '{print $1}')"
  if [[ "${mode}" != "100755" ]]; then
    fail "${file} has a shebang but is not executable; run: chmod +x ${file} && git add ${file}"
    status=1
  fi
done < <(staged_files)

exit "${status}"
