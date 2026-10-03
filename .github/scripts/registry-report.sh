#!/usr/bin/env bash
# Print the registry's quota usage and per-tag sizes (story ops-1, AC-1).
#
#   registry-report.sh <label>      # e.g. "before prune", "after prune", "after push"
#
# Needs DANUBE_TOKEN, DANUBE_TEAM_ID, REGISTRY (host/namespace) and IMAGE_NAME in
# the environment, and the danube CLI on PATH (push-image installs it).
#
# Run at three points of push-image so every deploy log answers, from
# measurements, the two questions the 2026-10-02 quota failure left open:
#   1. what one tag costs: `bytes_size` of the new tag, and
#      `usage after push - usage after prune` (equal => no layer dedup across tags);
#   2. whether the quota check is "already at the limit when the push starts"
#      or "would this push fit" (usage before the push vs the push's outcome).
#
# ⚠️ Only `registry` calls here. Never point this at `rapids` output: rapids
# rows carry container env values (credentials). The tag table prints only
# tag, bytes_size and pushed_at.
#
# A report must never fail a deploy: every failure is a warning, exit 0.
set -uo pipefail

label="${1:-now}"
repo="${REGISTRY#*/}/${IMAGE_NAME}"

echo "== registry usage ${label} =="
danube registry usage || echo "::warning::could not read registry usage (${label})"

listing="$(mktemp)"
if danube --json registry repos tags "${repo}" > "${listing}"; then
  python3 .github/scripts/registry_tags_table.py "${label}" < "${listing}" \
    || echo "::warning::could not print the tag table (${label})"
else
  echo "::warning::could not list tags in ${repo} (${label})"
fi
rm -f "${listing}"
exit 0
