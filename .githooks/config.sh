# shellcheck shell=bash
# shellcheck disable=SC2034 # read by the hooks that source this file
# Environment variables whose values must never appear in a commit.
# Required ones must be set (normally via the untracked .envrc) or the
# commit is refused. Optional ones are checked only when set.
REQUIRED_SECRET_VARS=(PERSONAL_EMAIL)
OPTIONAL_SECRET_VARS=()
