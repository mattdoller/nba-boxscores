#!/usr/bin/env bash
# Lint staged shell scripts (by extension or shebang), including the hooks themselves.
set -uo pipefail
# shellcheck source=../lib.sh
source "$(dirname "$0")/../lib.sh"

files="$( { staged_matching '\.sh$'; staged_with_shebang 'bash|sh'; } | sort -u)"
[[ -n "${files}" ]] || exit 0
have_tool shellcheck || exit 0

status=0
while IFS= read -r file; do
  [[ -n "${file}" ]] || continue

  if ! shellcheck --external-sources --source-path=SCRIPTDIR "${file}"; then
    fail "shellcheck failed for ${file}"
    status=1
  fi
done <<< "${files}"

exit "${status}"
