#!/usr/bin/env bash
# Syntax-check staged Ansible playbooks (YAML under a playbooks/ directory or
# named site.yml). Runs from the nearest directory holding an ansible.cfg so
# roles and inventory resolve the same way they do for a real run.
set -uo pipefail
# shellcheck source=../lib.sh
source "$(dirname "$0")/../lib.sh"

files="$(staged_matching '(^|/)(playbooks/[^/]+\.ya?ml|site\.ya?ml)$')"
[[ -n "${files}" ]] || exit 0
have_tool ansible-playbook || exit 0

status=0
while IFS= read -r file; do
  [[ -n "${file}" ]] || continue

  base="$(dirname "${file}")"
  while [[ "${base}" != "." && ! -f "${base}/ansible.cfg" ]]; do
    base="$(dirname "${base}")"
  done

  rel="${file#"${base}"/}"
  if ! (cd "${base}" && ansible-playbook --syntax-check "${rel}" >/dev/null); then
    fail "ansible-playbook --syntax-check failed for ${file}"
    status=1
  fi
done <<< "${files}"

exit "${status}"
