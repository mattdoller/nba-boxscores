#!/usr/bin/env bash
# Syntax-check staged Ruby files (by extension or shebang) using their staged content.
set -uo pipefail
# shellcheck source=../lib.sh
source "$(dirname "$0")/../lib.sh"

files="$( { staged_matching '\.rb$'; staged_with_shebang ruby; } | sort -u)"
[[ -n "${files}" ]] || exit 0
have_tool ruby || exit 0

status=0
while IFS= read -r file; do
  [[ -n "${file}" ]] || continue

  if ! git show ":${file}" | ruby -c >/dev/null 2>/tmp/ruby-check.$$; then
    fail "ruby -c failed for ${file}:"
    sed 's/^/    /' /tmp/ruby-check.$$ >&2
    status=1
  fi
done <<< "${files}"

rm -f /tmp/ruby-check.$$
exit "${status}"
