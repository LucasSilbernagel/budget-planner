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
 * Compared against `schema.ts`, all derived from the Drizzle metadata rather
 * than a hardcoded list: table names, column names, normalised column types,
 * nullability, primary keys, foreign keys, column DEFAULTS, unique constraints,
 * unique indexes (name, columns and partial predicate), and ordered enum labels.
 *
 * Still NOT compared: non-unique indexes (performance-only, and pre-launch there
 * are no users) and CHECK constraints — drizzle-kit 0.23.2 never emits CHECK, so
 * the migrations contain none and asserting them would compare empty to empty
 * and pass forever. See `deferred-work.md`.
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
import { SQL, getTableColumns, getTableName, is } from 'drizzle-orm'
import { PgDialect, PgTable, getTableConfig, isPgEnum } from 'drizzle-orm/pg-core'
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

const dialect = new PgDialect()

/**
 * Render a Drizzle `sql` fragment to the text PostgreSQL would have been given.
 * Used for SQL-valued column defaults and for index expressions/predicates.
 */
function renderSql(node: SQL): string {
  return dialect.sqlToQuery(node).sql
}

/**
 * Reduce a default/index expression to a spelling both sides can agree on.
 * Drizzle emits `lower("categories"."name")`; PostgreSQL echoes the same thing
 * back as `lower((name)::text)` — the same expression with three cosmetic
 * differences (quoting, table qualifier, an implicit cast it makes explicit).
 * This strips exactly those. It is fitted to the spellings PostgreSQL actually
 * produced for this schema, not to a general SQL grammar, so a genuinely new
 * expression shape may need it extended — which surfaces as a test failure, not
 * as a silent pass.
 */
function normalizeExpr(raw: string): string {
  let s = raw.replace(/"/g, '')
  // Casts: '::text', '::subscriptionStatus', '::character varying'.
  s = s.replace(/::\s*[A-Za-z_][A-Za-z0-9_ ]*(\[\])?/g, '')
  // Table qualifiers: `categories.name` -> `name`.
  s = s.replace(/\b[A-Za-z_][A-Za-z0-9_]*\.(?=[A-Za-z_])/g, '')
  // Parens PostgreSQL adds around a bare column inside a call: `lower((name))`.
  // The lookbehind is load-bearing: without it this also strips a FUNCTION's
  // own parens and `lower(name)` collapses to `lowername`.
  s = s.replace(/(?<![A-Za-z0-9_])\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/g, '$1')
  s = s.replace(/\s+/g, ' ').trim()
  // A whole-expression wrapper: `(isDeleted = false)`.
  const wrapped = s.match(/^\((.*)\)$/)
  return (wrapped ? wrapped[1] : s).trim()
}

/**
 * The DB-level default schema.ts declares for a column, or undefined if it
 * declares none.
 *
 * Three cases that reading `hasDefault` alone would get wrong:
 * - `$defaultFn()` is generated in JS on insert and emits NO database default,
 *   so it must not be expected in the DDL;
 * - `serial`/`bigserial` set `hasDefault` with no `.default` value — the default
 *   is a `nextval()` over a generated sequence whose name is not worth pinning;
 * - a SQL-valued default (`defaultRandom()`, `defaultNow()`) is a fragment, not
 *   a literal, and has to be rendered rather than stringified.
 */
function expectedDefaultFor(column: {
  hasDefault?: boolean
  default?: unknown
  defaultFn?: unknown
}): string | undefined {
  if (!column.hasDefault) return undefined
  if (column.defaultFn !== undefined) return undefined
  const value = column.default
  if (value === undefined) return 'nextval'
  if (is(value, SQL)) return normalizeExpr(renderSql(value))
  if (typeof value === 'string') return normalizeExpr(`'${value}'`)
  return normalizeExpr(String(value))
}

/** PostgreSQL's own rendering of a stored default, reduced the same way. */
function normalizeDefault(raw: string): string {
  const s = raw.trim()
  // `nextval('"rateLimits_id_seq"'::regclass)` — the sequence name is an
  // implementation detail of `serial`; that it IS a nextval is the assertion.
  if (s.startsWith('nextval(')) return 'nextval'
  return normalizeExpr(s)
}

interface ExpectedColumn {
  type: string
  notNull: boolean
}

/** Expected shape, derived from schema.ts itself so it cannot drift from the code. */
const expectedTables = new Map<string, Map<string, ExpectedColumn>>()
const expectedPrimaryKeys = new Map<string, string[]>()
const expectedForeignKeys = new Map<string, Set<string>>()
const expectedDefaults = new Map<string, Record<string, string>>()
const expectedUniqueConstraints = new Map<string, string[]>()
const expectedUniqueIndexes = new Map<string, string[]>()

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

  const defaults: Record<string, string> = {}
  for (const c of columns) {
    const value = expectedDefaultFor(c)
    if (value !== undefined) defaults[c.name] = value
  }
  expectedDefaults.set(table, defaults)

  // Uniqueness is declared two ways in this schema and both are enforcement,
  // not decoration: `.unique()` / `unique()` become UNIQUE CONSTRAINTS, while
  // `uniqueIndex()` becomes a unique INDEX — the only form that can be partial
  // or over an expression, which is why `categories` needs it. They land in
  // different catalogs, so they are asserted separately.
  //
  // ⚠️ `column.uniqueName` is populated on EVERY column whether or not it is
  // unique, so reading it without gating on `isUnique` would claim a unique
  // constraint on every column in the schema.
  expectedUniqueConstraints.set(
    table,
    [
      ...columns.filter((c) => c.isUnique).map((c) => c.name),
      ...config.uniqueConstraints.map((u) => u.columns.map((c) => c.name).join(',')),
    ].sort()
  )

  expectedUniqueIndexes.set(
    table,
    config.indexes
      .filter((index) => index.config.unique)
      .map((index) => {
        const cols = index.config.columns
          .map((c) => (is(c, SQL) ? normalizeExpr(renderSql(c)) : normalizeExpr(c.name)))
          .join(', ')
        const where = index.config.where
          ? ` WHERE ${normalizeExpr(renderSql(index.config.where))}`
          : ''
        return `${index.config.name}(${cols})${where}`
      })
      .sort()
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

  it('derived a non-zero set of defaults and unique rules (guards against asserting nothing)', () => {
    // The failure shape the enum guard exists for, repeated here: if the
    // metadata walk above silently stopped finding defaults or uniques, the
    // per-table assertions below would compare {} to {} on every table that has
    // none, and the suite would stay green while the interesting tables drifted.
    // Verified 2026-09-05 by deleting the unique derivation: this test fails
    // alongside the three per-table ones rather than leaving them to notice.
    const totalDefaults = [...expectedDefaults.values()].reduce(
      (n, d) => n + Object.keys(d).length,
      0
    )
    const totalUniques = [...expectedUniqueConstraints.values()].reduce((n, u) => n + u.length, 0)
    const totalUniqueIndexes = [...expectedUniqueIndexes.values()].reduce((n, u) => n + u.length, 0)
    expect(totalDefaults).toBeGreaterThan(0)
    expect(totalUniques).toBeGreaterThan(0)
    expect(totalUniqueIndexes).toBeGreaterThan(0)
  })

  it.each([...expectedTables.keys()].sort())(
    'lands %s with the column defaults schema.ts declares',
    async (table) => {
      const result = await db.query<{ column_name: string; def: string }>(
        `SELECT a.attname AS column_name, pg_get_expr(d.adbin, d.adrelid) AS def
           FROM pg_attribute a
           JOIN pg_class cl ON cl.oid = a.attrelid
           JOIN pg_namespace n ON n.oid = cl.relnamespace
           JOIN pg_attrdef d ON d.adrelid = cl.oid AND d.adnum = a.attnum
          WHERE n.nspname = 'public' AND cl.relname = $1
            AND a.attnum > 0 AND NOT a.attisdropped`,
        [table]
      )
      const actual = Object.fromEntries(
        result.rows.map((r) => [r.column_name, normalizeDefault(r.def)])
      )
      // Compared as whole maps, so this catches all three directions at once: a
      // default the migration forgot, one it invented, and one whose expression
      // drifted. The `gen_random_uuid()` defaults are more than tidiness — the
      // client-generated-uuid contract from 5-14 leaves the database default as
      // the path for server-originated rows.
      expect(actual).toEqual(expectedDefaults.get(table))
    }
  )

  it.each([...expectedTables.keys()].sort())(
    'lands %s with the unique constraints schema.ts declares',
    async (table) => {
      const result = await db.query<{ def: string }>(
        `SELECT pg_get_constraintdef(con.oid) AS def
           FROM pg_constraint con
           JOIN pg_class cl ON cl.oid = con.conrelid
          WHERE con.contype = 'u' AND cl.relname = $1`,
        [table]
      )
      const actual = result.rows
        .map((r) => {
          const m = r.def.match(/^UNIQUE(?: NULLS NOT DISTINCT)? \(([^)]+)\)/)
          if (!m) return `UNPARSED:${r.def}`
          return m[1]
            .split(',')
            .map((c) => c.trim().replace(/"/g, ''))
            .join(',')
        })
        .sort()
      expect(actual).toEqual(expectedUniqueConstraints.get(table))
    }
  )

  it.each([...expectedTables.keys()].sort())(
    'lands %s with the unique indexes schema.ts declares',
    async (table) => {
      const result = await db.query<{ name: string; def: string }>(
        // Indexes that BACK a unique constraint are excluded: they are the same
        // rule the assertion above already covers, and counting them here would
        // report every `.unique()` column as a unique index this schema never
        // declares.
        `SELECT i.relname AS name, pg_get_indexdef(idx.indexrelid) AS def
           FROM pg_index idx
           JOIN pg_class i ON i.oid = idx.indexrelid
           JOIN pg_class t ON t.oid = idx.indrelid
          WHERE idx.indisunique AND NOT idx.indisprimary AND t.relname = $1
            AND NOT EXISTS (
              SELECT 1 FROM pg_constraint con WHERE con.conindid = idx.indexrelid
            )`,
        [table]
      )
      const actual = result.rows
        .map((r) => {
          // CREATE UNIQUE INDEX name ON public.t USING btree (a, lower(b)) WHERE (p)
          const m = r.def.match(/USING \w+ \((.*?)\)(?: WHERE \((.*)\))?$/)
          if (!m) return `UNPARSED:${r.def}`
          const cols = m[1]
            .split(/,\s*(?![^(]*\))/)
            .map((c) => normalizeExpr(c))
            .join(', ')
          const where = m[2] ? ` WHERE ${normalizeExpr(m[2])}` : ''
          return `${r.name}(${cols})${where}`
        })
        .sort()
      // Name, columns AND the partial predicate. The predicate is the whole
      // point of the `categories` index: without `WHERE isDeleted = false` it
      // would constrain soft-deleted rows too, so a name-and-columns check would
      // green a uniqueness rule that silently blocks legitimate re-use of a
      // deleted category's name.
      expect(actual).toEqual(expectedUniqueIndexes.get(table))
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
