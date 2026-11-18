#!/usr/bin/env bash
# Scan staged changes for secrets. Fails closed when gitleaks is missing,
# because this is the main line of defence against committed credentials.
set -uo pipefail
# shellcheck source=../lib.sh
source "$(dirname "$0")/../lib.sh"

if ! command -v gitleaks >/dev/null 2>&1; then
  fail "gitleaks is not installed; refusing to commit without a secret scan."
  fail "install it from https://github.com/gitleaks/gitleaks or 'apt install gitleaks'."
  exit 1
fi

root="$(git rev-parse --show-toplevel)"
gitleaks protect --staged --redact --no-banner --config "${root}/.gitleaks.toml" --source "${root}"
