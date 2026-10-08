#!/usr/bin/env bash
# Usage: registry-report.sh <label>. Report only: every failure warns and exits 0.
# Never point it at `rapids` output: those rows carry container env values.
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
