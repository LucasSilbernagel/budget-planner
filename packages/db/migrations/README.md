# `packages/db/migrations/`

Drizzle-kit migration output for the budget-planner schema.

⚠️ **Most files here are drizzle-kit output, but not all, and you must never
regenerate an existing migration.** `0003_kind_risque.sql`, `0014_stiff_ken_ellis.sql`
and `0020_giant_black_bird.sql` are hand-authored or hand-amended where drizzle-kit
0.23 cannot express the change — each says so in its own header. Regenerating
`0020` silently drops all eight CHECK constraints (drizzle-kit does not model
`check()` at all). Add a new migration instead of re-deriving an old one.

## What is in this directory

- `NNNN_<name>.sql` — one migration per file, applied in journal order.
- `meta/_journal.json` — the source of truth for what this **repository defines**
  and in what order. (What a given *database* has actually applied lives in its own
  `__drizzle_migrations` table — the two are not the same question.) Read the
  journal rather than trusting a list in prose; an out-of-date prose list in this
  file is one of the two things story `cleanup-3` was opened to fix.
- `meta/NNNN_snapshot.json` — the schema snapshot each migration was generated
  against. ⚠️ **Not covered by either test below.** `drizzle-kit generate` diffs
  against the newest snapshot, so a missing or mis-numbered one yields a wrong next
  migration and both suites still pass.

What *is* machine-checked:

| Check | File |
|---|---|
| Every journal migration replays onto an empty database, in one transaction | `packages/db/src/migration-replay.test.ts` |
| Journal ↔ `.sql` file integrity, both directions (no orphans, no missing entries) | `packages/db/src/migration-chain.test.ts` |

Run them with `pnpm --filter @budget-planner/db test`.

## Prerequisites (local)

A repo-root `.env` — `packages/db/drizzle.config.ts` reads `DATABASE_URL` from there
and nowhere else — containing **both**:

```
DATABASE_URL=postgresql://…
NODE_ENV=development
```

`NODE_ENV=development` is **required even for the offline `db:generate`**: the config
feeds `NODE_ENV` into the EU-sovereignty host check, so a `localhost` URL is rejected
with "not a DanubeData host" without it. Copy `.env.example`, which documents this.

## Generating a migration

```bash
# Edit packages/db/src/schema.ts first, then:
pnpm --filter @budget-planner/db db:generate
```

This writes a new `.sql`, a `meta/NNNN_snapshot.json`, and a `meta/_journal.json`
entry. Commit all three together.

⚠️ `migration-replay.test.ts` **pins the journal entry count as a literal**, so a new
migration reddens the db suite until that number is updated in the test. That is
deliberate — it forces a human to look at the new migration — but it means adding a
migration is a two-file change, not one.

## Applying migrations — local and dev targets

```bash
pnpm --filter @budget-planner/db db:migrate:preflight && \
  pnpm --filter @budget-planner/db db:migrate
```

The `&&` is load-bearing: the preflight is only a gate if a non-zero exit actually
stops the migrate step.

`db:migrate:preflight` exits 0 when it classifies the target as `empty` or
`journaled`, and non-zero otherwise — most importantly for a database built with
`drizzle-kit push`, whose chain must never be replayed. The DanubeData **dev**
databases were push-built; if you hit that exit, see the "push-built" guidance in
`docs/production-database-runbook.md` rather than forcing the migration. The
preflight validates `DATABASE_URL` under the same EU-sovereignty and TLS policy the
application uses (NFR1, NFR2). See `packages/db/src/migrate-preflight-cli.ts`.

## Applying migrations — production

**Not with the two commands above, and not from a developer machine.** Production has
no public database endpoint, so no local shell can reach it. Migrations are applied
in-cluster by the migrate container (`apps/web/migrate-entry.mjs` →
`packages/db/src/migrate-lock-cli.ts`), which holds a PostgreSQL **advisory lock**
across the preflight *and* the DDL together:

```
acquire lock -> migrate-preflight-cli -> drizzle-kit migrate -> release
```

The lock exists because of a live incident: Knative started two migrate pods and both
ran `drizzle-kit migrate` against production. The preflight is inside the critical
section because a classification taken while another pod is mid-apply describes a
state that is already gone.

The `migrate` job in `.github/workflows/deploy.yml` runs this automatically when
`packages/db/migrations/` changes — but every deploy job is gated on the
`DEPLOY_ENABLED` repository variable. **While `DEPLOY_ENABLED` is unset, applying
migrations is a manual step**; the automated path is built and switched off, not
absent. Either way, a migration being committed here never means it has been applied.

## Rolling back

There is no down-migration mechanism, and **the deploy pipeline takes no
pre-migration backup**. For the managed instance, recovery depends on the platform's
own backup/restore facility; it is not documented in this repo. Do not assume a dump
exists.

Do **not** try to roll back by reverting the commit that added a migration — the
change is in the database, not in the file, and later migrations are stacked on it.

For a **local** database you control:

```bash
pg_dump -U <user> -d <db> -F c -f backup.dump          # before migrating
pg_restore --clean --if-exists -U <user> -d <db> backup.dump   # to roll back
```

`--clean --if-exists` is required: restoring into a database that already holds the
migrated schema otherwise fails on every existing object. Restoring also discards
every row written since the dump.

## Related

- `packages/db/MIGRATIONS.md` — the "how migrations work" guide and schema notes.
  ⚠️ Its Story-4-2 workflow section predates the preflight and the lock; use the
  commands on this page instead.
- `packages/db/scripts/migrate-users-to-uuid.ts` — a historical one-off from story
  4-2 (serial → uuid `users.id`). Its header records its status: **not needed for new
  setups**. `users.id` has been uuid since `0000`; the four entity-table primary keys
  were converted later, in `0003`. The `0000_fix_users_id_type_to_uuid.sql` that
  `0003`'s header cites as its pattern source is this script's never-committed
  predecessor — it existed on disk before story 5-14 started tracking this directory,
  and is why `0003` names a file you will not find here.
