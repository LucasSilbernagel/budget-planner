/**
 * Migration preflight CLI (Story 5-4, AC-4) — the abort-before-migrate gate.
 *
 * Run immediately before `drizzle-kit migrate` in the production deploy
 * pipeline:
 *
 *   pnpm --filter @budget-planner/db db:migrate:preflight
 *
 * Exits 0 only when `assessMigrateSafety` proves the target is either a clean
 * slate or a journal-tracked database. Any other shape — most importantly a
 * `drizzle-kit push`-built database (deferred-work:643) — exits 1, which aborts
 * the deploy before a single migration statement runs.
 *
 * The database URL is validated by the SAME sovereignty and TLS policy the app
 * uses (`isEuSovereignDbHost` / `buildDbSsl` from ./client), so the preflight
 * can never reach a host the application itself would refuse (NFR1, NFR2).
 */

import process from 'node:process'
import { Pool } from 'pg'
import { isEuSovereignDbHost, isRelaxedDbEnv } from './client'
import { type DbShape, assessMigrateSafety } from './migrate-preflight'
// The preflight runs inside the same DNS window, against the same public endpoint,
// as the migration it gates — so it needs the same TLS posture. If it kept the
// app's verify-full policy it would fail ERR_TLS_CERT_ALTNAME_INVALID and abort
// every migration before the guard could reach the database. `migrate-preflight.ts`
// and its classification logic are untouched; only the connection option changes.
import { buildMigrationDbSsl, hostnameMismatchAllowedFromEnv } from './migrate-tls'

/** Postgres journal written by drizzle-kit: schema `drizzle`, table `__drizzle_migrations`. */
const JOURNAL = 'drizzle.__drizzle_migrations'

/**
 * `count(*)` comes back from `pg` as a string (bigint is not JS-safe by
 * default), so parse explicitly. Anything unparseable becomes NaN and is
 * rejected downstream by `assessMigrateSafety`'s fail-closed sanity check
 * rather than being coerced to a plausible-looking 0.
 */
function toCount(value: unknown): number {
  if (typeof value === 'number') {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    return Number(value)
  }
  return Number.NaN
}

async function probe(pool: Pool): Promise<DbShape> {
  // to_regclass() returns NULL (rather than throwing) when the relation is absent.
  const journalTable = await pool.query<{ reg: string | null }>(
    'select to_regclass($1)::text as reg',
    [JOURNAL]
  )
  const hasJournalTable = journalTable.rows[0]?.reg != null

  const journalRowCount = hasJournalTable
    ? toCount((await pool.query<{ n: string }>(`select count(*) as n from ${JOURNAL}`)).rows[0]?.n)
    : 0

  // Count real tables in EVERY non-system schema, not just `public`. Code review
  // 2026-09-03: a database whose tables live in another schema reported 0 and was
  // classified `empty` / safe — the exact hazard this guard exists to catch, just
  // outside its field of view. `drizzle` is excluded because it holds the journal
  // itself; counting it would make a genuinely clean slate look populated.
  const userTables = await pool.query<{ n: string }>(
    `select count(*) as n from information_schema.tables
      where table_type = 'BASE TABLE'
        and table_schema not in ('pg_catalog', 'information_schema', 'drizzle')
        and table_schema not like 'pg_toast%'
        and table_schema not like 'pg_temp%'`
  )

  return {
    hasJournalTable,
    journalRowCount,
    userTableCount: toCount(userTables.rows[0]?.n),
  }
}

async function main(): Promise<number> {
  const databaseUrl = process.env['DATABASE_URL']
  if (!databaseUrl) {
    console.error('[migrate-preflight] DATABASE_URL is not set. Refusing to migrate.')
    return 1
  }

  const nodeEnv = process.env['NODE_ENV']
  let host: string
  try {
    host = new URL(databaseUrl).hostname.toLowerCase()
  } catch {
    console.error('[migrate-preflight] DATABASE_URL is not a parseable URL. Refusing to migrate.')
    return 1
  }

  // Same fail-closed rule as the application's pool: only an explicit
  // development/test NODE_ENV may point at a non-DanubeData host.
  if (!isRelaxedDbEnv(nodeEnv) && !isEuSovereignDbHost(host)) {
    console.error(
      `[migrate-preflight] Refusing to migrate: "${host}" is not a DanubeData EU host (NFR1/NFR2, CLOUD Act immunity). Expected e.g. *.danubedata.ro.`
    )
    return 1
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: buildMigrationDbSsl(
      nodeEnv,
      process.env['DATABASE_CA_CERT'],
      hostnameMismatchAllowedFromEnv(process.env)
    ),
    max: 1,
    connectionTimeoutMillis: 10_000,
    // Connecting is not the only way this can hang: a probe query blocked on a
    // lock held by another session would wait forever, and because the deploy
    // workflow serialises on a non-cancelling concurrency group, one stuck run
    // silently queues every later deploy behind it. Cap the queries too.
    statement_timeout: 15_000,
    query_timeout: 15_000,
  })

  try {
    const shape = await probe(pool)
    const verdict = assessMigrateSafety(shape)

    console.log(
      `[migrate-preflight] host=${host} journalTable=${shape.hasJournalTable} ` +
        `journalRows=${shape.journalRowCount} publicTables=${shape.userTableCount} ` +
        `-> ${verdict.provenance}`
    )

    if (!verdict.safe) {
      console.error(`[migrate-preflight] ABORTING DEPLOY: ${verdict.reason}`)
      return 1
    }

    console.log(`[migrate-preflight] OK: ${verdict.reason}`)
    return 0
  } catch (error) {
    // An unreachable or unreadable database is a refusal, not a pass.
    console.error(
      '[migrate-preflight] Could not establish the database shape; refusing to migrate.',
      error instanceof Error ? error.message : error
    )
    return 1
  } finally {
    await pool.end().catch(() => undefined)
  }
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (error: unknown) => {
    console.error('[migrate-preflight] Unexpected failure; refusing to migrate.', error)
    process.exitCode = 1
  }
)
