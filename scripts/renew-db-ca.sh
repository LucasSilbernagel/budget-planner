#!/usr/bin/env bash
# Usage: scripts/renew-db-ca.sh <public-port>   (public DNS must be ON; port from `danube db ls`)
set -euo pipefail

host="postgresql-budget-planner-prod.budgetplanner795.danubedata.ro"
port="${1:?usage: scripts/renew-db-ca.sh <public-port>}"
container="${RAPIDS_CONTAINER:-budget-planner-web}"
min_days="${CA_RENEW_MIN_DAYS:-30}"

for tool in openssl gh danube awk base64; do
	command -v "$tool" >/dev/null || { echo "missing tool: $tool" >&2; exit 1; }
done

cd "$(git rev-parse --show-toplevel)"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

echo "Fetching chain from ${host}:${port} ..."
openssl s_client -4 -starttls postgres -showcerts -connect "${host}:${port}" </dev/null 2>/dev/null \
	| awk -v dir="$work" '/^Server certificate/{exit} /BEGIN CERTIFICATE/{n++} n && !done[n]{print > (dir "/cert" n ".pem")} /END CERTIFICATE/{done[n]=1}' \
	|| true

shopt -s nullglob
certs=("$work"/cert*.pem)
if [ "${#certs[@]}" -eq 0 ]; then
	echo "No certificates received. Is public DNS ON and the port current (danube db ls)?" >&2
	exit 1
fi

ca=""
leaf="$work/cert1.pem"
for cert in "${certs[@]}"; do
	subject=$(openssl x509 -in "$cert" -noout -subject -nameopt RFC2253)
	issuer=$(openssl x509 -in "$cert" -noout -issuer -nameopt RFC2253)
	if [ "${subject#subject=}" = "${issuer#issuer=}" ]; then
		[ -z "$ca" ] || { echo "More than one self-signed certificate in the chain; refusing to guess." >&2; exit 1; }
		ca="$cert"
	fi
done
[ -n "$ca" ] || { echo "No self-signed CA in the chain; refusing to guess." >&2; exit 1; }

# The leaf names in-cluster hosts only, so verify the chain without a hostname check.
untrusted=()
for cert in "${certs[@]}"; do
	[ "$cert" = "$ca" ] || [ "$cert" = "$leaf" ] || untrusted+=(-untrusted "$cert")
done
openssl verify -CAfile "$ca" "${untrusted[@]}" "$leaf" >/dev/null \
	|| { echo "Leaf certificate does not verify against the extracted CA." >&2; exit 1; }

echo
openssl x509 -in "$ca" -noout -subject -enddate -fingerprint -sha256
echo

if ! openssl x509 -in "$ca" -noout -checkend $((min_days * 86400)) >/dev/null; then
	echo "This CA expires within ${min_days} days: DanubeData has not rotated it yet. Nothing pushed." >&2
	exit 1
fi

read -r -p "Push this CA to GitHub (env: production) and Rapids (${container})? [y/N] " answer
[ "$answer" = "y" ] || [ "$answer" = "Y" ] || { echo "Aborted."; exit 1; }

encoded=$(base64 <"$ca" | tr -d '\n')

gh secret set DATABASE_CA_CERT --env production --body "$encoded"
# Plain (non --json) mode prints only the container name, never its env.
danube rapids update "$container" --env "DATABASE_CA_CERT=${encoded}" >/dev/null
echo "Rapids ${container} updated."

gh workflow run ca-expiry.yml
echo
echo "Triggered ca-expiry.yml. Now turn public DNS back OFF in the DanubeData console."
