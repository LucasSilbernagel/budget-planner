# Production database runbook — DanubeData managed PostgreSQL

Operator guide for provisioning, wiring and verifying the production database
(Story 4.17). Everything here is **manual ops** performed by the operator; the
repo-side work it depends on is already merged.

**Location:** Falkenstein, Germany (EU only). Zero US residency — NFR1, NFR2,
[ADR-001](../_bmad-output/planning-artifacts/adr/ADR-001-danubedata-full-stack-migration.md).

---

## 1. Provision the instance

1. Create / confirm the DanubeData account and project. *(Shared gate with
   stories 4.16 and 5.2 — do this once.)*
2. Create a **managed PostgreSQL** instance in **Falkenstein, DE**. Pick a
   PostgreSQL version supported by `pg@^8.11` and Drizzle ORM 0.32.
3. **Choose the smallest tier** (the live instance is the `micro` class,
   €12.99/mo — 1 GB / 10 GB). Pre-launch there are no users and no load, and this
   is the project's only fixed infrastructure cost. Scale when real traffic
   demands it, not before.
4. Create the application database and its two roles (§1.1 below).
5. From the console, capture:
   - the **internal** connection host (see §2),
   - the port (5432),
   - the CA certificate PEM.

### 1.1 Two database roles, not one

Executed against database `pgdb` on instance `budget-planner-prod` (micro,
1 GB / 10 GB, €12.99/mo, **PostgreSQL 18**, Falkenstein `fsn1`) via **SQL Studio**
in the DanubeData dashboard, connected as the admin role `postgres`. Run **three
times** — 2026-09-03 on the original provision, then 2026-09-04 and 2026-09-05,
each of those after a re-provision. On
the first two runs every statement succeeded as written, including the
`ALTER SCHEMA`; no fallback was needed. *(The third run's result is not yet
recorded here — see the verification query below.)*

> ⚠️ **The engine version was recorded as PostgreSQL 16 and is actually 18**
> (corrected here and in §1 step 2 on 2026-09-05, verified against the live
> instance). Verify with `danube db ls` rather than trusting a recorded number.

> ℹ️ **`danube db ls` reports `database_name: null` on an instance created
> through the interactive prompts** — the field is present in the payload and
> genuinely empty, unlike `monthly_cost` (absent from `ls`; read
> `monthly_cost_cents`). It is unpopulated metadata, **not** a missing database:
> confirmed 2026-09-05 by `SELECT current_database()` returning `pgdb`. Do not
> re-provision over this.

> **Re-provisioning is cheap; keep the instance name.** The endpoints derive from
> it, and both are pinned in `EU_DB_INTERNAL_HOSTS` (`packages/db/src/client.ts`)
> and `DB_INSTANCE` (`.github/workflows/deploy.yml`). Recreating as
> `budget-planner-prod` with `--database-name pgdb` reproduced identical hostnames
> and required **no code change**. A different name costs one constant plus its
> test, and one workflow line.
>
> ⚠️ **`danube db create` has a flag collision: do not pass `--version`.** It is
> shadowed by the CLI's global `-V, --version`, so the command prints the CLI
> version, **exits zero, and creates nothing.** Omit it, or run `danube db create`
> with no flags and use the interactive prompts. ⚠️ **Do not assume the default
> engine version.** The 2026-09-05 provision came back **PostgreSQL 18**, not the
> 16 this runbook previously claimed; the default tracks DanubeData's current
> release and will move again. Read the actual version off `danube db ls` after
> creating, and treat it as an input to migration testing.

The instance accepts connections only from inside the DanubeData network, so
this cannot be run from a laptop; the dashboard's SQL console is the way in.

**Why two roles.** Migrations need DDL (`CREATE TABLE`, `ALTER TABLE`); the
running app needs none. Splitting them means a SQL-injection bug or a leaked
app credential cannot alter or drop the schema. No application code changes for
this — both roles are reached through `DATABASE_URL`, just with different values
in different places: the Rapids **service** gets the `bp_app` string, the
migration **Job** (Story 5.17) gets the `bp_migrator` string.

Generate two passwords with `openssl rand -hex 24` — hex avoids connection-string
escaping problems with `@`, `/`, `#` and `:`.

```sql
CREATE ROLE bp_migrator LOGIN PASSWORD '...';
CREATE ROLE bp_app      LOGIN PASSWORD '...';

REVOKE ALL    ON DATABASE pgdb FROM PUBLIC;
GRANT CONNECT ON DATABASE pgdb TO bp_migrator, bp_app;
-- drizzle-kit creates a `drizzle` schema for its journal, which needs CREATE on
-- the database itself, not just on `public`.
GRANT CREATE  ON DATABASE pgdb TO bp_migrator;

ALTER SCHEMA public OWNER TO bp_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO bp_app;
-- Fallback if ALTER SCHEMA is refused (common on managed providers):
--   GRANT USAGE, CREATE ON SCHEMA public TO bp_migrator;
-- Tables are owned by whoever creates them, so this is equivalent for our purposes.

-- ⚠️ THE ONE TO GET RIGHT. Grants cover tables that exist *now*; every future
-- migration creates new ones the app would have no access to. Run BEFORE the
-- first migration, or the app connects fine and then every query fails with
-- "permission denied for table".
ALTER DEFAULT PRIVILEGES FOR ROLE bp_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bp_app;
ALTER DEFAULT PRIVILEGES FOR ROLE bp_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO bp_app;
```

Verify: `SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname IN ('bp_app','bp_migrator');`
returns two rows, both able to log in.

Connection strings (host per §2, database `pgdb`):

```
app       postgresql://bp_app:PASSWORD@HOST:5432/pgdb
migrator  postgresql://bp_migrator:PASSWORD@HOST:5432/pgdb
```

---

## 2. The host is internal-only — this is the most likely deploy-time failure

Both endpoints in the DanubeData dashboard are **internal DNS**. The
"writer"/"reader" pair is the CloudNativePG **rw/ro split**, *not* a
public-vs-private split.

⚠️ A public-access toggle **does** exist — `danube db dns enable|disable`. What
keeps migrations off the public internet is **ADR-001 policy** ("no external
connections, no SSH tunnels in production"), which is a decision, not a wall.
Treat enabling it as an ADR amendment, not a workaround.

Since Story 5.18 there is also a code-level backstop, so the policy no longer
rests on nobody typing the command: `buildMigrationCredentials` refuses any
migration target that is not an in-cluster writer name (`isInClusterDbHost`), so
even with the toggle on, a migration pointed at the public endpoint fails closed
before it connects. The toggle can still expose the database to anything *else*
that dials it — the backstop covers migrations, not the instance.

`packages/db/src/client.ts` therefore admits the internal **writer** name by
**exact match** (`EU_DB_INTERNAL_HOSTS`), alongside the dot-anchored
`.danubedata.ro` suffix list (`EU_DB_HOST_SUFFIXES` — corrected from
`.danubedata.com`, which no real DanubeData host has ever matched). Currently
listed:

```
budget-planner-prod-rw                                          (short form)
budget-planner-prod-rw.budgetplanner795.svc.cluster.local        (FQDN)
```

Both are the same service. `danube db ls` reports the FQDN, which is what ends up
in `DATABASE_URL`; a pod in the same namespace can also use the short form via its
DNS search domain. Both are allowlisted by **exact match** — deliberately not a
`.svc.cluster.local` suffix rule, which would admit every service in every
namespace of any cluster.

⚠️ **This is Kubernetes in-cluster DNS**, so only something running *inside that
cluster and namespace* can reach the database. A DanubeData **VPS cannot** — it is
a separate VM, the name does not resolve there, and the ClusterIP behind it is not
routable from outside. Verified 2026-09-03; do not plan a migration path around a
VPS.

> ✅ **Confirmed 2026-09-03** against the provisioned instance — the dashboard
> reports exactly this name, so no code change was required. If it is ever
> re-provisioned under a different name, update `EU_DB_INTERNAL_HOSTS` in
> `packages/db/src/client.ts` and its test in `client.test.ts`; those two places
> are the entire change. Do not switch the check to a suffix or substring match:
> a bare name has no dot to anchor on, so `endsWith` would admit
> `budget-planner-prod-rw.attacker.com`.

The read-only endpoint is deliberately **not** allowlisted — the app and the
migration both write, so an accidental `-ro` URL should fail loudly.

Anything else throws at `getPool()` whenever `NODE_ENV` is not
`development`/`test`. An unset or unknown `NODE_ENV` is treated as
production-grade, not as development.

## 3. Secrets and where they are injected

All four are injected as **Rapids secrets** on the service (and, for CI, as
GitHub `production` **Environment** secrets). Nothing is committed; production
reads no `.env` file.

| Variable | Required | How to obtain / generate | Consumed by |
|---|---|---|---|
| `DATABASE_URL` (app) | Yes | `postgresql://bp_app:PASSWORD@budget-planner-prod-rw:5432/pgdb` — in-cluster, port **5432** | `getPool()` (`packages/db/src/client.ts`) on the Rapids service |
| `DATABASE_MIGRATOR_USER` (CI only) | Yes | `bp_migrator` — not sensitive, a repository variable | The `migrate` job: composes `DATABASE_URL` at runtime |
| `DATABASE_MIGRATOR_PASSWORD` (CI only) | Yes | The `bp_migrator` role's password | The `migrate` job: composes `DATABASE_URL` at runtime |
| `DATABASE_NAME` (CI only) | Yes | `pgdb` — not sensitive, a repository variable | The `migrate` job: composes `DATABASE_URL` at runtime |
| `DATABASE_CA_CERT` | **YES — mandatory, not optional** | PEM from the DanubeData console (or extracted from the server, §3.1). **On Rapids, base64-encode it** (`base64 -w0 ca.pem`) — see the callout below | `client.ts` (`getPool`), `migrate-preflight-cli.ts`, `ca-expiry-cli.ts`, `db-smoke-cli.ts`, and `drizzle.config.ts`, each via `normalizeCaCert()` (`packages/db/src/ca-cert.ts`) |
| `NODE_ENV` | Yes — `production` | literal | Arms every fail-closed path: EU host allowlist, TLS verification, `SESSION_SECRET` floor, https `SITE_URL` check |
| `SESSION_SECRET` | Yes | `openssl rand -hex 32` (≥32 chars, ≥8 distinct) | `getSessionSecret()` (`packages/config/src/schema.ts`); rotating it logs everyone out |
| `DANUBE_TOKEN` | Yes (CI only) | DanubeData API token | The `migrate` job's `danube rapids apply` / `update` / `ls` / `rm` calls, which run the in-cluster migrate container (§4) |

> ⚠️ **The migration's `DATABASE_URL` and `DATABASE_PUBLIC_HOST` are not secrets,
> and the public endpoint is no longer part of a release at all.** The host/port
> once had to be read by hand and pasted into a secret, on the theory DanubeData
> only reassigns the public port on re-provisioning. Run 34801804663 disproved
> that — the port moved again with **no re-provision in between** (last one
> 2026-09-05; the port still changed on 2026-09-14) — so nothing pinned ahead of
> time could stay correct, and 2026-09-14 replaced the pin with a live read.
> **Story 5.18 then removed the public path entirely (2026-09-15):** the `migrate`
> job composes `DATABASE_URL` from the fixed in-cluster writer
> (`budget-planner-prod-rw.budgetplanner795.svc.cluster.local:5432`) plus
> `DATABASE_MIGRATOR_USER` / `DATABASE_MIGRATOR_PASSWORD` / `DATABASE_NAME`.
> There is nothing to discover, and a future public-port change is irrelevant.

> ✅ **The migration runs at `verify-full`, with nothing waived (Story 5.18,
> 2026-09-15).** DanubeData issues the database certificate for **in-cluster SANs
> only** (`budget-planner-prod-rw[.budgetplanner795[.svc[.cluster.local]]]`, plus
> `-r`/`-ro`). Migrations now run inside the cluster, so the name dialled is a name
> on the certificate and full verification succeeds.
>
> Until 2026-09-15 the migration ran over the public endpoint — a TCP passthrough
> with no certificate of its own, where `verify-full` **cannot** succeed
> (`ERR_TLS_CERT_ALTNAME_INVALID`) — and the job set
> `DATABASE_TLS_ALLOW_HOSTNAME_MISMATCH=true` to waive the hostname check while
> keeping chain validation. That variable and `packages/db/src/migrate-tls.ts`
> were **deleted**, not switched off: a downgrade that outlives the path it was
> granted for is how a time-boxed exception becomes permanent. Migration and
> application now share one TLS posture.

> ⚠️ **Rapids env-var inputs are single-line — encode the CA before pasting it.**
> A CA certificate is a multi-line PEM whose `-----BEGIN/END CERTIFICATE-----`
> delimiters must sit on their own lines. Pasting the raw block into the
> one-line Rapids field collapses the newlines and every consumer then fails
> with an opaque `PEM routines` / `SELF_SIGNED_CERT_IN_CHAIN` error while the
> secret *looks* set. Fix: **base64-encode the whole PEM onto one line** —
> `base64 -w0 ca.pem` (macOS: `base64 -i ca.pem | tr -d '\n'`) — and paste that.
> `normalizeCaCert()` (`packages/db/src/ca-cert.ts`) decodes it back to a real
> PEM at every read site; it also accepts a value with literal `\n` escapes, and
> passes a genuine multi-line PEM through untouched (so local
> `DATABASE_CA_CERT="$(cat ca.pem)"` still works). Store the **same** encoded
> value in the GitHub `production` environment secret so the two stay in sync.

> ⚠️ **`DATABASE_CA_CERT` is REQUIRED.** An earlier version of this table called it
> optional, "only if the DanubeData CA is not in the runner's trust store". That is
> wrong: the DanubeData chain is **self-signed**, so without the CA the connection
> fails with `SELF_SIGNED_CERT_IN_CHAIN` and no query runs. Verified 2026-09-03
> against the live endpoint. It is also read straight from `process.env` and is
> *not* in the Zod schema, so nothing warns you when it is absent.

> ⛔ **RE-LEAKED 2026-09-05 — the `pguser` password is exposed again and this
> instance must be re-provisioned.** An AI agent ran `danube db get` (and
> `danube --json db get`) while gathering provisioning facts, before reading this
> runbook, printing the admin connection string a second time. The warning below
> was already present and did not prevent it. **A `PreToolUse` hook now denies `danube`
> subcommands that are not on a read-only allow-list** — see
> `.claude/hooks/block-credential-printing.sh`, `.claude/hooks/danube_guard.py`
> and `.claude/settings.json`.
> ⚠️ **It is not a solution, and the word "outright" used to appear here wrongly.**
> The guard reads the COMMAND TEXT of a Bash tool call, so it cannot see
> indirection (`bash provision.sh`), a command assembled from variables, or any
> session that does not load this project's `.claude/settings.json` — another
> checkout, a different cwd, or the globally-installed CLI. All three bypasses
> are verified. The real defect is that the vendor prints secrets and offers no
> rotation; treat the hook as a backstop for mechanical slips, not as permission
> to relax the habit of never asking a CLI to print a credential. The
> instance still holds no application schema (the `migrate` job has never run:
> `vars.DEPLOY_ENABLED` is unset), so delete-and-re-provision is still free.
>
> ✅ **DONE 2026-09-05.** Instance `01a06f32-eaf3-7210-ae1b-671277cdcf24` was
> deleted and replaced by `01a0739f-dccd-73ca-a10d-a15b68bd8ee5` (created
> 22:10 UTC, `running`, `fsn1`, PostgreSQL 18, public DNS off). Both hostnames
> came back **byte-identical**, so `EU_DB_INTERNAL_HOSTS` and `DB_INSTANCE`
> needed no change — the "keep the instance name" rule above held for a second
> time. The leaked `pguser` credential belongs to a database that no longer
> exists.
>
> ✅ **RESOLVED 2026-09-04 — the exposed `pguser` password is gone.** On 2026-09-03
> `danube db get` printed a full connection string including the instance admin
> password, and DanubeData exposes **no rotation control** (neither
> `danube db update` nor the dashboard). Because the database was still empty, the
> instance was **deleted and re-provisioned** rather than lived with — the only
> clean fix available, and one that stops being cheap the moment real data exists.
> The current instance (`01a06f32-eaf3-7210-ae1b-671277cdcf24`) has never had its
> admin credential printed.
>
> ⚠️ **Do not run `danube db get`** — that is what leaked it. Use `danube db ls`,
> which shows the same instance details without credentials.

> ✅ **`DATABASE_CA_CERT` reaches `drizzle-kit`** (closed 2026-09, was Story 5.17 AC-4).
> `packages/db/drizzle.config.ts` now decomposes `DATABASE_URL` via
> `buildMigrationCredentials(NODE_ENV, url, normalizeCaCert(DATABASE_CA_CERT), …)`,
> so the connection that actually applies the schema carries the same CA
> verification and EU-sovereignty host check as the application pool and the
> preflight. drizzle-kit's postgres config accepts EITHER `{ url }` OR the
> decomposed form with `ssl` — never both — so the bare-url form this file used
> to pass silently gave up CA verification on the one connection that can rewrite
> the schema.

Consumer cross-check (all verified in-repo):

- `packages/config/src/schema.ts` — `DATABASE_URL` and `SESSION_SECRET` are
  `optional()` in the Zod schema but **required at runtime**; `NODE_ENV` is an
  enum defaulting to `development`; `SITE_URL` defaults to `http://localhost:5173`
  and must be a public https origin in production.
- `packages/db/src/client.ts` — `getPool`, `isEuSovereignDbHost`, `buildDbSsl`.
- `packages/db/drizzle.config.ts` — `DATABASE_URL` only, loaded from the root
  `.env` via dotenv for **local** migration runs.

## 4. Applying the schema

The chain is **`0000_rare_johnny_storm` → `0016_neat_metal_master` (17
migrations)**. `migration-chain.test.ts` proves the journal and the `.sql` files
agree; the live replay still has to happen against the instance.

**Who runs it:** the `migrate` job in `.github/workflows/deploy.yml`, **inside
the cluster** — per **Story 5.18**, 2026-09-15. Never from a laptop.

**Where it runs, and why there.** DanubeData Rapids has **no run-to-completion
primitive and no way to override a container's command** — `rapids create` /
`apply` / `update` expose image, tag, port, scale, profile, health-check path and
(on `update` only) `--env`, but no `--command` (re-verified against
`@danubedata/cli` 1.1.0, 2026-09-15). Rapids is Knative **Serving**: a container
that runs and exits is a failed revision. Since the database resolves only on
in-cluster DNS, the one available execution host is a Rapids container in the
same cluster and namespace — so that is what the pipeline uses.

**How it works.** The `migrate` job starts the **app image** as a short-lived
container named `budget-planner-migrate`, in migrate mode:

1. `danube rapids apply --name budget-planner-migrate --min-scale 0` — the
   container exists, nothing is running. (It must be created scaled to zero:
   `apply` cannot set environment variables, so a container brought up here would
   boot with no `DATABASE_URL`.)
2. `danube rapids update … --env APP_ENTRYPOINT=migrate DATABASE_URL=…
   DATABASE_CA_CERT=… MIGRATE_STATUS_TOKEN=… --min-scale 1` — one pod starts.
   `apps/web/migrate-entry.mjs` binds `$PORT`, answers `/healthz`, then runs the
   preflight and `drizzle-kit migrate`.
3. The pipeline polls `GET /migrate-status` (bearer token, per-run) until the
   state is terminal, bounded at 600s, and **fails on anything that is not
   `succeeded`**.
4. `danube rapids rm budget-planner-migrate --force` in an `if: always()` step.

**Readiness is not the verdict.** `/healthz` goes green as soon as the container
boots. Tying readiness to migration success would make a failed migration, a
broken image and a crash-loop indistinguishable — all three would look like a
timeout. The verdict is reported positively instead. `danube rapids logs
budget-planner-migrate` is for diagnosis only; the CLI can legitimately report
logs as unavailable, so nothing depends on reading them.

**No public endpoint is opened at any point.** Confirm with `danube db ls`: the
instance must show only the `.svc.cluster.local` form, before, during and after a
release.

> ✅ **The ADR-001 time-boxed public-DNS exception is RETIRED (2026-09-15).**
> From 2026-09-03 this section described a `danube db dns enable` → migrate →
> `disable` window run from the GitHub runner. It expired on its own terms once
> the database held real user data, and its ADR section has been deleted. Do not
> reintroduce it: `buildMigrationCredentials` now refuses any migration target
> that is not an in-cluster writer name, so a `*.danubedata.ro` `DATABASE_URL`
> fails closed rather than quietly reopening the window.

**If a migrate container is ever left behind** — a runner dies between steps 2
and 4 — remove it by hand and confirm. A leftover is publicly routable *and*
holds `DATABASE_URL` in its environment:

```
danube rapids rm budget-planner-migrate --force
danube rapids ls     # budget-planner-migrate must not be listed
```

The migration connects as **`bp_migrator`** (§1.1) — the DDL-capable role — over
the CA-validated path added in Story 5.17 AC-4, now at **`verify-full`**: the
in-cluster name it dials is the name on the certificate, so Story 5.17's
`verify-ca` hostname waiver was deleted rather than left switched off.

The preflight runs immediately before the migration, inside the same container.
To run it by hand against a reachable target:

```
pnpm --filter @budget-planner/db db:migrate:preflight
```

It classifies the target as `empty` / `journaled` / `push-built` / `inconsistent`
/ `unreadable` and **exits non-zero for anything but the first two**.

> ⚠️ **Never replay the chain against a `drizzle-kit push`-built database.** The
> existing DanubeData *dev* databases were built with `push` and carry no
> `__drizzle_migrations` journal rows; replaying re-mints `userProfiles` ids and
> orphans `profileId` / `forecastingProfiles` references. A **fresh** managed
> instance sidesteps this entirely, which is why §1 provisions a new one. If a
> push-built database ever must be reused, establish a baseline (`migrate --to`)
> first.

Re-running a migration is safe: `drizzle-kit migrate` is journal-driven and the
preflight re-runs first, so a repeat applies nothing.

Applying the chain also closes Story 5.8 AC-11: `users.sessionsRevokedAt`
exists, so logout revocation stops failing open.

## 5. Verify

```
DATABASE_URL=... NODE_ENV=production DATABASE_CA_CERT=... \
  pnpm --filter @budget-planner/db db:smoke
```

Asserts `SELECT 1` through the application's own pool, so a pass means the app
can reach the database — not merely that a socket opened. It refuses to run
without a `DATABASE_URL` rather than reporting a vacuous success, and it is
deliberately not wired into any CI job.

Then confirm, per Story 4.17 AC-5 and Story 5.17 AC-6:

- the applied schema matches `packages/db/src/schema.ts` (`drizzle-kit generate`
  emits no new migration);
- an authenticated `/api/sync/*` write persists and reads back;
- a non-EU or bare-name host is still rejected;
- logout revocation works.
