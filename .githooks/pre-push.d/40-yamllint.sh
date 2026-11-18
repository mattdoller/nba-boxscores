#!/usr/bin/env bash
# Lint tracked YAML. Runs on push rather than on every commit. Add a .yamllint
# file at the repo root to tune the rules.
set -uo pipefail
# shellcheck source=../lib.sh
source "$(dirname "$0")/../lib.sh"

files="$(git ls-files -- '*.yml' '*.yaml')"
[[ -n "${files}" ]] || exit 0
have_tool yamllint || exit 0

if ! printf '%s\n' "${files}" | xargs -r yamllint; then
  fail "yamllint failed"
  exit 1
fi
