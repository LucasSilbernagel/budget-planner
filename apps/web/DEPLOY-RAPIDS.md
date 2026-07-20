# Deploying budget-planner to DanubeData Rapids

**Story 5-2 — Configure DanubeData Rapids for backend logic.**

This runbook configures the **Rapids runtime/platform** so the TanStack Start
SSR app (`apps/web`) runs correctly: a self-listening container, the Knative
service definition, runtime secret injection, and internal-DNS connectivity to
PostgreSQL. EU-only, zero US residency (NFR1/NFR2), full CLOUD Act immunity.

> **Scope boundaries (do not duplicate):**
> - **5-2 (here):** Rapids runtime — entrypoint, service def, secrets, DB connectivity.
> - **4-16:** the deploy/release workflow (`.github/workflows/deploy.yml`).
> - **4-17:** provision the managed PostgreSQL tier (owns the DB-host allowlist decision).
> - **5-3:** Paddle production. **5-4:** production CI/CD. **5-5:** monitoring. **5-6:** the cutover.

Legend: **[CODE]** done in-repo now · **[OPS]** needs the DanubeData account · **[VERIFY]** needs the live service.

---

## 1. Server entrypoint (AC-1) — **[CODE], done**

`vite build` emits `apps/web/dist/server/server.js` as a web-standard
`fetch(Request) => Response` handler **with no socket listener**, and it does
**not** serve `dist/client/` assets. Knative routes traffic to a container that
must listen on `$PORT`. The self-listening process is:

- **`apps/web/server-entry.mjs`** — binds `process.env.PORT` (default `8080`) on
  `0.0.0.0`, serves `dist/client/` static assets, and delegates SSR + `/api/*`
  to the built fetch handler.
- **`apps/web/src/server/node-adapter.mjs`** — zero-dependency `node:http` ⇄
  web-`fetch` adapter (static file serving + Request/Response conversion,
  including correct multi-`Set-Cookie` handling for the signed session cookie).

**Approach chosen: (b)** a thin entry over the exported `server.fetch` default,
served via a hand-rolled `node:http` adapter — **no new runtime dependency** and
no transpile step (`node server-entry.mjs` runs the `.mjs` directly). Approach
(a), configuring a Start/Nitro node-server preset, was avoided because the
plugin offers no documented self-listening preset at the pinned version (ADR-001
flags Rapids/Start server tooling as thinly documented).

### Two build fixes this story had to make for the server to boot at all

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

## 2. Rapids service definition (AC-2) — **[CODE]** manifest + **[OPS]** apply

- **`apps/web/Dockerfile`** — builds the workspace and runs
  `node apps/web/server-entry.mjs`. Build context is the **monorepo root**:
  `docker build -f apps/web/Dockerfile -t budget-planner-web .`
- **`apps/web/rapids-service.yaml`** — Knative `Service`: region intent
  (Falkenstein DE), `min-scale: 0` (scale-to-zero), `max-scale: 5`,
  `containerConcurrency: 100`, CPU/memory requests+limits, `timeoutSeconds: 60`,
  `$PORT` 8080, and `/api/health` readiness + liveness probes.

**Readiness uses `/api/health`** (process-up, no DB) so scale-from-zero is not
gated on the database. `/api/ready` (Story 5-5) does the deeper dependency check
and is for monitoring, not the scale-up gate.

**Auto-TLS** is enabled at the Knative cluster/domain level, not a per-service
field — configure the domain mapping at provisioning.

**[OPS] blocked-on-account:**
1. Create the DanubeData account + project in **Falkenstein, Germany** (shared
   gate with 4-16, 4-17).
2. Push the image to the DanubeData registry; set `spec...image` in
   `rapids-service.yaml` to the real registry path.
3. Apply the service (`kubectl apply -f apps/web/rapids-service.yaml` or the
   Rapids CLI equivalent) and confirm the region annotation key.
   *(The release/deploy automation itself is Story 4-16 — coordinate one workflow.)*

---

## 3. Runtime environment & secrets (AC-3)

Validated by `packages/config/src/schema.ts` (Zod) and read by
`packages/db/src/client.ts`. **Secrets are injected as Rapids platform secrets —
never committed.** Coordinate injection **once** across 5-2 / 4-16 / 4-17 / 5-3
so each value is set a single time.

### Runtime secrets / env (injected into the Rapids service)

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | **yes** | Set explicitly to `production`. **Unset → schema default `development` → session secret fails OPEN.** Only `development`/`production`/`test` are valid; `staging`/`preview` are rejected by the enum. |
| `DATABASE_URL` | yes (paid tier) | DanubeData PostgreSQL host. Must satisfy the allowlist in `client.ts` — see §4. |
| `DATABASE_CA_CERT` | optional | Read directly from `process.env` in `client.ts` (not in the Zod schema — easy to miss). Needed only if the DanubeData CA is not in the system trust store. |
| `SESSION_SECRET` | **yes** | HMAC key for signed sessions. **≥32 chars and ≥8 distinct chars** or auth fails closed (outside dev). Generate: `openssl rand -hex 32`. Rotating it invalidates all sessions. |
| `SITE_URL` | **yes** | Public **https** origin (default is `http://localhost:5173`). Magic-link emails build absolute URLs from it; a non-https/localhost value throws in production. |
| `PADDLE_ENVIRONMENT` | 5-3 | `sandbox` \| `production`. |
| `PADDLE_VENDOR_ID` / `PADDLE_API_KEY` / `PADDLE_PUBLIC_KEY` / `PADDLE_WEBHOOK_SECRET` | 5-3 | Billing. Coordinate with Story 5-3. |
| `EMAIL_API_KEY` | 5-16 | Magic-link email (EU provider). Runtime secret. |
| `EMAIL_FROM` | optional | Defaults to `no-reply@budgetplanner.eu`. |
| `PORT` / `HOST` | platform | `PORT` injected by Knative (entry defaults 8080 / `0.0.0.0`). |

Generate the session secret:

```bash
openssl rand -hex 32   # 64 hex chars → satisfies the ≥32 / ≥8-distinct floor
```

---

## 4. Internal-DNS connectivity to PostgreSQL (AC-4) — owned by **Story 4-17 AC-2**

Rapids reaches PostgreSQL over DanubeData **internal DNS**
(`budget-planner-dev-rw:5432`) — a **bare hostname** that `isEuSovereignDbHost()`
in `packages/db/src/client.ts` currently **rejects** under
`NODE_ENV=production` (only `.danubedata.com` is allowed).

**This is the same decision as Story 4-17 AC-2 — resolve it there, once.** Do
**not** make a second, conflicting allowlist edit here. 4-17 chooses between (a)
the external `*.danubedata.com` endpoint or (b) extending the allowlist to the
verified internal-DNS name **without** weakening the dot-anchored,
anti-substring matching. Whatever 4-17 decides, set `DATABASE_URL`'s host to a
value that check accepts. TLS is enforced (`rejectUnauthorized: true`,
CA-validated via optional `DATABASE_CA_CERT`).

**[VERIFY] blocked-on-service:** from inside the deployed runtime, confirm
`testDbConnection()` returns `true` over internal DNS with CA-validated TLS.

---

## 5. In-runtime verification (AC-5) — **[VERIFY]**, blocked-on-service

Once the service is live, confirm on the **deployed** instance (verify the
**hydrated** response, not just SSR HTML — Story 4-11 lesson):

- [ ] SSR pages render.
- [ ] `/api/calculations/*` (5-12), `/api/auth/paddle/*` (4-1), `/api/sync/*`
      (4-18/5-15) all execute server-side.
- [ ] The global security-headers middleware (`apps/web/src/start.ts`, 5-8
      AC-14) is present on a **live** response (confirms `start.ts` is bundled +
      executed by this runtime). *Verified locally during AC-1 boot;
      re-confirm on Rapids.*
- [ ] The premium gate is server-enforced (forged/tampered session cookies
      rejected before DB access — 5-7/5-8/5-10 regression).
- [ ] All traffic and data stay in the EU (NFR1/NFR2).

---

## Files this story added/changed

- `apps/web/server-entry.mjs` — self-listening entrypoint (AC-1).
- `apps/web/src/server/node-adapter.mjs` — `node:http` ⇄ fetch adapter (AC-1).
- `apps/web/src/server/__tests__/node-adapter.test.ts` — adapter unit/integration tests.
- `apps/web/pg-native-stub.mjs` + `vite.config.ts` alias — fix the `pg-native` boot crash (AC-1).
- `apps/web/package.json` — `start` script; `build` pins `NODE_ENV=production` (AC-1).
- `apps/web/Dockerfile`, `.dockerignore`, `apps/web/rapids-service.yaml` — image + Knative service (AC-2).
- `apps/web/DEPLOY-RAPIDS.md` — this runbook (AC-2/AC-3/AC-4/AC-5).
