#!/usr/bin/env bash
# Block commits whose staged lines contain the value of a protected environment
# variable. The variables are named in .githooks/config.sh and their values come
# from the untracked .envrc, so neither this file nor the config ever holds them.
#
# PERSONAL_EMAIL is also compared against git's user.email. AWS_PROFILE is
# matched only in profile-shaped contexts (profile = x, --profile x,
# AWS_PROFILE=x) because a bare profile name such as "terraform" is a common
# word and would otherwise block ordinary commits.
set -uo pipefail
# shellcheck source=../lib.sh
source "$(dirname "$0")/../lib.sh"

config="$(dirname "$0")/../config.sh"
REQUIRED_SECRET_VARS=(PERSONAL_EMAIL)
OPTIONAL_SECRET_VARS=()
if [[ -f "${config}" ]]; then
  # shellcheck source=/dev/null
  source "${config}"
fi

status=0
for name in "${REQUIRED_SECRET_VARS[@]}"; do
  require_env "${name}" || status=1
done
[[ "${status}" -eq 0 ]] || exit 1

if [[ -n "${PERSONAL_EMAIL:-}" && "$(git config --get user.email || true)" == "${PERSONAL_EMAIL}" ]]; then
  fail "git user.email is set to the personal address."
  fail "fix with: git config --global user.email '<github-noreply-address>'"
  status=1
fi

added="$(git diff --cached --diff-filter=ACMR -U0 | grep -E '^\+' || true)"

for name in "${REQUIRED_SECRET_VARS[@]}" "${OPTIONAL_SECRET_VARS[@]}"; do
  value="${!name:-}"
  [[ -n "${value}" ]] || continue

  escaped="$(printf '%s' "${value}" | sed 's/[][\.*^$/]/\\&/g')"
  if [[ "${name}" == "AWS_PROFILE" ]]; then
    pattern="(profile[[:space:]]*=[[:space:]]*[\"']?|--profile[[:space:]=]+[\"']?|AWS_PROFILE=[\"']?)${escaped}([\"'[:space:]]|$)"
  else
    pattern="${escaped}"
  fi

  if printf '%s\n' "${added}" | grep -qE -- "${pattern}"; then
    fail "staged changes contain the value of ${name} in:"
    git diff --cached --diff-filter=ACMR --name-only -G"${pattern}" | sed 's/^/    /' >&2
    status=1
  fi
done

exit "${status}"
