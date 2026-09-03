# Production deploy runbook

**Story 5-4 — Configure CI/CD pipeline for production.**

The pipeline is [`.github/workflows/deploy.yml`](workflows/deploy.yml). This
runbook covers what a human has to do around it: what to configure, how to turn
it on, how to roll back, and what to check afterwards.

> **Scope — do not duplicate.**
> - **`deploy.yml`** — the pipeline itself.
> - **[`apps/web/DEPLOY-RAPIDS.md`](../apps/web/DEPLOY-RAPIDS.md)** (Story 5-2) — the
>   **runtime**: entrypoint, Knative service, and the authoritative table of the
>   env vars the *running container* needs. This file does not restate it.
> - **`.github/BRANCH_PROTECTION.md`** (Story 4-15) — branch protection rules.
> - **Story 4-17** — the managed PostgreSQL instance and the DB-host decision.

---

## Current state: switched off, on purpose

Everything that needs the DanubeData account is gated behind the
`DEPLOY_ENABLED` repository variable, which is **not set**. On every push to
`main` today the pipeline really does run the quality gates, the full
type-check, and a container build that must boot and serve — and then skips
migrate/deploy/smoke and says so in the run summary.

This is deliberate. The Rapids registry path, deploy interface and revision
model are not public (ADR-001 flags Rapids as thinly documented), so they cannot
be written blind. The one thing the pipeline must never do is *claim* to have
deployed. Two properties enforce that:

1. Every run writes a summary that states plainly whether anything was deployed.
2. The deploy step **exits 1** while it is unwired. Turning `DEPLOY_ENABLED` on
   before wiring it fails the run; it does not silently succeed.

---

## 1. Configuration inventory (CI side only)

These live in **GitHub → Settings → Secrets and variables → Actions**, on the
`production` Environment unless noted. This is the CI-side set only — the
secrets the *running app* needs are injected by Rapids and are listed once, in
[`apps/web/DEPLOY-RAPIDS.md` §3](../apps/web/DEPLOY-RAPIDS.md).

### Repository variables (not secret)

| Variable | Purpose |
|---|---|
| `DEPLOY_ENABLED` | Master switch. Set to exactly `true` to enable migrate/deploy/smoke. Anything else = build-and-verify only. |
| `DANUBEDATA_REGISTRY` | Full image **prefix**: host + namespace, e.g. `cr.danubedata.ro/budgetplanner795` (no trailing slash, no repository name). The workflow strips to the host for `docker login` and appends `/budget-planner-web:<sha>` for the tag. |
| `SITE_URL` | Public https origin. Used as the Environment URL and by the smoke check. |
| `VITE_COUNTERDEV_ID` | counter.dev site id — a **public** identifier baked into the client bundle at build time (ADR-005). A variable, not a secret, by design. |

### Environment secrets (`production`)

| Secret | Used by | Purpose |
|---|---|---|
| `DATABASE_URL` | `migrate` job | Applying migrations from CI. **See the note below.** |
| `DATABASE_CA_CERT` | `migrate` job | Optional. Only if the DanubeData CA is not in the runner's trust store. |
| `DANUBEDATA_REGISTRY_USERNAME` / `DANUBEDATA_REGISTRY_PASSWORD` | `build-image` | Registry login for the image push. **`build-image` declares `environment: production` solely to receive these** — GitHub does not expose environment-scoped secrets to a job that does not name the environment, and they would otherwise resolve to empty strings. |
| `RAPIDS_API_TOKEN` | `deploy` | Credential for the Rapids deploy call. Exact form TBD at provisioning. |

> **The one deliberate duplication.** `DATABASE_URL` is configured in *two*
> places: as a Rapids runtime secret (so the app can query) and as a GitHub
> Environment secret (so CI can migrate). That is not a bookkeeping slip — the
> migration runs from a GitHub runner, which is outside the Rapids network, so it
> cannot borrow the runtime injection. Every other secret is defined exactly
> once. If 4-17 chooses an internal-DNS host that is only resolvable from inside
> Rapids, this stops working and the migration has to move into the container or
> a job on the platform — **decide that in 4-17, and update this row.**

Nothing here is ever echoed. Secrets reach steps as `env:` only, GitHub masks
them in logs, and no step prints one. The workflow keeps the repository default
`permissions: contents: read`; no job widens it.

---

## 2. Enablement checklist (blocked on the DanubeData account)

Work top to bottom. Do **not** set `DEPLOY_ENABLED` until every earlier box is
ticked — that is the whole point of the switch.

- [ ] **[4-16/4-17/5-2]** DanubeData account + project created in **Falkenstein, DE**.
- [ ] **[4-17]** Managed PostgreSQL provisioned; the DB-host allowlist decision made
      (external `*.danubedata.com` vs. extending the allowlist to internal DNS).
- [ ] **[4-17]** Confirm the target is a **clean slate**, not a `drizzle-kit push`-built
      database. The preflight enforces this, but knowing the answer first saves a
      failed run — see §4.
- [ ] Image registry created; `DANUBEDATA_REGISTRY` + registry credentials set.
- [ ] **[5-2]** Rapids service applied from `apps/web/rapids-service.yaml`; runtime
      secrets injected per `DEPLOY-RAPIDS.md` §3; domain mapping + auto-TLS configured.
- [ ] **[5-3]** Paddle production configured.
- [ ] GitHub `production` Environment created (§3).
- [ ] Deploy step wired (§5) — with a real command, not the `exit 1` placeholder.
- [ ] `SITE_URL` variable set to the live https origin.
- [ ] **Only now:** set `DEPLOY_ENABLED=true`.
- [ ] **[5-6]** Run the cutover.

---

## 3. GitHub `production` Environment (AC-5) — admin-only ops

Like branch protection (4-15), this cannot be done in code. In
**Settings → Environments → New environment → `production`**:

- **Deployment branches:** *Selected branches* → `main` only. This is the
  environment protection rule the ACs require: it makes a deploy from any other
  branch impossible even by manual dispatch.
- **Required reviewers:** optional but recommended before the first real
  cutover. **Note that approval is requested once per job that names the
  environment, not once per run** — and three jobs do: `build-image`, `migrate`
  and `deploy`. So enabling reviewers means three prompts, not one. The
  load-bearing one is `migrate`: it is the first irreversible action against
  production, and it is gated before a single migration statement runs.
  (`build-image` names the environment because that is the only way GitHub will
  hand it the registry secrets — see §1.)
- **Environment secrets:** add the four from §1.

Equivalent `gh` calls exist but the branch policy is fiddly over the API; the UI
is the documented path here, matching `.github/BRANCH_PROTECTION.md`.

---

## 4. Migrations, and the push-built database hazard

`migrate` runs **before** `deploy`, so the schema is never behind the code
serving it, and a failure aborts the run before any release.

Ahead of `drizzle-kit migrate` the pipeline runs a preflight
(`pnpm --filter @budget-planner/db db:migrate:preflight`) that classifies the
target and **refuses anything it cannot prove safe**:

| Shape | Verdict |
|---|---|
| No `public` tables at all | ✅ clean slate — apply the full chain |
| `drizzle.__drizzle_migrations` with ≥1 row | ✅ drizzle owns the history — apply what is new |
| Schema present, **no journal** | ❌ **push-built** — abort |
| Journal present but empty, over an existing schema | ❌ inconsistent — abort |
| Probe unreadable / DB unreachable | ❌ abort |

A journal that disagrees with the schema in *either* direction aborts: an empty
journal over an existing schema, and equally a journal claiming applied
migrations over a database with no tables (where `migrate` would skip the whole
chain as "already applied" and leave an empty database). Table counting covers
every non-system schema, not just `public`.

The push-built case is the real hazard, recorded in `deferred-work.md:643`: the
existing DanubeData dev databases were built with `drizzle-kit push`, so they
carry the schema with no journal rows. Replaying `0000 → …` there re-mints
`userProfiles` ids and orphans `profileId` / `forecastingProfiles` references, or
fails half-way. The guard has no override flag on purpose — if it fires, the
answer is a baseline/squash strategy decided in **Story 4-17**, not a bypass.

---

## 5. Wiring the deploy step

Replace the `exit 1` block in the **“Deploy revision to Rapids”** step of
`deploy.yml` with the real rollout. It must:

- roll out `${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}` to the Knative service in
  `apps/web/rapids-service.yaml` (`kubectl apply` / `kn service update` / the
  Rapids CLI — confirm at provisioning, per `DEPLOY-RAPIDS.md` §2);
- keep `set -euo pipefail`, and **propagate a non-zero exit** from the deploy
  tool. A tool that logs an error and exits 0 must be checked explicitly;
- wait for the new revision to become Ready before the step finishes, so the
  smoke check does not race the rollout and pass against the *old* revision.

Then record the registry image path back into `rapids-service.yaml` (it still
carries the `REPLACE_WITH_DANUBEDATA_REGISTRY` placeholder).

---

## 6. Rollback

Every deploy is tagged with its commit SHA, so a rollback is a redeploy of an
earlier tag — no special path, the same gated pipeline.

**Actions → Deploy (production) → Run workflow →** set **`image_tag`** to the
previous known-good commit SHA → Run.

That re-runs the gates against `main`, then deploys the older image. Note what
this does **not** do: it does not revert the database. Migrations are
forward-only, so rolling code back across a schema change is only safe when the
migration was additive. For a destructive migration, roll forward with a fixing
migration instead.

Alternative, if the platform's own revision history is faster during an
incident: roll back to the previous Knative revision directly in the DanubeData
console. Do that to stop the bleeding, then land the corresponding revert
through this pipeline so the repo and production agree again.

Find the previous good SHA with:

```bash
gh run list --workflow "Deploy (production)" --branch main --limit 10
```

**After any rollback:** re-run the smoke check against the live URL, and confirm
the run summary reports success rather than a skipped deploy.

---

## 7. What the smoke check proves

After a deploy, against `SITE_URL`:

1. `GET /` returns 2xx **and** an HTML document.
2. `GET /api/health` returns a `status` payload — this is the load-bearing one.
   It proves the SSR *server* is executing, not that a CDN handed back a stale
   static shell.

A red smoke check does not auto-roll-back: on an unproven pipeline an automatic
rollback is its own hazard. It fails the run loudly; a human follows §6.

The deeper dependency check is `/api/ready` (Story 5-5, monitoring), and
readiness/liveness probes use `/api/health` so scale-from-zero is not gated on
the database (`DEPLOY-RAPIDS.md` §2).
