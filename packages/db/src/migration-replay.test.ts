/**
 * Clean-slate migration replay (Story 4.17, AC-4).
 *
 * AC-4 requires that the full chain applies cleanly onto a freshly provisioned,
 * empty database and that the result matches `schema.ts`. The production
 * instance is internal-DNS-only, so that run belongs to Story 5.17's in-network
 * Job — but the chain itself can be replayed here against a real PostgreSQL
 * engine, catching a broken migration on a laptop instead of in a deploy job.
 *
 * PGlite is genuine PostgreSQL compiled to WebAssembly, reporting the same
 * MAJOR version as the managed instance (18), so this exercises the actual
 * parser, planner and executor — not a shape-matching stub. It runs in-process
 * with no server, no Docker and no credentials, so it is NOT env-gated: unlike
 * the live-DB tests it can run everywhere, which is the point.
 *
 * What this does NOT prove: the managed instance's minor version, its
 * extensions, its roles/grants, or TLS. Those are AC-1/AC-3/AC-5 and stay live
 * verifications. This proves the SQL chain replays and lands on `schema.ts`.
 *
 * Complements `migration-chain.test.ts`, which proves journal↔file integrity
 * statically. That one asks whether the chain is well-formed; this one runs it.
 *
 * ⚠️ `@electric-sql/pglite` is a devDependency of the WORKSPACE ROOT, not of this
 * package, and must stay there. It is an optional peer of `drizzle-orm`, so
 * declaring it here changes drizzle-orm's peer-resolution hash for `packages/db`
 * alone: pnpm then links a SECOND physical copy of drizzle-orm, and `apps/web`
 * (which keeps the original) no longer shares its types. `SQL<unknown>` from the
 * two copies has separate declarations of a private property, so it stops being
 * assignable to itself — measured 2026-09-05 as **262 type errors in apps/web**
 * with this package's own type-check still reporting 0. Node resolves the root
 * copy by walking up from here, so the import below works unchanged.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { getTableColumns, getTableName, is } from 'drizzle-orm'
import { PgEnumColumn, PgTable } from 'drizzle-orm/pg-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as schema from './schema'

interface JournalEntry {
  idx: number
  tag: string
}

const journal = JSON.parse(
  readFileSync(new URL('../migrations/meta/_journal.json', import.meta.url), 'utf8')
) as { entries: JournalEntry[] }

function migrationStatements(tag: string): string[] {
  const sql = readFileSync(
    fileURLToPath(new URL(`../migrations/${tag}.sql`, import.meta.url)),
    'utf8'
  )
  return sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/** Expected shape, derived from schema.ts itself so it cannot drift from the code. */
const expectedTables = new Map<string, Set<string>>()
const expectedEnums = new Map<string, Set<string>>()
for (const value of Object.values(schema)) {
  if (is(value, PgTable)) {
    const columns = Object.values(getTableColumns(value))
    expectedTables.set(getTableName(value), new Set(columns.map((c) => c.name)))
    for (const column of columns) {
      if (is(column, PgEnumColumn)) {
        expectedEnums.set(column.enumValues ? column.enum.enumName : '', new Set(column.enumValues))
      }
    }
  }
}
expectedEnums.delete('')

let db: PGlite
let appliedStatements = 0

beforeAll(async () => {
  db = await PGlite.create()
  for (const entry of journal.entries) {
    for (const statement of migrationStatements(entry.tag)) {
      try {
        await db.exec(statement)
      } catch (error) {
        throw new Error(
          `Migration ${entry.tag} failed on statement:\n${statement}\n\n${(error as Error).message}`
        )
      }
      appliedStatements += 1
    }
  }
}, 120_000)

afterAll(async () => {
  await db?.close()
})

async function columnsOf(table: string): Promise<Set<string>> {
  const result = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  )
  return new Set(result.rows.map((r) => r.column_name))
}

describe('clean-slate migration replay', () => {
  it('applies every journal migration onto an empty database', () => {
    // beforeAll throws on the first failing statement, so reaching here IS the
    // replay passing; these assert the run was the full chain, not a no-op.
    expect(journal.entries.length).toBe(17)
    expect(appliedStatements).toBeGreaterThan(100)
  })

  it('runs on the same PostgreSQL major version as the managed instance', async () => {
    const result = await db.query<{ version: string }>('SELECT version()')
    expect(result.rows[0].version).toMatch(/PostgreSQL 18\b/)
  })

  it('creates exactly the tables declared in schema.ts', async () => {
    const result = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    )
    const actual = result.rows
      .map((r) => r.table_name)
      .filter((t) => t !== '__drizzle_migrations')
      .sort()
    expect(actual).toEqual([...expectedTables.keys()].sort())
  })

  it.each([...expectedTables.keys()].sort())(
    'lands %s with exactly the columns schema.ts declares',
    async (table) => {
      const actual = await columnsOf(table)
      const expected = expectedTables.get(table) as Set<string>
      expect([...actual].sort()).toEqual([...expected].sort())
    }
  )

  it('creates users.sessionsRevokedAt, closing the 5-8 AC-11 deferral', async () => {
    // Called out explicitly by AC-4: without this column the logout-revocation
    // path 500s and fails open, so a silent absence is a security regression.
    expect(await columnsOf('users')).toContain('sessionsRevokedAt')
  })

  it.each([...expectedEnums.keys()].sort())(
    'lands the %s enum with schema.ts values',
    async (name) => {
      const result = await db.query<{ label: string }>(
        `SELECT e.enumlabel AS label FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = $1`,
        [name]
      )
      const actual = new Set(result.rows.map((r) => r.label))
      expect([...actual].sort()).toEqual([...(expectedEnums.get(name) as Set<string>)].sort())
    }
  )
})
