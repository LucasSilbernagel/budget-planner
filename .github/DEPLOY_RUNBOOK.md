# Production deploy runbook

The pipeline is [`.github/workflows/deploy.yml`](workflows/deploy.yml). This
runbook covers what a human has to do around it: what to configure, how to turn
it on, how to roll back, and what to check afterwards.

> **Scope — do not duplicate.**
> - **`deploy.yml`** — the pipeline itself.
> - **[`apps/web/DEPLOY-RAPIDS.md`](../apps/web/DEPLOY-RAPIDS.md)** — the
>   **runtime**: entrypoint, Knative service, and the authoritative table of the
>   env vars the *running container* needs. This file does not restate it.
> - **`.github/BRANCH_PROTECTION.md`** — branch protection rules.
> - **[`docs/production-database-runbook.md`](../docs/production-database-runbook.md)** — the managed PostgreSQL instance and the DB-host decision.

---

## Current state: live

`DEPLOY_ENABLED` is `true`, so every push to `main` runs the quality gates, the
full type-check and a container build that must boot and serve, then pushes,
migrates (when `packages/db/migrations/` changed), deploys and smoke-tests.
Unsetting `DEPLOY_ENABLED` turns the pipeline back into build-and-verify only;
every run writes a summary stating plainly whether anything was deployed.

---

## 1. Configuration inventory (CI side only)

These live in **GitHub → Settings → Secrets and variables → Actions**, on the
`production` Environment unless noted. This is the CI-side set only — the
secrets the *running app* needs are injected by Rapids and are listed once, in
[`apps/web/DEPLOY-RAPIDS.md` §3](../apps/web/DEPLOY-RAPIDS.md).

### Repository variables (not secret, repository scope — NOT the environment)

> ⚠️⚠️ **`DEPLOY_ENABLED` and `SITE_URL` must be created at REPOSITORY level, not
> on the `production` environment.** GitHub resolves environment-scoped values
> only for jobs that declare `environment:`, and a job-level `if:` is evaluated
> *before* the environment is attached. An environment-scoped `DEPLOY_ENABLED`
> does not error — it reads as an empty string, every deploy job skips, and the
> run goes **green having deployed nothing**. Observed live on 2026-09-08.
> `SITE_URL` has the same problem via `smoke`, which declares no environment.
> Neither is sensitive. `scripts/validate-deploy-workflow.py` now enforces this.
>
> Everything else below, and **every secret**, stays on the `production`
> environment — those jobs all declare it, and the protection is the point.

| Variable | Purpose |
|---|---|
| `DEPLOY_ENABLED` | Master switch. Set to exactly `true` to enable migrate/deploy/smoke. Anything else = build-and-verify only. |
| `DANUBEDATA_REGISTRY` | Full image **prefix**: host + namespace, e.g. `cr.danubedata.ro/budgetplanner795` (no trailing slash, no repository name). The workflow strips to the host for `docker login` and appends `/budget-planner-web:<sha>` for the tag. |
| `SITE_URL` | Public https origin. Used as the Environment URL and by the smoke check. |
| `RAPIDS_RESOURCE_PROFILE` | Optional override for the container's size: `free`, `small`, `medium` or `large`. Defaults to **`small`** (0.5-1 vCPU, 256-512MB), matching `apps/web/rapids-service.yaml`. ⚠️ Not optional to the API — creating a container without a profile fails `422 resource_profile`. `free` is 64-128MB, marginal for SSR, and caps max-scale at 3 against the rollout's 5. |
| `DANUBE_TEAM_ID` | Optional. The CLI needs an explicit project/team id in non-interactive mode **when the account has more than one team**; unset is correct for a single-team account. Passed to every CLI step so a later second team does not silently break deploys. |
| `REGISTRY_KEEP_TAGS` | Optional. How many newest image tags the `push-image` prune step keeps as rollback targets. Defaults to **`2`** (was `5` until run 34528527480 hit `Storage quota exceeded (638 MB used of 500 MB)` — the runtime image then shipped the whole workspace, so five tags did not fit the 500 MB plan). Must be a non-negative integer — a non-integer fails the step loudly, and a value below `1` is clamped up to `1` (keeping zero would delete every tag you could roll back to). The prune runs **before** the push (§8), so a registry that has hit its storage quota recovers on the next run without hand intervention. ⚠️ The image size budget (`.github/scripts/image_size.py`, 112 MB) is derived from **this value being 2** — raising it breaks `(KEEP + 2) × S ≤ 450 MB` (§8); recompute the budget first. |
| `VITE_COUNTERDEV_ID` | counter.dev site id — a **public** identifier baked into the client bundle at build time (ADR-005). A variable, not a secret, by design. |
| `VITE_FORMSPARK_FORM_ID` | Formspark form id for the in-app contact form — a **public** identifier baked into the client bundle at build time (ADR-004, the scoped CLOUD-Act exception). A variable, not a secret, by design. Unset is safe: the contact form renders "temporarily unavailable" rather than failing. Define it at **one** scope (repository *or* `production`), unlike `VITE_COUNTERDEV_ID`, so there is no question which value ships. |
| `DATABASE_MIGRATOR_USER` | The `bp_migrator` role name used by the `migrate` job. Not sensitive — already plaintext in `docs/production-database-runbook.md` §1.1 — so it is a variable, not a secret. |
| `DATABASE_NAME` | The database name (`pgdb`) used by the `migrate` job. Not sensitive, same reasoning as above. |

### Environment secrets (`production`)

| Secret | Used by | Purpose |
|---|---|---|
| `DATABASE_MIGRATOR_PASSWORD` | `migrate` job | Password for **`bp_migrator`** (the DDL role). The **only** sensitive piece of the migration connection string — host, port, user and database name are no longer secrets (see the note below). |
| `DATABASE_CA_CERT` | `migrate` job | **Mandatory, not optional.** The DanubeData chain is self-signed, so without it every connection fails `SELF_SIGNED_CERT_IN_CHAIN` before a statement runs (verified 2026-09-03). The `migrate` job connects at **`verify-full`**: it runs in-cluster, so the host it dials is the name on the certificate and nothing is waived. (Until 2026-09-15 it ran at `verify-ca` over the public endpoint, which the in-cluster-only certificate does not name; `migrate-tls.ts` and `DATABASE_TLS_ALLOW_HOSTNAME_MISMATCH` were deleted along with that path.) |
| `DANUBEDATA_REGISTRY_USERNAME` / `DANUBEDATA_REGISTRY_PASSWORD` | `push-image` | Registry login for the image push. **`push-image` declares `environment: production` solely to receive these** — GitHub does not expose environment-scoped secrets to a job that does not name the environment, and they would otherwise resolve to empty strings. |
| `RETENTION_SWEEP_TOKEN` | `retention-sweep.yml` | Bearer token the daily retention sweep sends to `POST /api/internal/retention-sweep` **Must equal** the Rapids runtime secret of the same name. See §9. |
| `DANUBE_TOKEN` | `migrate`, `deploy` | The DanubeData API token. In `migrate` it drives the in-cluster migrate container (`danube rapids apply` / `update` / `ls`, §4). **Scopes needed: `serverless:read`, `serverless:write`, and `serverless:diagnostics`** (the last only so the failure path's `rapids logs`/`revisions`/`events` produce output). `serverless:delete` is deliberately **not** required — the container is never deleted, only emptied and scaled to zero. **This exact name is not a preference** — the CLI reads `process.env.DANUBE_TOKEN` and nothing else (`@danubedata/cli` `dist/lib/config.js`, `getToken`). ⚠️ An earlier draft of this table named `RAPIDS_API_TOKEN`, which the CLI never reads: setting that one and flipping `DEPLOY_ENABLED` would have authenticated as nobody. |

> **⚠️ `DATABASE_URL` and `DATABASE_PUBLIC_HOST` are not in this table, and are
> not coming back.** `DATABASE_PUBLIC_HOST` pinned the public endpoint's
> host/port ahead of time, on the theory that DanubeData only reassigns the port
> on re-provisioning. Run 34801804663 disproved that (the port changed again,
> refusing connections, with no re-provision in between), and 2026-09-14 replaced
> it with a live read. **Moving the migration in-cluster then removed the public endpoint from the
> release path entirely**, so there is nothing to pin *or* discover: the `migrate`
> job composes `DATABASE_URL` from the fixed in-cluster writer
> (`budget-planner-prod-rw.budgetplanner795.svc.cluster.local:5432`) plus
> `DATABASE_MIGRATOR_USER` / `DATABASE_MIGRATOR_PASSWORD` / `DATABASE_NAME`, and
> hands it to the migrate container as an environment variable.
>
> **The one deliberate duplication that remains.** The composed migration
> `DATABASE_URL` is a *different value* from the Rapids runtime secret of the
> same name — same in-cluster host, different **role**: `bp_migrator` (DDL) here,
> `bp_app` (DML) there, configured separately in `apps/web/DEPLOY-RAPIDS.md` §3.
> That split is the point, not a bookkeeping slip: the serving app
> holds no rights to rewrite the schema.

Nothing here is ever echoed. Secrets reach steps as `env:` only, GitHub masks
them in logs, and no step prints one. The workflow keeps the repository default
`permissions: contents: read`; no job widens it.

---

## 2. Enablement checklist

Done; kept for a rebuild from scratch. Work top to bottom and do **not** set
`DEPLOY_ENABLED` until every earlier step is done.

- DanubeData account + project in **Falkenstein, DE**.
- Managed PostgreSQL provisioned; internal DNS admitted by exact match
  (`EU_DB_INTERNAL_HOSTS`) alongside the `.danubedata.ro` suffix list. There is no
  external endpoint.
- Target confirmed a **clean slate**, not a `drizzle-kit push`-built database. The
  preflight enforces this, but knowing the answer first saves a failed run — see §4.
- Image registry created; `DANUBEDATA_REGISTRY` + registry credentials set.
- Rapids container created and its **non-deployable** settings configured by hand
  in the console: runtime env/secrets (`DEPLOY-RAPIDS.md` §3), resource profile,
  request timeout, concurrency target, domain mapping + auto-TLS.
  ⚠️ **`apps/web/rapids-service.yaml` is NOT applied** — nothing consumes it. The
  Rapids CLI is flag-driven with no manifest option; see §5.
- Paddle production configured (`docs/paddle-production-verification-runbook.md`).
- GitHub `production` Environment created (§3).
- `SITE_URL` variable set to the live https origin.
- **Only then:** set `DEPLOY_ENABLED=true`.

---

## 3. GitHub `production` Environment — admin-only ops

Like branch protection, this cannot be done in code. In
**Settings → Environments → New environment → `production`**:

- **Deployment branches:** *Selected branches* → `main` only. This is the
  environment protection rule the ACs require: it makes a deploy from any other
  branch impossible even by manual dispatch.
- **Required reviewers:** optional but recommended before the first real
  cutover. **Note that approval is requested once per job that names the
  environment, not once per run** — and four jobs do: `build-image`,
  `push-image`, `migrate` and `deploy`. So enabling reviewers means four prompts,
  not one (three when `migrate` is skipped because no migration changed). The
  load-bearing one is `migrate`: it is the first irreversible action against
  production, and it is gated before a single migration statement runs.
  (`push-image` names the environment because that is the only way GitHub will
  hand it the registry secrets — see §1. `build-image` names it only to read the
  environment-scoped `VITE_COUNTERDEV_ID`, which differs from the repository-scoped
  one, and the build-time `VITE_FORMSPARK_FORM_ID` alongside it; it reads no
  secrets.) The `migrate` prompt is where the
  in-cluster migrate container is created and the schema is actually changed (§4),
  so that approval is the gate on production DDL.
- **Environment secrets:** add every secret from §1 — `DATABASE_MIGRATOR_PASSWORD`,
  `DATABASE_CA_CERT`, the two `DANUBEDATA_REGISTRY_*` values, and `DANUBE_TOKEN`.
  Also add the two repository variables `DATABASE_MIGRATOR_USER` and
  `DATABASE_NAME` (repository scope, like `DANUBEDATA_REGISTRY` — see §1).

Equivalent `gh` calls exist but the branch policy is fiddly over the API; the UI
is the documented path here, matching `.github/BRANCH_PROTECTION.md`.

---

## 4. Migrations, and the push-built database hazard

`migrate` runs **before** `deploy`, so the schema is never behind the code
serving it, and a failure aborts the run before any release.

**`migrate` only runs when there is something to apply.** The
`migration-check` job diffs `packages/db/migrations/` and
`packages/db/drizzle.config.ts` between this commit and the head commit of the
most recent run whose `deploy` job succeeded. No change → `migrate` is skipped
and `deploy` proceeds. Anything it
cannot prove — a manual dispatch, an API error, no earlier successful deploy, a
baseline commit missing after a force-push — runs `migrate` as before. To force
a migration without a migration change, dispatch the workflow manually.

Ahead of `drizzle-kit migrate` a preflight
(`packages/db/src/migrate-preflight-cli.ts`) classifies the target and
**refuses anything it cannot prove safe**. Both steps run
*inside the migrate container* rather than as two workflow steps, in the same
order and with the same meaning:

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

The push-built case is the real hazard: the
existing DanubeData dev databases were built with `drizzle-kit push`, so they
carry the schema with no journal rows. Replaying `0000 → …` there re-mints
`userProfiles` ids and orphans `profileId` / `forecastingProfiles` references, or
fails half-way. The guard has no override flag on purpose — if it fires, the
answer is a deliberate baseline/squash strategy, not a bypass.

### How the migration runs in-cluster

The production database is reachable only over Kubernetes in-cluster DNS, and
DanubeData Rapids has no run-to-completion job primitive and no container-command
override (re-verified against `@danubedata/cli` 1.1.0, 2026-09-15). So the
migration runs from *inside* the cluster, in the only execution host the platform
offers: a Rapids container in the same namespace, running the app image in
migrate mode.

The `migrate` job:

1. **Mints a per-run status token** (`openssl rand -hex 32`, masked) and composes
   `DATABASE_URL` for the **in-cluster writer**
   (`budget-planner-prod-rw.budgetplanner795.svc.cluster.local:5432`) as
   `bp_migrator`. Nothing is discovered at run time — there is no public endpoint
   to look up.
2. **Starts the migration in ONE call**
   (`danube rapids apply --name budget-planner-migrator --env APP_ENTRYPOINT=migrate
   DATABASE_URL=… MIGRATE_STATUS_TOKEN=… MIGRATE_RUN_ID=… --min-scale 1 --wait`).
   `apply` is create-or-update, so the first run creates the container and later
   runs reconfigure it. It is **never deleted**.

   ⚠️ **One call, not two — this matters.** Until CLI 1.3.0, `apply` could not set
   environment variables, so the job did `apply` then `update` a second later.
   DanubeData confirmed (2026-09-16) that an update arriving while the previous
   update to the same container is still rolling out was **accepted, reported
   success, and never applied**. Our two calls were exactly that collision, on
   every run; at 13:32 and 13:53 UTC the second call of each pair — the one
   starting the container — was silently dropped and the migration never ran.
   `apply --env` removes the collision. Do not split this back into two calls.

   `--wait` is generation-aware in 1.3.0: it follows the `spec_generation` that
   this call produced and returns only once `observed_generation` has caught up and
   `status_details.operation.terminal` is true. A green step means the
   configuration is **live**, not merely accepted.

   ⚠️ **Never add `--json`** — the container object it prints carries
   `environment_variables` with values, i.e. `DATABASE_URL` and its password into
   the run log. The same is true of `rapids ls --json`, which is why every step
   reading it pipes into a script that emits only a word or a URL.
3. **Polls the verdict** on two channels — `GET <url>/migrate-status` with the
   bearer token, and the container logs via `.github/scripts/rapids_verdict.py` —
   both matched against this run's id, bounded at 600s, failing on anything that is
   not an explicit `succeeded`. Two channels because Knative routes the container
   URL to whatever revision is currently READY, which need not be the revision that
   migrated; logs aggregate across revisions and can answer when the URL cannot.
4. **Scales it back to zero and strips its credentials**
   (`rapids update --rm-env … --min-scale 0 --wait`) in an `if: always()` step,
   then **verifies the strip took** and fails the job if it cannot prove it did.

**Why it is permanent.** The container is created once and kept, idle at
`min-scale 0` between releases, where it runs nothing and costs ~€0. Deleting and
recreating it each run is not forbidden — DanubeData confirmed on 2026-09-16 that
deleting a container removes its configuration cleanly, correcting an earlier
theory of ours that orphaned config was to blame for failed provisions. Keeping it
is simply less churn for no benefit, and it removes a class of create/update races
entirely.

The property that deletion used to provide — *no credentials sitting around
between releases* — is provided by step 4's `--rm-env`, which is verified rather
than assumed.

⚠️ The name is **`budget-planner-migrator`**; an earlier `budget-planner-migrate`
was retired during that investigation. Nothing is wrong with the old name, it is
simply unused.

**Readiness is not the verdict.** `/healthz` returns 200 as soon as the container
boots, on purpose. If readiness meant "the migration succeeded", a failed
migration, a broken image and a crash-loop would all present as the same
`--wait` timeout. The verdict is reported positively and separately, so those are
distinguishable. Logs (`danube rapids logs budget-planner-migrator`) are
diagnostics only — the CLI can report them `unavailable`, and a verdict that can
silently become unreadable is not a verdict.

**Concurrency is handled in the database, not the pipeline.** Knative can and does
start more than one revision: live run `35042874267-1` ran **two** pods that both
executed `drizzle-kit migrate` against production. `--min-scale 0` does not prevent
it. So the migration runs under a PostgreSQL **advisory lock**
(`packages/db/src/migrate-lock.ts`) covering the preflight and the DDL together; a
second pod waits, then finds the journal current and applies nothing.

**TLS is `verify-full`, with nothing waived.** In-cluster, the host we dial is the
name on the certificate. The earlier `verify-ca` hostname waiver
(`packages/db/src/migrate-tls.ts`, `DATABASE_TLS_ALLOW_HOSTNAME_MISMATCH`) was
**deleted**, not switched off. `buildMigrationCredentials` additionally refuses
any migration target that is not an in-cluster writer name, so pointing
`DATABASE_URL` at a `*.danubedata.ro` endpoint now fails closed rather than
quietly reopening the retired window.

**Failure recovery.** If a run dies between steps 3 and 5, the container is left
scaled up and holding credentials. Put it back by hand — do **not** delete it:

```bash
danube rapids update budget-planner-migrator \
  --rm-env DATABASE_URL DATABASE_CA_CERT MIGRATE_STATUS_TOKEN MIGRATE_RUN_ID \
  --min-scale 0
```

Re-running a migration is safe: `drizzle-kit migrate` is journal-driven, and the
preflight re-runs first, so a repeat applies nothing.

See [`docs/production-database-runbook.md` §4](../docs/production-database-runbook.md)
for the operator-side detail.

> **Historical note.** Between 2026-09-03 and 2026-09-15 this section described a
> **time-boxed ADR-001 exception**: the `migrate` job opened the database's public
> DNS, migrated from the GitHub runner, and closed it again. That exception has
> been retired and its ADR section deleted — it expired on its own terms once the
> database held real user data. Do not reintroduce the pattern.

---

## 5. Wiring the deploy step

This section records how the deploy step works and what it deliberately does
not do.

The deploy job installs the pinned CLI, proves auth with `danube whoami`,
preflights the image, then converges the container:

```bash
danube rapids apply \
  --name budget-planner-web \
  --image cr.danubedata.ro/budgetplanner795/budget-planner-web \
  --tag "<commit-sha>" \
  --port 8080 --health-check-path /api/health \
  --min-scale 0 --max-scale 5 \
  --wait --wait-timeout 10m
```

**`--wait` is load-bearing.** `apply` returns as soon as the API accepts the
desired state. Without it the step exits 0 while the revision is still rolling
out, and the smoke job then measures the **old** revision — a green deploy of
nothing.

**Note the two calling conventions.** `rapids preflight --image` takes ONE full
reference *including* the tag; `rapids apply` splits them across `--image` and
`--tag`. Verified against `@danubedata/cli` 1.1.0.

**`apply` is create-or-update**, so the first deploy and every later one take the
same path, and re-running an unchanged SHA is a reported no-op rather than a
spurious revision.

### ⚠️ What the pipeline does NOT configure

The Rapids CLI is **flag-driven and has no manifest (`-f`) option**, so
`apps/web/rapids-service.yaml` is documentation — nothing applies it. These have
no `apply` flag and are set **once, by hand, in the console**, then drift
silently if anyone changes them:

| Setting | Why not in the pipeline |
|---|---|
| Runtime env vars / secrets | Only `rapids update --env` sets them, and that would put every secret into a CI process argument list. Inject in the console — `DEPLOY-RAPIDS.md` §3. |
| CPU / memory | The CLI exposes only `--profile <name>`; valid names are undocumented, and a wrong guess fails the whole rollout. |
| Request timeout, concurrency target | `rapids update` flags only; absent from `apply`. |
| Liveness probe | The CLI sets the **readiness** path only. |
| Region | Not a flag anywhere. It follows from where the project lives: `fsn1` (Falkenstein, DE). |

**This step rolls out CODE, not full service configuration.** Treat a config
change as a manual console action plus a matching edit to `rapids-service.yaml`,
which stays the reviewable record of intent.

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

## 6b. Data residency of the deploy path

Audited 2026-09-05 across the wired pipeline. The distinction that matters here
is **user data** versus **credentials**, and they do not have the same answer.

**User data: EU-only, unchanged.** Nothing in this pipeline moves user data. The
only external hosts the deploy path contacts are DanubeData's own
(`cr.danubedata.ro` for the image push, the Rapids API for the rollout). The
runtime — SSR server on Rapids, PostgreSQL — is Falkenstein, DE (`fsn1`). Third-party actions are limited to `actions/checkout`,
`actions/setup-node`, `actions/upload-artifact` and `pnpm/action-setup`; no
analytics, no external data processor, no US-hosted service handles a row of user
data. **Zero US data residency holds.**

**Credentials: NOT EU-only, and this is a real exposure to state plainly.** Every
job runs on `ubuntu-latest` — a GitHub-hosted runner, US-controlled
infrastructure and therefore in CLOUD Act scope. What passes through it today:

| Job | Reaches a US-controlled runner | Weight |
|---|---|---|
| `push-image` | registry username + password | Push-only credentials to an EU registry. |
| `migrate` | **production `DATABASE_MIGRATOR_PASSWORD`, `DATABASE_CA_CERT`, `DANUBE_TOKEN`**, and a `DATABASE_URL` it composes from those plus the fixed in-cluster writer name. The runner **hands these to an in-cluster container and never connects to the database itself.** | Credentials still transit the runner. |
| `deploy` | `DANUBE_TOKEN` | Platform API token; can redeploy and reconfigure containers. |

**Moving the migration in-cluster (2026-09-15) removed the worst half of this.** The runner no longer
opens a public database endpoint and no longer connects to production at all: it
creates an in-cluster container, hands it the credentials through
`rapids update --env`, polls a status endpoint, then empties it and scales it to zero (§4). There is no
public-DNS window to audit, because there is no window. The EU-only rule holds
unconditionally again.

What remains, honestly stated: the runner still **holds** `DATABASE_MIGRATOR_PASSWORD`
and `DATABASE_CA_CERT` in memory long enough to pass them to the platform API, so
production database credentials still transit US-controlled infrastructure even
though production data never does. Removing that too would require the credentials
to be injected by the platform rather than the pipeline (a Rapids-side secret
reference), which the CLI does not currently expose.

**It does not block launch, and it should not be quietly filed as "compliant".**
No user data is at risk; credentials to EU systems are. Revisit here if the
sovereignty posture is ever asserted publicly in a stronger form than "all user
data is stored and processed in the EU" — because "our CI has no US touchpoints"
is a claim this pipeline cannot currently support.

---

## 7. What the smoke check proves

After a deploy, against `SITE_URL`:

1. `GET /` returns 2xx **and** an HTML document.
2. `GET /api/health` returns a `status` payload — this is the load-bearing one.
   It proves the SSR *server* is executing, not that a CDN handed back a stale
   static shell.

A red smoke check does not auto-roll-back: on an unproven pipeline an automatic
rollback is its own hazard. It fails the run loudly; a human follows §6.

The deeper dependency check is `/api/ready`, and
readiness/liveness probes use `/api/health` so scale-from-zero is not gated on
the database (`DEPLOY-RAPIDS.md` §2).

---

## 8. Registry storage and manual prune

Every deploy pushes one image tagged with its commit SHA. Nothing but the
`push-image` **Prune old image tags** step removes them, and that step keeps the
`REGISTRY_KEEP_TAGS` (default 2) newest tags as rollback targets. It runs
**before** the push, so a registry sitting at quota is pruned first and the push
that follows has room — the pipeline self-heals. A prune failure only warns; if
there was genuinely no room the push then fails loudly with
`denied: Storage quota exceeded`.

> ⚠️ **The prune never deletes a tag a container is deployed from — whatever its
> age.** Added 2026-09-16, after it took the site down.
>
> A deployed Knative revision is pinned to the exact image it was created from. On
> 2026-09-15 a burst of deploy attempts pushed several tags in quick succession,
> pushing the tag `budget-planner-web` was *running* out of the keep-window, and the
> prune deleted it. The container kept serving until it scaled to zero, then could
> not start again (`manifest unknown`). The site was down from ~05:28 CEST until it
> was redeployed by hand onto a surviving tag.
>
> The step now reads the deployed tags first
> (`.github/scripts/rapids_deployed_tags.py`) and excludes them. **If it cannot
> determine them, it prunes nothing** — a registry that grows is a bounded, visible
> problem; deleting the image your site runs is an outage. `REGISTRY_KEEP_TAGS` was
> deliberately *not* raised to fix this: that moves the cliff rather than removing
> it, and a longer burst walks off the new one.
>
> DanubeData are adding a server-side guard too (the registry will refuse to delete
> an in-use tag, `409`, overridable with `--delete-in-use`; CLI 1.2.1+). Ours does
> not depend on it.

### How the quota counts, and why the image has a size budget

On 2026-10-02 a deploy died at the push with
`denied: Storage quota exceeded (510 MB used of 500 MB)`. What the logs showed
(runs 37033544321 … 37063497840):

- **Every tag is billed at its full compressed size.** There is no layer dedup
  across tags: two Node-20 tags built the same day from the same base used
  327.2 MB, i.e. 2 × ~164 MB, and every push uploads all its layers.
- **The push is refused only when usage is already at the limit when it
  starts** — allowed at 499.9 MB, denied at 509.6 MB. (Two data points; the
  push job now prints usage before the prune, after it and after the push, plus
  every tag's `bytes_size`, so each run re-checks this.)
- **The prune cannot free everything it does not keep.** Besides the
  `REGISTRY_KEEP_TAGS` newest tags it never deletes a tag a container is
  deployed from — the live web container, and the `budget-planner-migrator`
  container, which is pinned to whichever SHA last ran a migration and so drifts
  out of the keep window between migrations.

So the steady state is `KEEP + 1 (live) + 1 (migrator pin)` tags. With a
~173 MB image, `2 + 1 + 1 = 4` tags is ~690 MB: the plan could not hold it. The
fix was to slim the image rather than keep fewer rollback targets:

    (KEEP + P + 1) × S ≤ 450 MB      (50 MB margin under the 500 MB plan)
    KEEP = 2, P = 1 (migrator pin)   ⇒   S ≤ 112 MB per tag

`build-image` measures every image the way the registry counts it (gzip of each
layer, `.github/scripts/image_size.py`) **before** anything is pushed, warns at
90 % and fails above 112 MB. The same check runs on every pull request
(`container-image.yml`), which pushes nothing. A rollback (§6) adds a second pin
(the web container on an older tag) until the next normal deploy; at
`S ≈ 104 MB` (PR #28's `Container image` check, run 37090558542 — a gzip
estimate; the registry's own `bytes_size` in the deploy log is the figure to
use) that is 5 × 104 = 520 MB, so **do not leave a rollback in place
across several deploys** — roll forward, or the next push may be refused.

⚠️ **Never delete the migrator container to free space** — delete tags (below).
The deploy workflow and its validator forbid deleting it (2026-09-16: a deletion
was followed by two failed provisions; DanubeData later attributed the failures
elsewhere, see §4, but the pipeline was built never to delete it). It was
deleted by hand on 2026-10-02 to free space, so the **next migration run
re-creates it** through `rapids apply`'s create path — the first create since
2026-09-16. If that run fails at "Start the migrate container", that is the
first place to look.

### When you still need to prune by hand

- The prune step keeps failing (a CLI shape change, an auth problem) and the
  push is now blocked.
- `REGISTRY_KEEP_TAGS` newest images plus the pinned ones (live, migrator)
  exceed the plan's storage limit, so no automatic prune can make room. That
  should be impossible while the image stays under its 112 MB budget; if it
  happens, the budget or the counting rule above is wrong — find out which
  before lowering `REGISTRY_KEEP_TAGS`.

### Steps

Requires the DanubeData CLI (`pnpm add -g @danubedata/cli@1.1.0`) and
`DANUBE_TOKEN` exported (same token as the `production` environment secret).

```bash
export DANUBE_TOKEN=…                       # from the production environment secret
REPO=budgetplanner795/budget-planner-web    # DANUBEDATA_REGISTRY without the host, + /budget-planner-web

# 1. See what is stored.
danube registry usage
danube --json registry repos tags "$REPO" | python3 -c '
import json,sys
rows = json.load(sys.stdin)["data"]["data"]
rows.sort(key=lambda r: r.get("pushed_at") or "", reverse=True)
for i,r in enumerate(rows):
    print(f"{i:3}  {r.get(\"pushed_at\",\"?\")}  {r.get(\"tag\")}")'

# 2. Delete a specific old tag (repeat as needed). --force skips the prompt.
danube registry repos rm-tag "$REPO" <old-sha> --force

# 3. Confirm space was freed.
danube registry usage
```

**Do not delete** any SHA you might roll back to (§6) — cross-check
`gh run list --workflow "Deploy (production)" --branch main --limit 10` for the
last known-good deploys before pruning. Keep at least the 2–3 most recent.

After a manual prune, re-run the deploy from **Actions → Deploy (production) →
Run workflow** (or push a trivial commit); the automatic prune takes over from
there.

---

## 9. Retention sweep

The privacy policy (`apps/web/src/content/legal/privacy.md`, "How long we keep
your data") commits to deleting a lapsed account's data after a stated period,
with a warning email first. **That page is the one home of both figures**; do
not restate them here. Two triggers enforce it:

- **Primary:** `.github/workflows/retention-sweep.yml`, daily at 06:00 UTC. It
  calls `POST /api/internal/retention-sweep` with a bearer token.
- **Backstop:** the app runs the same sweep itself, from request traffic, when
  the last COMPLETED run is more than 3 days old
  (`apps/web/src/server/retention/backstop.ts`). It is **unarmed until a first
  run completes**, so nothing is sent or deleted before step 6 below. It needs
  traffic, so it is a fallback for a stopped schedule, not a second trigger.

A `jobRuns` lease stops the two from running at once.

### One-time setup

1. Generate a token: `openssl rand -hex 32`.
2. Set it as the Rapids runtime secret `RETENTION_SWEEP_TOKEN`, in the console
   (`apps/web/DEPLOY-RAPIDS.md` §3). Env vars have no CLI path.
3. Set the **same value** as the `production` environment secret
   `RETENTION_SWEEP_TOKEN` (Settings → Environments → production).
4. Deploy, so migration 0024 is applied (it adds the columns and the `jobRuns`
   row).
5. Run the workflow by hand with **dry run** ticked (Actions → Retention sweep →
   Run workflow). Expect HTTP 200 and counts in the run summary. `noticesDue`,
   `purgesDue` and `clocksStarted` are TOTALS (not capped by the batch size);
   read them before the first real run.
6. Run it once more with dry run unticked, or let the daily schedule do it.
   That first completed run arms the backstop.

⚠️ **Do not add required reviewers to the `production` environment** without
moving this job off it: approval is requested for every job that names the
environment, so every scheduled run would wait for a click and the schedule
would never run unattended. §3 suggests reviewers for the deploy jobs. As of
2026-09-28 the environment has no protection rules (measured with
`gh api repos/…/environments/production`).

### Reading a run

- **401**: the two token copies differ. **503**: the Rapids secret is unset or
  shorter than 32 characters.
- **500 with counts**: at least one warning email or deletion failed. The
  failures are in the app log under `[Retention]`. The next run retries them.
  A warning that failed is never counted as sent, so no account is deleted
  without one, **ever**: an address that keeps refusing is retried daily at the
  back of the queue and its account is kept (Lucas, 2026-09-28). A red run
  every day for the same address means one to look at by hand.
- **`truncated: true`**: the run hit its time budget; the rest goes next run.
- **`skipped: "lease-held"`**: another sweep, usually the backstop, was
  already running. This is not an error.

### ⚠️ GitHub switches this schedule off after 60 idle days

In a public repository, GitHub disables scheduled workflows after 60 days with
no repository activity. The backstop keeps deletions running, but re-enable the
workflow when you return: Actions → Retention sweep → **Enable workflow**.
`.github/workflows/ca-expiry.yml` and `.github/workflows/paddle-drift.yml` (the
weekly Paddle.js drift check) are affected the same way: re-enable
each under Actions → the workflow's name → **Enable workflow**.

