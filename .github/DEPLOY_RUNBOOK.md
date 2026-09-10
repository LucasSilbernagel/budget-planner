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
| `REGISTRY_KEEP_TAGS` | Optional. How many newest image tags the `build-image` prune step keeps as rollback targets. Defaults to **`5`**. Must be a non-negative integer — a non-integer fails the step loudly, and a value below `1` is clamped up to `1` (keeping zero would delete every tag you could roll back to). The prune runs **before** the push (§8), so a registry that has hit its storage quota recovers on the next run without hand intervention. Lower this if `KEEP_TAGS` images by themselves exceed the registry plan's storage limit. |
| `VITE_COUNTERDEV_ID` | counter.dev site id — a **public** identifier baked into the client bundle at build time (ADR-005). A variable, not a secret, by design. |

### Environment secrets (`production`)

| Secret | Used by | Purpose |
|---|---|---|
| `DATABASE_URL` | `migrate` job | Applying migrations from CI. **See the note below.** |
| `DATABASE_CA_CERT` | `migrate` job | Optional. Only if the DanubeData CA is not in the runner's trust store. |
| `DANUBEDATA_REGISTRY_USERNAME` / `DANUBEDATA_REGISTRY_PASSWORD` | `build-image` | Registry login for the image push. **`build-image` declares `environment: production` solely to receive these** — GitHub does not expose environment-scoped secrets to a job that does not name the environment, and they would otherwise resolve to empty strings. |
| `DANUBE_TOKEN` | `migrate`, `deploy` | The DanubeData API token. **This exact name is not a preference** — the CLI reads `process.env.DANUBE_TOKEN` and nothing else (`@danubedata/cli` `dist/lib/config.js`, `getToken`). ⚠️ An earlier draft of this table named `RAPIDS_API_TOKEN`, which the CLI never reads: setting that one and flipping `DEPLOY_ENABLED` would have authenticated as nobody. Corrected by 4-16. |

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
- [ ] **[5-2/4-16]** Rapids container created and its **non-deployable** settings
      configured by hand in the console: runtime env/secrets (`DEPLOY-RAPIDS.md` §3),
      resource profile, request timeout, concurrency target, domain mapping + auto-TLS.
      ⚠️ **`apps/web/rapids-service.yaml` is NOT applied** — nothing consumes it. The
      Rapids CLI is flag-driven with no manifest option; see §5.
- [ ] **[5-3]** Paddle production configured.
- [ ] GitHub `production` Environment created (§3).
- [x] Deploy step wired (§5) — done by **4-16**; it is a real rollout, not the `exit 1` placeholder.
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

**Done — wired by story 4-16.** This section now records how it works and what
it deliberately does not do.

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
| Region | Not a flag anywhere. It follows from where the project lives — 4-17 confirmed `fsn1` (Falkenstein, DE). |

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

## 6b. Data residency of the deploy path (NFR1/NFR2) — audited by 4-16

Audited 2026-09-05 across the wired pipeline. The distinction that matters here
is **user data** versus **credentials**, and they do not have the same answer.

**User data: EU-only, unchanged.** Nothing in this pipeline moves user data. The
only external hosts the deploy path contacts are DanubeData's own
(`cr.danubedata.ro` for the image push, the Rapids API for the rollout). The
runtime — SSR server on Rapids, PostgreSQL — is Falkenstein, DE, confirmed by
4-17 (`fsn1`). Third-party actions are limited to `actions/checkout`,
`actions/setup-node`, `actions/upload-artifact` and `pnpm/action-setup`; no
analytics, no external data processor, no US-hosted service handles a row of user
data. **NFR1/NFR2 hold.**

**Credentials: NOT EU-only, and this is a real exposure to state plainly.** Every
job runs on `ubuntu-latest` — a GitHub-hosted runner, US-controlled
infrastructure and therefore in CLOUD Act scope. What passes through it today:

| Job | Reaches a US-controlled runner | Weight |
|---|---|---|
| `build-image` | registry username + password | Push-only credentials to an EU registry. |
| `migrate` | **production `DATABASE_URL` and `DATABASE_CA_CERT`**, and it opens a live connection to the production database from that runner | **The serious one.** |
| `deploy` | `DANUBE_TOKEN` | Platform API token; can redeploy and reconfigure containers. |

This is not a new regression — it is the shape `migrate` has had since 5-4 — and
it is precisely what **Story 5.17** removes by moving migrations to an in-network
one-shot Job, at which point `DATABASE_URL` stops crossing the runner at all.

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

The deeper dependency check is `/api/ready` (Story 5-5, monitoring), and
readiness/liveness probes use `/api/health` so scale-from-zero is not gated on
the database (`DEPLOY-RAPIDS.md` §2).

---

## 8. Registry storage and manual prune

Every deploy pushes one image tagged with its commit SHA. Nothing but the
`build-image` **Prune old image tags** step removes them, and that step keeps the
`REGISTRY_KEEP_TAGS` (default 5) newest tags as rollback targets. It runs
**before** the push, so a registry sitting at quota is pruned first and the push
that follows has room — the pipeline self-heals. A prune failure only warns; if
there was genuinely no room the push then fails loudly with
`denied: Storage quota exceeded`.

### When you still need to prune by hand

- The prune step keeps failing (a CLI shape change, an auth problem) and the
  push is now blocked.
- `REGISTRY_KEEP_TAGS` newest images *by themselves* exceed the plan's storage
  limit, so no automatic prune can make room. Lower `REGISTRY_KEEP_TAGS` or
  upgrade the plan.

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
