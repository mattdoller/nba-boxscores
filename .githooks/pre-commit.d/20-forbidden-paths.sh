#!/usr/bin/env bash
# Refuse to commit files that hold secrets or local state. .gitignore already
# lists these, but 'git add -f' bypasses .gitignore and this hook does not.
set -uo pipefail
# shellcheck source=../lib.sh
source "$(dirname "$0")/../lib.sh"

forbidden=(
  '*.pem'
  '*.key'
  '*.crt'
  '*.p12'
  '*.tfstate'
  '*.tfstate.backup'
  '*.tfvars'
  '.envrc'
  '.env'
  '.env.*'
  'application_default_credentials.json'
  'credentials.json'
  'client_secret*.json'
  'service-account*.json'
  '*-service-account.json'
  '*-sa-key.json'
  'gha-creds-*.json'
  '.runtimeconfig.json'
  '.boto'
  'wifi.conf'
  '*.img'
  '.pi-provision.yml'
  'id_rsa*'
  'id_ed25519*'
  '*.vault_pass'
  'vault_pass'
)

status=0
while IFS= read -r file; do
  [[ -n "${file}" ]] || continue
  base="$(basename "${file}")"

  for pattern in "${forbidden[@]}"; do
    # shellcheck disable=SC2254
    case "${base}" in
      ${pattern})
        fail "refusing to commit '${file}' (matches forbidden pattern '${pattern}')"
        status=1
        break
        ;;
    esac
  done
done < <(staged_files)

exit "${status}"
