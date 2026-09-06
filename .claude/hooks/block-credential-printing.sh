#!/usr/bin/env bash
# PreToolUse/Bash guard: refuse `danube` subcommands that print live secrets.
#
# Why this exists: on 2026-09-03 and again on 2026-09-05, `danube db get`
# printed the production PostgreSQL admin password into a session transcript.
# DanubeData exposes no credential rotation, so the only remedy is deleting and
# re-provisioning the instance. A prose warning in the runbook did not prevent
# the second occurrence; this does.
#
# Safe alternatives that stay allowed: `danube db ls`, `danube <res> ls`,
# `danube db events`, `danube db metrics`, `danube whoami`.

set -uo pipefail

payload=$(cat)
cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)
[[ -z $cmd ]] && exit 0

# Drop global flags so `danube --json db get` normalizes to `danube db get`.
norm=$(printf '%s' "$cmd" \
  | sed -E 's/--json//g; s/--(project|team)[[:space:]]+[^[:space:]]+//g; s/[[:space:]]+/ /g')

# resource -> credential-printing subcommands. `get`/`show` are included because
# `db get` demonstrably emits `connection_info` with the password inline.
patterns=(
  '(db|database) (get|show|credentials)'
  'cache (get|show|connection-info)'
  '(queue|queues) (get|show|connection-info)'
  'vps (get|show|password)'
  '(apps|app) (get|show|credentials)'
  'rapids (get|show)'
)

for p in "${patterns[@]}"; do
  if printf '%s' "$norm" | grep -qE "(^|[^[:alnum:]_-])danube ${p}([[:space:]]|$)"; then
    match=$(printf '%s' "$norm" | grep -oE "danube ${p}" | head -1)
    jq -n --arg m "$match" '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: ("BLOCKED: `" + $m + "` prints live credentials into the transcript. DanubeData offers no credential rotation, so a leak forces deleting and re-provisioning the instance. Use `danube <resource> ls` for instance details without secrets, or ask the user to run the command themselves with `!` if a secret is genuinely required. See docs/production-database-runbook.md.")
      }
    }'
    exit 0
  fi
done

exit 0
