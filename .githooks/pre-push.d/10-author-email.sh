#!/usr/bin/env bash
# Refuse to push commits whose author or committer is the personal address, and
# refuse when the local user.email is still the personal address. This catches
# clones where core.hooksPath was never set and pre-commit never ran.
set -uo pipefail
# shellcheck source=../lib.sh
source "$(dirname "$0")/../lib.sh"

require_env PERSONAL_EMAIL || exit 1
status=0

if [[ "$(git config --get user.email || true)" == "${PERSONAL_EMAIL}" ]]; then
  fail "git user.email is set to the personal address."
  status=1
fi

zero='0000000000000000000000000000000000000000'
while read -r _local_ref local_sha _remote_ref remote_sha; do
  [[ -n "${local_sha}" && "${local_sha}" != "${zero}" ]] || continue

  if [[ "${remote_sha}" == "${zero}" ]]; then
    range="${local_sha} --not --remotes"
  else
    range="${remote_sha}..${local_sha}"
  fi

  # shellcheck disable=SC2086
  offenders="$(git log --format='%h %ae %ce' ${range} | grep -F -- "${PERSONAL_EMAIL}" || true)"
  if [[ -n "${offenders}" ]]; then
    fail "commits to be pushed carry the personal email address:"
    printf '%s\n' "${offenders}" | awk '{print "    " $1}' >&2
    status=1
  fi
done <<< "${HOOK_STDIN:-}"

exit "${status}"
