#!/usr/bin/env bash
# PreToolUse/Bash guard: allow only known-safe read-only `danube` subcommands.
# Logic lives in danube_guard.py: bash exits 2 on a parse error, which is also the "block" code.
set -uo pipefail

payload=$(cat)
guard="$(dirname "${BASH_SOURCE[0]}")/danube_guard.py"

if [[ ! -f $guard ]] || ! command -v python3 >/dev/null 2>&1; then
  # Fail closed only when the payload mentions danube, so a missing python3
  # cannot brick every Bash call.
  if printf '%s' "$payload" | grep -q 'danube'; then
    printf 'BLOCKED: the danube credential guard cannot run (missing python3 or danube_guard.py) and this command mentions `danube`.\n' >&2
    exit 2
  fi
  exit 0
fi

printf '%s' "$payload" | python3 "$guard"
