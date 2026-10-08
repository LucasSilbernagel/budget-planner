#!/usr/bin/env bash
# Proves a built image both serves (health, SSR, br compression, non-root) and migrates
# (idle without credentials; a real run against a throwaway postgres) before any push.
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

# Positive control: a precompressed sibling must exist, or the on-the-fly path
# could be covering for missing .br files.
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
