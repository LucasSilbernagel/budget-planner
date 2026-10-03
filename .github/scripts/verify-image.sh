#!/usr/bin/env bash
# Prove a built production image works in BOTH of its modes before it can be a
# deploy candidate (story ops-1, AC-4 + AC-5). Used by deploy.yml `build-image`
# and container-image.yml (the PR job), so the two can never check different
# things.
#
#   verify-image.sh <image-ref> <path to packages/db/migrations/meta/_journal.json>
#
# SERVE (AC-4), no database: /api/health 200, SSR / 200, SSR / and a hashed
# /assets/*.js both come back `content-encoding: br` when asked (on-the-fly and
# precompressed paths of apps/web/src/server/node-adapter.mjs — the edge does NOT
# compress, so this is the only place compression is proven before production),
# NODE_ENV=production and the unprivileged `node` user inside the container.
#
# MIGRATE (AC-5): (a) with no credentials the migrate entrypoint idles and
# answers /healthz; (b) against a throwaway postgres on a private docker network
# it runs preflight -> drizzle-kit migrate from the image's own
# packages/db/node_modules/.bin, emits `VERDICT run=<id> state=succeeded`,
# reports `succeeded` on /migrate-status, and leaves exactly as many rows in
# drizzle.__drizzle_migrations as the journal has entries. This is the ONLY
# proof that the migrate payload survived the slim image: production
# migrations are rare, and the serving container is unaffected when it breaks.
#
# No secrets anywhere: NODE_ENV=test is the relaxed DB env
# (packages/db/src/client.ts isRelaxedDbEnv), so the throwaway host needs no TLS
# and no EU-host allow-listing. Every value below is minted here and discarded.
set -euo pipefail

IMAGE="${1:?usage: verify-image.sh <image-ref> <journal.json>}"
JOURNAL="${2:?usage: verify-image.sh <image-ref> <journal.json>}"
PG_IMAGE="${VERIFY_PG_IMAGE:-postgres:18}"
NET="bp-verify-net"
RUN_ID="verify-${GITHUB_RUN_ID:-local}-$$"

cleanup() {
  status=$?
  for c in bp-verify bp-migrate-idle bp-migrate bp-pg; do
    if docker container inspect "$c" >/dev/null 2>&1; then
      echo "::group::logs: $c"
      docker logs "$c" 2>&1 || true
      echo "::endgroup::"
      docker rm -f "$c" >/dev/null 2>&1 || true
    fi
  done
  docker network rm "$NET" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

fail() {
  echo "::error::$*"
  exit 1
}

# wait_http <url> <seconds> — succeeds on the first 2xx.
wait_http() {
  local url="$1" limit="$2" i
  for i in $(seq 1 "$limit"); do
    if curl -fsS -o /dev/null "$url" 2>/dev/null; then
      echo "  ${url} answered after ${i}s"
      return 0
    fi
    sleep 1
  done
  return 1
}

# encoding <url> — the content-encoding the server chose when offered br.
encoding() {
  curl -fsS -D - -o /dev/null -H 'Accept-Encoding: br' "$1" \
    | tr -d '\r' | awk -F': ' 'tolower($1)=="content-encoding"{print $2}'
}

echo "== SERVE (AC-4) =="
docker run -d --name bp-verify -p 8080:8080 \
  -e NODE_ENV=production \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -e SITE_URL="https://example.invalid" \
  "$IMAGE" >/dev/null
wait_http http://127.0.0.1:8080/api/health 30 || fail "the image never became healthy within 30s"

code=$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/api/health)
[ "$code" = 200 ] || fail "/api/health returned ${code}"
echo "  health: ${code}"
code=$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/)
[ "$code" = 200 ] || fail "SSR / returned ${code}"
echo "  SSR /:  ${code}"

enc=$(encoding http://127.0.0.1:8080/)
[ "$enc" = br ] || fail "SSR / with Accept-Encoding: br came back '${enc:-identity}' (on-the-fly compression lost)"
echo "  SSR / content-encoding: ${enc}"

# Positive control first: a precompressed sibling must EXIST in the image, or a
# "served br" result could be the on-the-fly path covering for missing files.
sibling=$(docker exec bp-verify sh -c 'ls apps/web/dist/client/assets/*.js.br 2>/dev/null | head -n 1')
[ -n "$sibling" ] || fail "no precompressed apps/web/dist/client/assets/*.js.br in the image"
asset=$(basename "${sibling%.br}")
enc=$(encoding "http://127.0.0.1:8080/assets/${asset}")
[ "$enc" = br ] || fail "/assets/${asset} with Accept-Encoding: br came back '${enc:-identity}'"
echo "  /assets/${asset} content-encoding: ${enc} (sibling ${sibling} present)"

node_env=$(docker exec bp-verify node -p process.env.NODE_ENV)
[ "$node_env" = production ] || fail "NODE_ENV inside the container is '${node_env}'"
user=$(docker exec bp-verify id -un)
[ "$user" = node ] || fail "the container runs as '${user}', not node"
echo "  NODE_ENV=${node_env}, user=${user}"
docker rm -f bp-verify >/dev/null

echo "== MIGRATE (a): idle without credentials (AC-5a) =="
docker run -d --name bp-migrate-idle -p 8081:8080 -e APP_ENTRYPOINT=migrate "$IMAGE" >/dev/null
wait_http http://127.0.0.1:8081/healthz 30 || fail "the idle migrate container never answered /healthz"
docker logs bp-migrate-idle 2>&1 | grep -F '[migrate-entry] IDLE' \
  || fail "no '[migrate-entry] IDLE' line from the idle migrate container"
docker rm -f bp-migrate-idle >/dev/null

echo "== MIGRATE (b): a real run against a throwaway ${PG_IMAGE} (AC-5b) =="
expected=$(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))["entries"]))' "$JOURNAL")
[ "$expected" -gt 0 ] || fail "the migration journal ${JOURNAL} is empty"
echo "  journal entries: ${expected}"

docker network create "$NET" >/dev/null
pg_password=$(openssl rand -hex 16)
docker run -d --name bp-pg --network "$NET" -e POSTGRES_PASSWORD="$pg_password" "$PG_IMAGE" >/dev/null
ready=""
for i in $(seq 1 60); do
  # -h forces TCP: the image's init phase answers on the unix socket only.
  if docker exec bp-pg pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[ -n "$ready" ] || fail "the throwaway postgres never became ready"

token=$(openssl rand -hex 24)
docker run -d --name bp-migrate --network "$NET" -p 8082:8080 \
  -e APP_ENTRYPOINT=migrate \
  -e NODE_ENV=test \
  -e DATABASE_URL="postgres://postgres:${pg_password}@bp-pg:5432/postgres" \
  -e MIGRATE_STATUS_TOKEN="$token" \
  -e MIGRATE_RUN_ID="$RUN_ID" \
  "$IMAGE" >/dev/null

verdict=""
for i in $(seq 1 180); do
  verdict=$(docker logs bp-migrate 2>&1 | grep -F "[migrate-entry] VERDICT run=${RUN_ID} " || true)
  [ -n "$verdict" ] && break
  sleep 1
done
[ -n "$verdict" ] || fail "no VERDICT line for run ${RUN_ID} within 180s"
echo "  ${verdict}"
case "$verdict" in
  *"state=succeeded"*) ;;
  *) fail "the migrate run did not succeed: ${verdict}" ;;
esac

status_body=$(curl -fsS -H "Authorization: Bearer ${token}" http://127.0.0.1:8082/migrate-status)
echo "  /migrate-status: ${status_body}"
python3 -c 'import json,sys; b=json.loads(sys.argv[1]); sys.exit(0 if b.get("state")=="succeeded" and b.get("runId")==sys.argv[2] else 1)' \
  "$status_body" "$RUN_ID" || fail "/migrate-status did not report succeeded for ${RUN_ID}"

applied=$(docker exec bp-pg psql -U postgres -tAc 'select count(*) from drizzle.__drizzle_migrations')
echo "  applied rows: ${applied}"
[ "$applied" = "$expected" ] || fail "drizzle.__drizzle_migrations has ${applied} rows; the journal has ${expected}"

echo "OK: serve (health, SSR, br on-the-fly + precompressed, production, node) and migrate (idle + ${applied}/${expected} applied) both verified from ${IMAGE}"
