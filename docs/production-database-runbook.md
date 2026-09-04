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
3. **Choose the smallest tier** (≈€9.99/mo class). Pre-launch there are no users
   and no load, and this is the project's only fixed infrastructure cost. Scale
   when real traffic demands it, not before.
4. Create the application database and its two roles (§1.1 below).
5. From the console, capture:
   - the **internal** connection host (see §2),
   - the port (5432),
   - the CA certificate PEM.

### 1.1 Two database roles, not one

Executed 2026-09-03 against database `pgdb` on instance `budget-planner-prod`
(micro, 1 GB / 10 GB, €12.99/mo, Falkenstein) via **SQL Studio** in the DanubeData
dashboard, connected as the admin role `postgres`. Every statement below
succeeded as written, including the `ALTER SCHEMA` — no fallback was needed.

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

`packages/db/src/client.ts` therefore admits the internal **writer** name by
**exact match** (`EU_DB_INTERNAL_HOSTS`), alongside the unchanged dot-anchored
`.danubedata.com` suffix list. Currently listed:

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
| `DATABASE_URL` (migration) | Yes | `postgresql://bp_migrator:PASSWORD@postgresql-budget-planner-prod.budgetplanner795.danubedata.ro:5445/pgdb` — public endpoint, port **5445** | The `migrate` job: preflight + `drizzle.config.ts` |
| `DATABASE_CA_CERT` | **YES — mandatory, not optional** | PEM from the DanubeData console (or extracted from the server, §3.1) | `client.ts:170`, `migrate-preflight-cli.ts:102`, and `migrate-credentials.ts` since Story 5.17 AC-4 |
| `NODE_ENV` | Yes — `production` | literal | Arms every fail-closed path: EU host allowlist, TLS verification, `SESSION_SECRET` floor, https `SITE_URL` check |
| `SESSION_SECRET` | Yes | `openssl rand -hex 32` (≥32 chars, ≥8 distinct) | `getSessionSecret()` (`packages/config/src/schema.ts`); rotating it logs everyone out |
| `DANUBE_TOKEN` | Yes (CI only) | DanubeData API token | The `migrate` job's `danube db dns enable/disable` calls |

> ⚠️ **`DATABASE_CA_CERT` is REQUIRED.** An earlier version of this table called it
> optional, "only if the DanubeData CA is not in the runner's trust store". That is
> wrong: the DanubeData chain is **self-signed**, so without the CA the connection
> fails with `SELF_SIGNED_CERT_IN_CHAIN` and no query runs. Verified 2026-09-03
> against the live endpoint. It is also read straight from `process.env` and is
> *not* in the Zod schema, so nothing warns you when it is absent.

> ⚠️ **Known accepted risk — the `pguser` admin password is exposed.**
> `danube db get` prints a full connection string including the instance admin
> password; it was run on 2026-09-03 and the value landed in a session transcript.
> DanubeData exposes **no rotation control** (neither `danube db update` nor the
> dashboard), so it stands. Accepted because: the database holds no data, `pguser`
> is used by neither the app (`bp_app`) nor migrations (`bp_migrator`), and the
> instance is unreachable from the internet except during a migration window.
> **It becomes briefly exploitable whenever that window is open.** Re-provisioning
> the instance is the clean fix and is cheap only while the database is empty —
> revisit before launch. Avoid `danube db get`; use `danube db ls`, which does not
> print credentials.

> ⚠️ **`DATABASE_CA_CERT` does not reach `drizzle-kit`.** `packages/db/drizzle.config.ts`
> passes `dbCredentials: { url }` and no `ssl` option, so the connection that
> actually applies the schema uses neither the CA nor the sovereignty check —
> only the app and the preflight do. Closing that gap is **Story 5.17 AC-4**.

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

**Who runs it:** the `migrate` job in `.github/workflows/deploy.yml`, inside a
**time-boxed public-DNS window** — decided 2026-09-03, per **Story 5.17** and the
**ADR-001 time-boxed exception**. Never from a laptop.

**Why not from inside the cluster.** DanubeData Rapids has **no run-to-completion
primitive and no way to override a container's command** — `rapids create` /
`apply` / `update` expose image, tag, port, scale, profile, health-check path and
`--env`, but no `--command`. Rapids is Knative **Serving**: a container that runs
and exits is a failed revision. Building an entrypoint-mode migration container to
work around that was judged disproportionate for a one-time apply against an empty
database.

**How the window works.** The pipeline runs `danube db dns enable` immediately
before the preflight and `danube db dns disable` immediately after, with the close
step marked **`if: always()`** so it fires on failure, refusal, timeout and
cancellation alike. The window brackets only preflight + migrate.

> ⚠️ **This is an exception with an expiry, not the design.** It is valid only
> while the database holds no user data. Before the first real user, it is replaced
> by an in-cluster migration container and the ADR-001 section is deleted. Do not
> reuse this pattern for routine migrations after launch.

**If a window is ever left open** — a runner dies mid-job, or the close step is
skipped — close it by hand and confirm:

```
danube db dns disable budget-planner-prod
danube db ls        # endpoint should show the .svc.cluster.local form only
```

Whichever is chosen, the migration connects as **`bp_migrator`** (§1.1) — the
DDL-capable role — over the CA-validated, host-checked path added in Story 5.17
AC-4.

Immediately before migrating, the preflight must pass:

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
