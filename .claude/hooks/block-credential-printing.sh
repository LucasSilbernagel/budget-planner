#!/usr/bin/env bash
# PreToolUse/Bash guard: allow only known-safe read-only `danube` subcommands.
#
# Why this exists: on 2026-09-03 and again on 2026-09-05, `danube db get`
# printed the production PostgreSQL admin password into a session transcript.
# DanubeData exposes no credential rotation, so the only remedy is deleting and
# re-provisioning the instance.
#
# WHY DEFAULT-DENY (changed 2026-09-05 by code review): the original denied a
# hand-written list of credential-printing subcommands. That requires predicting
# which subcommands leak - and nobody predicted `db get` until it did. The review
# also found `db connection-info` unblocked while `cache` and `queue` blocked
# their equivalent. An allow-list of read-only verbs removes the need to predict
# and covers subcommands DanubeData adds later.
#
# This file is a thin wrapper; the decision lives in danube_guard.py. That split
# is deliberate: the first rewrite embedded the logic in a $(...) block and a
# backtick inside a regex character class made the script a bash syntax error.
# Bash exits 2 on a parse error, which is ALSO the hook's "block" code, so the
# crashed guard looked exactly like a working one and scored 18 passing denials
# without ever running. Keeping the logic in a .py file removes that whole class
# of quoting hazard, and the wrapper below is small enough to eyeball.
#
# ⚠️ WHAT THIS CANNOT DO - read before trusting it.
# This inspects the COMMAND TEXT of a Bash tool call. It therefore cannot see:
#   * indirection - `bash provision.sh`, where the script contains the call
#   * assembly    - `D=danube; $D db get`, or a command built from variables
#   * any session that does not load this project's .claude/settings.json
#     (another checkout, a different cwd, the globally-installed CLI)
# Those bypasses are real and were verified. This guard is defense-in-depth over
# a porous surface, NOT a solution. The actual problem is that the vendor prints
# secrets and offers no rotation. Do not let this file's existence justify
# relaxing the habit of never asking a CLI to print a credential.

set -uo pipefail

payload=$(cat)
guard="$(dirname "${BASH_SOURCE[0]}")/danube_guard.py"

if [[ ! -f $guard ]] || ! command -v python3 >/dev/null 2>&1; then
  # Fail closed on the risky case only: no decider available, but the payload
  # mentions danube. Anything else proceeds, so a missing python3 cannot brick
  # every Bash call in the session.
  if printf '%s' "$payload" | grep -q 'danube'; then
    printf 'BLOCKED: the danube credential guard cannot run (missing python3 or danube_guard.py) and this command mentions `danube`.\n' >&2
    exit 2
  fi
  exit 0
fi

printf '%s' "$payload" | python3 "$guard"
