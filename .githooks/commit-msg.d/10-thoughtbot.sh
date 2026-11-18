#!/usr/bin/env bash
# Enforce the commit message style: conventional type(scope): prefix, subject
# of 70 characters or less, blank line before the body, body wrapped at 72,
# and no attribution trailers.
set -uo pipefail
# shellcheck source=../lib.sh
source "$(dirname "$0")/../lib.sh"

message_file="$1"
types='feat|fix|refactor|docs|chore|ci|build|test|perf|style'
subject_pattern="^(${types})(\\([^)]+\\))?!?: [^[:space:]]"

# Drop comment lines and anything after the verbose-mode scissors line.
mapfile -t lines < <(sed -n '/^# -\{8,\} >8 -\{8,\}$/q; /^#/!p' "${message_file}")

# Trim trailing empty lines.
while [[ ${#lines[@]} -gt 0 && -z "${lines[-1]}" ]]; do
  unset 'lines[-1]'
done

[[ ${#lines[@]} -gt 0 ]] || exit 0

subject="${lines[0]}"
case "${subject}" in
  Merge\ *|Revert\ *|fixup!\ *|squash!\ *|amend!\ *) exit 0 ;;
esac

status=0

if ! [[ "${subject}" =~ ${subject_pattern} ]]; then
  fail "subject must look like 'type(scope): description' with type in: ${types//|/, }"
  status=1
fi

if [[ ${#subject} -gt 70 ]]; then
  fail "subject is ${#subject} characters; limit is 70"
  status=1
fi

if [[ "${subject}" == *. ]]; then
  fail "subject must not end with a period"
  status=1
fi

if [[ ${#lines[@]} -gt 1 && -n "${lines[1]}" ]]; then
  fail "second line must be blank to separate subject from body"
  status=1
fi

for ((i = 2; i < ${#lines[@]}; i++)); do
  line="${lines[i]}"

  if [[ ${#line} -gt 72 && "${line}" == *" "* ]]; then
    fail "body line $((i + 1)) is ${#line} characters; wrap at 72"
    status=1
  fi

  if [[ "${line}" =~ ^(Co-Authored-By|Co-authored-by|Signed-off-by):|Generated\ with ]]; then
    fail "body line $((i + 1)): attribution trailers are not allowed"
    status=1
  fi
done

exit "${status}"
