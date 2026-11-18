#!/usr/bin/env bash
# Shared helpers for the hooks in this directory. Sourced, never executed.

hook_name="${HOOK_NAME:-hook}"

fail() {
  printf '%s: FAIL  %s\n' "${hook_name}" "$*" >&2
}

warn() {
  printf '%s: warn  %s\n' "${hook_name}" "$*" >&2
}

note() {
  printf '%s: ok    %s\n' "${hook_name}" "$*" >&2
}

# Print 0 or 1 and run every check script in a directory, passing the hook's
# arguments through. All checks run even after a failure so the user sees
# every problem at once. HOOK_STDIN holds anything git piped to the hook.
run_checks() {
  local dir="$1"
  shift
  local status=0
  local check

  for check in "${dir}"/*.sh; do
    [[ -e "${check}" ]] || continue

    if ! HOOK_NAME="$(basename "${check}" .sh)" bash "${check}" "$@"; then
      status=1
    fi
  done

  return "${status}"
}

# Staged files that will exist after the commit (added, copied, modified, renamed).
staged_files() {
  git diff --cached --name-only --diff-filter=ACMR -z | tr '\0' '\n'
}

# Staged files whose path matches an extended regex.
staged_matching() {
  staged_files | grep -E -- "$1" || true
}

# Staged files whose staged content starts with a shebang naming the interpreter.
staged_with_shebang() {
  local interpreter="$1"
  local file

  while IFS= read -r file; do
    [[ -n "${file}" ]] || continue

    if git show ":${file}" 2>/dev/null | head -n 1 | grep -qE "^#!.*\b(${interpreter})\b"; then
      printf '%s\n' "${file}"
    fi
  done < <(staged_files)
}

# True when a tool exists; otherwise prints a warning so skipped checks are visible.
have_tool() {
  if command -v "$1" >/dev/null 2>&1; then
    return 0
  fi

  warn "$1 is not installed; skipping. Install it to enable this check."
  return 1
}

# Require an environment variable that .envrc provides.
require_env() {
  local name="$1"

  if [[ -z "${!name:-}" ]]; then
    fail "${name} is not set; refusing to continue without this check."
    fail "run 'direnv allow' (or export ${name}) and try again."
    return 1
  fi
}
