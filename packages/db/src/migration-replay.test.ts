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
 * extensions, its roles/grants, or TLS. Nor does it exercise `drizzle-kit`
 * itself — the journal bookkeeping and the migrator's own SSL/config path are
 * unexercised here, because this replays the SQL directly. Those are
 * AC-1/AC-3/AC-5 and stay live verifications.
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
import { PgTable, getTableConfig, isPgEnum } from 'drizzle-orm/pg-core'
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

/**
 * Reduce a PostgreSQL and a Drizzle type name to a common spelling.
 * `format_type()` returns the canonical form (`character varying(255)`) while
 * Drizzle emits the alias (`varchar(255)`); `serial` is a pseudo-type that IS
 * `integer` once created. Without this the comparison is 36 false diffs.
 */
function normalizeType(raw: string): string {
  return raw
    .trim()
    .replace(/"/g, '')
    .replace(/\bcharacter varying\b/g, 'varchar')
    .replace(/\btimestamp without time zone\b/g, 'timestamp')
    .replace(/\btimestamp with time zone\b/g, 'timestamptz')
    .replace(/^bigserial$/, 'bigint')
    .replace(/^serial$/, 'integer')
    .replace(/^smallserial$/, 'smallint')
}

interface ExpectedColumn {
  type: string
  notNull: boolean
}

/** Expected shape, derived from schema.ts itself so it cannot drift from the code. */
const expectedTables = new Map<string, Map<string, ExpectedColumn>>()
const expectedPrimaryKeys = new Map<string, string[]>()
const expectedForeignKeys = new Map<string, Set<string>>()

for (const value of Object.values(schema)) {
  if (!is(value, PgTable)) continue
  const table = getTableName(value)
  const columns = Object.values(getTableColumns(value))

  expectedTables.set(
    table,
    new Map(
      columns.map((c) => [c.name, { type: normalizeType(c.getSQLType()), notNull: c.notNull }])
    )
  )

  const config = getTableConfig(value)
  const composite = config.primaryKeys.flatMap((pk) => pk.columns.map((c) => c.name))
  const single = columns.filter((c) => c.primary).map((c) => c.name)
  expectedPrimaryKeys.set(table, [...new Set([...single, ...composite])].sort())

  expectedForeignKeys.set(
    table,
    new Set(
      config.foreignKeys.map((fk) => {
        const ref = fk.reference()
        const from = ref.columns.map((c) => c.name).join(',')
        const to = ref.foreignColumns.map((c) => c.name).join(',')
        return `${from}->${getTableName(ref.foreignTable)}.${to}`
      })
    )
  )
}

/**
 * Enums are collected from the schema module's own exports, NOT from the columns
 * that happen to use them. Collecting via columns under-reports an enum attached
 * to no column, and — worse — `it.each` over an empty map generates ZERO tests
 * and stays green, so a detection failure would silently stop asserting enums
 * altogether. The non-empty guard below exists for exactly that.
 */
const expectedEnums = new Map<string, string[]>()
for (const value of Object.values(schema)) {
  if (isPgEnum(value)) expectedEnums.set(value.enumName, [...value.enumValues])
}

let db: PGlite
let appliedStatements = 0

beforeAll(async () => {
  db = await PGlite.create()
  // One transaction for the WHOLE chain, mirroring drizzle's migrator
  // (drizzle-orm pg-core/dialect.js wraps its migration loop in
  // `session.transaction`). Applying statements in autocommit instead would
  // green a migration that adds an enum value and uses it in the same
  // transaction — legal here, rejected by PostgreSQL there.
  await db.exec('BEGIN')
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
  await db.exec('COMMIT')
}, 120_000)

afterAll(async () => {
  await db?.close()
})

describe('clean-slate migration replay', () => {
  it('applies every journal migration onto an empty database, in one transaction', () => {
    // beforeAll throws on the first failing statement, so reaching here IS the
    // replay passing; these assert the run was the full chain, not a no-op.
    expect(journal.entries.length).toBe(17)
    expect(appliedStatements).toBe(135)
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
    const actual = result.rows.map((r) => r.table_name).sort()
    expect(actual).toEqual([...expectedTables.keys()].sort())
  })

  it.each([...expectedTables.keys()].sort())(
    'lands %s with the columns, types and nullability schema.ts declares',
    async (table) => {
      const result = await db.query<{ column_name: string; pgtype: string; nn: boolean }>(
        `SELECT c.column_name, format_type(a.atttypid, a.atttypmod) AS pgtype, a.attnotnull AS nn
           FROM information_schema.columns c
           JOIN pg_class cl ON cl.relname = c.table_name
           JOIN pg_attribute a ON a.attrelid = cl.oid AND a.attname = c.column_name
          WHERE c.table_schema = 'public' AND c.table_name = $1`,
        [table]
      )
      const actual = Object.fromEntries(
        result.rows.map((r) => [r.column_name, { type: normalizeType(r.pgtype), notNull: r.nn }])
      )
      // Comparing the whole map at once, rather than names then types, so a
      // wrong TYPE on a correctly-named column cannot pass. A migration landing
      // `sessionsRevokedAt` as integer where schema.ts says bigint overflows on
      // epoch-millis in production; a name-only check greens it.
      expect(actual).toEqual(
        Object.fromEntries(expectedTables.get(table) as Map<string, ExpectedColumn>)
      )
    }
  )

  it.each([...expectedTables.keys()].sort())(
    'lands %s with the primary key schema.ts declares',
    async (table) => {
      const result = await db.query<{ column_name: string }>(
        `SELECT a.attname AS column_name
           FROM pg_constraint con
           JOIN pg_class cl ON cl.oid = con.conrelid
           JOIN pg_attribute a ON a.attrelid = cl.oid AND a.attnum = ANY(con.conkey)
          WHERE con.contype = 'p' AND cl.relname = $1`,
        [table]
      )
      expect(result.rows.map((r) => r.column_name).sort()).toEqual(expectedPrimaryKeys.get(table))
    }
  )

  it.each([...expectedTables.keys()].sort())(
    'lands %s with the foreign keys schema.ts declares',
    async (table) => {
      const result = await db.query<{ def: string; conname: string }>(
        `SELECT pg_get_constraintdef(con.oid) AS def, con.conname
           FROM pg_constraint con
           JOIN pg_class cl ON cl.oid = con.conrelid
          WHERE con.contype = 'f' AND cl.relname = $1`,
        [table]
      )
      // FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ... -> userId->users.id
      const actual = new Set(
        result.rows.map((r) => {
          const m = r.def.match(
            /FOREIGN KEY \(([^)]+)\) REFERENCES "?(?:public"?\.)?"?([^"(]+)"?\(([^)]+)\)/
          )
          if (!m) return `UNPARSED:${r.def}`
          const strip = (s: string) =>
            s
              .split(',')
              .map((x) => x.trim().replace(/"/g, ''))
              .join(',')
          return `${strip(m[1])}->${m[2].replace(/"/g, '')}.${strip(m[3])}`
        })
      )
      expect([...actual].sort()).toEqual(
        [...(expectedForeignKeys.get(table) as Set<string>)].sort()
      )
    }
  )

  it('creates users.sessionsRevokedAt as declared (the column 5-8 AC-11 needs)', async () => {
    // AC-4 calls this out explicitly. Note this proves the COLUMN exists on a
    // clean replay — it does NOT close 5-8's AC-11, which is about applying 0004
    // to the LIVE instance. That remains Story 5.17's.
    const users = expectedTables.get('users') as Map<string, ExpectedColumn>
    expect(users.has('sessionsRevokedAt')).toBe(true)
    const result = await db.query<{ pgtype: string }>(
      `SELECT format_type(a.atttypid, a.atttypmod) AS pgtype
         FROM pg_attribute a JOIN pg_class cl ON cl.oid = a.attrelid
        WHERE cl.relname = 'users' AND a.attname = 'sessionsRevokedAt'`
    )
    expect(result.rows).toHaveLength(1)
    expect(normalizeType(result.rows[0].pgtype)).toBe('bigint')
  })

  it('detected the enums declared in schema.ts (guards against asserting nothing)', () => {
    // Without this, a change that breaks enum detection turns the it.each below
    // into zero tests and the suite stays green while enums drift freely.
    expect(expectedEnums.size).toBe(6)
  })

  it('creates exactly the enum types schema.ts declares', async () => {
    const result = await db.query<{ typname: string }>(
      `SELECT DISTINCT t.typname FROM pg_type t
         JOIN pg_enum e ON e.enumtypid = t.oid`
    )
    expect(result.rows.map((r) => r.typname).sort()).toEqual([...expectedEnums.keys()].sort())
  })

  it.each([...expectedEnums.keys()].sort())(
    'lands the %s enum with schema.ts values, in order',
    async (name) => {
      const result = await db.query<{ label: string }>(
        `SELECT e.enumlabel AS label FROM pg_enum e
           JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = $1
          ORDER BY e.enumsortorder`,
        [name]
      )
      // Order matters: enum sort order drives ORDER BY and range comparisons.
      expect(result.rows.map((r) => r.label)).toEqual(expectedEnums.get(name))
    }
  )
})
