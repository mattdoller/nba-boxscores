#!/usr/bin/env bash
# Format and validate Terraform in every directory that has a staged .tf file.
set -uo pipefail
# shellcheck source=../lib.sh
source "$(dirname "$0")/../lib.sh"

dirs="$(staged_matching '\.tf$' | xargs -r -n1 dirname | sort -u)"
[[ -n "${dirs}" ]] || exit 0
have_tool terraform || exit 0

status=0
while IFS= read -r dir; do
  [[ -n "${dir}" ]] || continue

  if ! terraform -chdir="${dir}" fmt -check; then
    fail "terraform fmt found unformatted files in ${dir}; run: terraform -chdir=${dir} fmt"
    status=1
  fi

  if [[ -d "${dir}/.terraform" ]]; then
    if ! terraform -chdir="${dir}" validate -no-color; then
      fail "terraform validate failed in ${dir}"
      status=1
    fi
  else
    warn "${dir}/.terraform is missing; skipping validate. Run: terraform -chdir=${dir} init"
  fi
done <<< "${dirs}"

exit "${status}"
