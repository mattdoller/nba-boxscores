#!/usr/bin/env bash
# Lint every Ansible tree (any directory holding an ansible.cfg). Slow, so it
# runs on push rather than on every commit.
set -uo pipefail
# shellcheck source=../lib.sh
source "$(dirname "$0")/../lib.sh"

dirs="$(git ls-files -- '*ansible.cfg' 'ansible.cfg' | xargs -r -n1 dirname | sort -u)"
[[ -n "${dirs}" ]] || exit 0
have_tool ansible-lint || exit 0

status=0
while IFS= read -r dir; do
  [[ -n "${dir}" ]] || continue

  if ! (cd "${dir}" && ansible-lint); then
    fail "ansible-lint failed in ${dir}"
    status=1
  fi
done <<< "${dirs}"

exit "${status}"
