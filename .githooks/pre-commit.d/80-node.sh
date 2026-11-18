#!/usr/bin/env bash
# Syntax-check staged JavaScript files (the Lambda handlers).
set -uo pipefail
# shellcheck source=../lib.sh
source "$(dirname "$0")/../lib.sh"

files="$(staged_matching '\.(js|mjs|cjs)$')"
[[ -n "${files}" ]] || exit 0
have_tool node || exit 0

status=0
while IFS= read -r file; do
  [[ -n "${file}" ]] || continue

  if ! node --check "${file}"; then
    fail "node --check failed for ${file}"
    status=1
  fi
done <<< "${files}"

exit "${status}"
