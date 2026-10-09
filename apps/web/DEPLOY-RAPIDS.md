# Deploying budget-planner to DanubeData Rapids

This runbook configures the **Rapids runtime/platform** so the TanStack Start
SSR app (`apps/web`) runs correctly: a self-listening container, the Knative
service definition, runtime secret injection, and internal-DNS connectivity to
PostgreSQL. EU-only, zero US residency, full CLOUD Act immunity.

> **Scope boundaries (do not duplicate):**
> - **Here:** Rapids runtime — entrypoint, service def, secrets, DB connectivity.
> - **`.github/DEPLOY_RUNBOOK.md`:** the deploy/release workflow (`.github/workflows/deploy.yml`).
> - **`docs/production-database-runbook.md`:** the managed PostgreSQL tier and the DB-host allowlist decision.
> - **`docs/paddle-production-verification-runbook.md`:** Paddle production. **`docs/go-live-checklist.md`:** the launch gate.

---

## 1. Server entrypoint

`vite build` emits `apps/web/dist/server/server.js` as a web-standard
`fetch(Request) => Response` handler **with no socket listener**, and it does
**not** serve `dist/client/` assets. Knative routes traffic to a container that
must listen on `$PORT`. The self-listening process is:

- **`apps/web/server-entry.mjs`** — the entrypoint the container always starts. A
  dispatcher: it reads `APP_ENTRYPOINT` once at boot and
  dynamically imports one of the two branches below. Nothing else lives here.
- **`apps/web/serve-entry.mjs`** — the normal path (`APP_ENTRYPOINT` unset or
  anything but `migrate`). Binds `process.env.PORT` (default `8080`) on
  `0.0.0.0`, serves `dist/client/` static assets, and delegates SSR + `/api/*`
  to the built fetch handler.
- **`apps/web/migrate-entry.mjs`** — selected by **`APP_ENTRYPOINT=migrate`** only.
  Applies database migrations from inside the cluster and reports a terminal
  verdict on a token-gated `/migrate-status`; it never loads the application
  server, so that process has no routes at all. Used exclusively by the deploy
  pipeline's `migrate` job, which updates the container, reads the verdict, then
  empties it and scales it to zero. See `.github/DEPLOY_RUNBOOK.md` §4. **Never set `APP_ENTRYPOINT` on
  the serving container.**
- **`apps/web/src/server/node-adapter.mjs`** — zero-dependency `node:http` ⇄
  web-`fetch` adapter (static file serving + Request/Response conversion,
  including correct multi-`Set-Cookie` handling for the signed session cookie).

**Approach chosen: (b)** a thin entry over the exported `server.fetch` default,
served via a hand-rolled `node:http` adapter — **no new runtime dependency** and
no transpile step (`node server-entry.mjs` runs the `.mjs` directly). Approach
(a), configuring a Start/Nitro node-server preset, was avoided because the
plugin offers no documented self-listening preset at the pinned version (ADR-001
flags Rapids/Start server tooling as thinly documented).

### Two build fixes the server needs to boot at all

Booting the production build for the first time surfaced two defects that made
**every** request 500 (not just DB routes):

1. **`pg-native` optional peer dep** — Vite resolved the un-installed optional
   peer to a module whose body is a top-level `throw`. Because the Start server
   eagerly loads its whole route graph (`loadEntries`), that throw crashed SSR,
   `/api/*`, and health alike. Fix: `vite.config.ts` aliases `pg-native` to
   `apps/web/pg-native-stub.mjs` (the pure-JS `Pool` never touches the native
   path). `pg` stays bundled; no libpq needed.
2. **Dev JSX runtime in the production bundle** — `@vitejs/plugin-react` picks
   `jsxDEV` vs `jsx` from `NODE_ENV`, not Vite's build mode, so an ambient-unset
   build shipped `jsxDEV`, and SSR threw `jsxDEV is not a function`. Fix: the
   `build` script pins `NODE_ENV=production vite build`, so any build (local,
   CI, Docker) is deterministically a production bundle.

### Local boot verification (reproducible)

```bash
# From the monorepo root:
pnpm --filter web build
PORT=8080 \
  NODE_ENV=production \
  SESSION_SECRET="$(openssl rand -hex 32)" \
  SITE_URL="http://localhost:8080" \
  pnpm --filter web start

# In another shell — all three asset classes must succeed:
curl -i http://127.0.0.1:8080/                       # SSR → 200 text/html
curl -i http://127.0.0.1:8080/api/health             # server route → 200 {"status":"ok"}
curl -i http://127.0.0.1:8080/assets/<hashed-file>.js # static → 200, immutable cache
```

Expected (verified at this baseline): SSR `200 text/html`; `/api/health`
`200 {"status":"ok"}`; hashed asset `200` with
`cache-control: public, max-age=31536000, immutable`; the `start.ts` security
headers (`x-content-type-options`, `x-frame-options`, …) present on responses.

---

## 2. Rapids service definition

- **`apps/web/Dockerfile`** — builds the workspace and runs
  `node apps/web/server-entry.mjs`. Build context is the **monorepo root**:
  `docker build -f apps/web/Dockerfile -t budget-planner-web .`
  The runtime stage is **slim**: `node:24-slim` + a
  `pnpm install --prod` of `@budget-planner/web` and `@budget-planner/db` + the
  built `dist/` (with its precompressed `.br`/`.gz` siblings) + the entry files
  + `packages/db`'s migrate payload (`drizzle.config.ts`, `migrations/`, the
  lock/preflight sources, and `node_modules/.bin/{tsx,drizzle-kit}`). Layout is
  still `/app/apps/web` + `/app/packages/db`, so every relative path in the
  entry files holds. The registry bills each tag at its full compressed size,
  so one tag must stay **≤ 112 MB** (`DEPLOY_RUNBOOK.md` §8); `build-image` and
  `container-image.yml` measure it and fail above that, and prove both modes
  (serve with brotli, and a real migrate run against a throwaway postgres)
  from the built image (`.github/scripts/verify-image.sh`). ⚠️ A new bare
  import in the server bundle must be in `@budget-planner/web`'s
  `dependencies`: the prod install ships nothing else. The image check catches
  it only on the boot path and `/`; a lazily loaded route chunk would fail in
  production instead.
- **`apps/web/rapids-service.yaml`** — Knative `Service`: region intent
  (Falkenstein DE), `min-scale: 0` (scale-to-zero), `max-scale: 5`,
  `containerConcurrency: 100`, CPU/memory requests+limits, `timeoutSeconds: 60`,
  `$PORT` 8080, and `/api/health` readiness + liveness probes.

**Readiness uses `/api/health`** (process-up, no DB) so scale-from-zero is not
gated on the database. `/api/ready` does the deeper dependency check
and is for monitoring, not the scale-up gate.

**Auto-TLS** is enabled at the Knative cluster/domain level, not a per-service
field — configure the domain mapping at provisioning.

> ⚠️⚠️ **This manifest is never applied.** The
> DanubeData CLI drives Rapids through a REST API with flag-based commands
> (`rapids apply --name/--image/--tag/--port/--health-check-path/--profile/
> --min-scale/--max-scale`) and has **no manifest (`-f`) option**. There is no
> `kubectl` path. The file remains the reviewable statement of intended runtime
> shape, and several of its fields have no CLI equivalent at all — see its header
> and `DEPLOY_RUNBOOK.md` §5.

**Ops setup (done; kept for a rebuild):**
1. Create the DanubeData account + project in **Falkenstein, Germany** (`fsn1`).
2. Push the image to the DanubeData registry. The prefix is
   `cr.danubedata.ro/budgetplanner795` — set as the `DANUBEDATA_REGISTRY`
   repository variable; the pipeline appends `/budget-planner-web:<sha>`.
3. Create the container and set the settings the CLI cannot express (env vars /
   secrets per §3, resource profile, request timeout, concurrency target,
   domain mapping + auto-TLS). After that, every code rollout is automatic —
   the `deploy` job in `.github/workflows/deploy.yml` converges the container
   with `rapids apply --wait` on each merge to `main`.

---

## 3. Runtime environment & secrets

Validated by `packages/config/src/schema.ts` (Zod) and read by
`packages/db/src/client.ts`. **Secrets are injected as Rapids platform secrets —
never committed.** Set each value once.

### Runtime secrets / env (injected into the Rapids service)

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | **yes** | Set explicitly to `production`. **Unset → schema default `development` → session secret fails OPEN.** Only `development`/`production`/`test` are valid; `staging`/`preview` are rejected by the enum. |
| `DATABASE_URL` | yes (paid tier) | DanubeData PostgreSQL host. Must satisfy the allowlist in `client.ts` — see §4. |
| `DATABASE_CA_CERT` | **yes (paid tier)** | Read directly from `process.env` in `client.ts` (not in the Zod schema — easy to miss). The DanubeData chain is **self-signed**, so without it `getPool()` fails `SELF_SIGNED_CERT_IN_CHAIN` and no query runs. On Rapids, **base64-encode the PEM** (`base64 -w0 ca.pem`) before pasting — `normalizeCaCert()` decodes it at every read site. |
| `SESSION_SECRET` | **yes** | HMAC key for signed sessions. **≥32 chars and ≥8 distinct chars** or auth fails closed (outside dev). Generate: `openssl rand -hex 32`. Rotating it invalidates all sessions. |
| `SITE_URL` | **yes** | Public **https** origin (default is `http://localhost:5173`). Magic-link emails build absolute URLs from it; a non-https/localhost value throws in production. |
| `PADDLE_ENVIRONMENT` | yes (paid tier) | `sandbox` \| `production`. Selects `api.paddle.com` vs `sandbox-api.paddle.com` and gates `assertPaddleProductionConfig()`. |
| `PADDLE_API_KEY` | yes (paid tier) | Server-side Billing REST API key (`pdl_live_…`). Runtime secret. |
| `PADDLE_CLIENT_TOKEN` | yes (paid tier) | Browser token for Paddle.js checkout (`live_…`). Safe to expose to the client. |
| `PADDLE_WEBHOOK_SECRET` | yes (paid tier) | `pdl_ntfset_…` — HMAC key for the `Paddle-Signature` header. Runtime secret. |
| `PADDLE_MONTHLY_PRICE_ID` / `PADDLE_ANNUAL_PRICE_ID` / `PADDLE_LIFETIME_PRICE_ID` | yes (paid tier) | Live Paddle price IDs for the €5.99/mo, €39/yr and €99 lifetime plans. **All three are required in production**, and all three **must differ** (`assertPaddleProductionConfig` throws otherwise). ⚠️ These are Rapids **runtime** env vars — `deploy.yml` passes no `PADDLE_*` value at all, so adding or changing one is a Rapids env update on the service, **not** a GitHub secret and **not** something a redeploy will pick up. |
| `PADDLE_WEBHOOK_MAX_AGE_SECONDS` | optional | Webhook timestamp-freshness window. Default `300`. |
| ~~`PADDLE_VENDOR_ID` / `PADDLE_PUBLIC_KEY`~~ | — | **Removed** — Paddle Classic vars, unused by Billing. Do not set. |
| `EMAIL_API_KEY` | yes (paid tier) | Magic-link email (EU provider). Runtime secret. |
| `RETENTION_SWEEP_TOKEN` | yes | Bearer token for `POST /api/internal/retention-sweep`. **≥32 chars and ≥8 distinct chars** (the `SESSION_SECRET` floor) or the endpoint refuses every call (503). Must equal the GitHub `production` environment secret of the same name. Generate: `openssl rand -hex 32`. Runtime secret. See `.github/DEPLOY_RUNBOOK.md` §9. |
| `EMAIL_FROM` | optional | Defaults to the verified Longhand sender `hello@longhandbudget.com`; override only if the Brevo-verified address changes. |
| `PORT` / `HOST` | platform | `PORT` injected by Knative (entry defaults 8080 / `0.0.0.0`). |

Generate the session secret:

```bash
openssl rand -hex 32   # 64 hex chars → satisfies the ≥32 / ≥8-distinct floor
```

---

## 4. Internal-DNS connectivity to PostgreSQL

Rapids reaches PostgreSQL over DanubeData **internal DNS** — a **bare hostname**
that `isEuSovereignDbHost()` in `packages/db/src/client.ts` would reject as a
suffix, so it is admitted by **exact match** instead.

**Decision:** there is no external endpoint to
choose — both dashboard endpoints are the CloudNativePG rw/ro split, and ADR-001
forbids external paths — so `EU_DB_INTERNAL_HOSTS` lists the verified internal
writer name (`budget-planner-prod-rw` + its `.svc.cluster.local` FQDN), each by
exact match, alongside the dot-anchored `.danubedata.ro` suffix list. The
anti-substring anchoring and trailing-dot handling are unchanged. Set
`DATABASE_URL`'s host to one of those names. TLS is enforced
(`rejectUnauthorized: true`, CA-validated via `DATABASE_CA_CERT`).

`/api/ready` returning `{"status":"ready"}` confirms the connection over internal DNS
with CA-validated TLS.

---

## 5. Post-deploy verification

On the **deployed** instance (verify the **hydrated** response, not just SSR HTML):

- SSR pages render.
- `/api/webhooks/paddle` and `/api/sync/*` execute server-side.
- The global security-headers middleware (`apps/web/src/start.ts`) is present on
  a **live** response.
- The premium gate is server-enforced (forged/tampered session cookies rejected
  before DB access).
- All traffic and data stay in the EU.

The launch-gate record of these checks is `docs/go-live-checklist.md`.

---

## Key files

- `apps/web/server-entry.mjs`, `serve-entry.mjs`, `migrate-entry.mjs` — entrypoint and its two branches.
- `apps/web/src/server/node-adapter.mjs` — `node:http` ⇄ fetch adapter.
- `apps/web/pg-native-stub.mjs` + `vite.config.ts` alias — fix the `pg-native` boot crash.
- `apps/web/package.json` — `start` script; `build` pins `NODE_ENV=production`.
- `apps/web/Dockerfile`, root `.dockerignore`, `apps/web/rapids-service.yaml` — image + Knative service.
