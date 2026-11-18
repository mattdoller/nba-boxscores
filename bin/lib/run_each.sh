# shellcheck shell=bash
# Shared by bin/lint and bin/test. Sourced, never executed.
#
# run_each NAME ARGS... runs every executable in bin/NAME.d/ in name order,
# passing ARGS through, and returns non-zero if any of them fail. All of
# them run even after a failure, so every problem shows at once. Each one
# is written in whatever language suits it.

run_each() {
  local name="$1"
  shift
  local status=0
  local ran=0
  local runner
  local runner_name

  for runner in "bin/${name}.d"/*; do
    [[ -f "${runner}" ]] || continue
    runner_name="$(basename "${runner}")"

    # A missing chmod +x would otherwise skip the runner without a word.
    if [[ ! -x "${runner}" ]]; then
      printf '%s: FAIL  %s is not executable; run: chmod +x %s\n' "${name}" "${runner_name}" "${runner}" >&2
      status=1
      continue
    fi

    printf '\n── %s\n' "${runner_name}"
    ran=$((ran + 1))

    if "${runner}" "$@"; then
      printf '%s: ok    %s\n' "${name}" "${runner_name}"
    else
      printf '%s: FAIL  %s\n' "${name}" "${runner_name}" >&2
      status=1
    fi
  done

  if ((ran == 0)); then
    printf '%s: warn  nothing in bin/%s.d/\n' "${name}" "${name}" >&2
  fi

  return "${status}"
}
