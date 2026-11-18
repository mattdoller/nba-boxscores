#!/usr/bin/env bash
# Scan every commit in the pushed range for secrets. Fails closed when gitleaks
# is missing. Branch deletions are skipped.
set -uo pipefail
# shellcheck source=../lib.sh
source "$(dirname "$0")/../lib.sh"

if ! command -v gitleaks >/dev/null 2>&1; then
  fail "gitleaks is not installed; refusing to push without a secret scan."
  exit 1
fi

root="$(git rev-parse --show-toplevel)"
zero='0000000000000000000000000000000000000000'
status=0

while read -r _local_ref local_sha _remote_ref remote_sha; do
  [[ -n "${local_sha}" && "${local_sha}" != "${zero}" ]] || continue

  if [[ "${remote_sha}" == "${zero}" ]]; then
    range="${local_sha} --not --remotes"
  else
    range="${remote_sha}..${local_sha}"
  fi

  if ! gitleaks detect --source "${root}" --redact --no-banner --config "${root}/.gitleaks.toml" --log-opts="${range}"; then
    fail "gitleaks found secrets in ${range}"
    status=1
  fi
done <<< "${HOOK_STDIN:-}"

exit "${status}"
