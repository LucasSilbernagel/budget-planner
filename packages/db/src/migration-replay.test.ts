// Replays the whole chain on PGlite (real PostgreSQL 18) and compares the result to the schema.
// @electric-sql/pglite must stay a ROOT devDependency: declaring it here forks drizzle-orm's types.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { getTableColumns, getTableName, is, SQL } from 'drizzle-orm'
import { getTableConfig, isPgEnum, PgDialect, PgTable } from 'drizzle-orm/pg-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as schema from './schema'

type JournalEntry = {
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

/** `format_type()` returns canonical names (`character varying`), Drizzle the aliases. */
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

function renderSql(node: SQL): string {
	return dialect.sqlToQuery(node).sql
}

/** Fitted to the spellings PostgreSQL produced for this schema; a new shape fails, never silently passes. */
function normalizeExpr(raw: string): string {
	let s = raw.replace(/"/g, '')
	// Casts: '::text', '::subscriptionStatus', '::character varying'.
	s = s.replace(/::\s*[A-Za-z_][A-Za-z0-9_ ]*(\[\])?/g, '')
	// Table qualifiers: `categories.name` -> `name`.
	s = s.replace(/\b[A-Za-z_][A-Za-z0-9_]*\.(?=[A-Za-z_])/g, '')
	// Parens PostgreSQL adds around a bare column inside a call: `lower((name))`. The lookbehind
	// keeps a function's own parens, so `lower(name)` does not become `lowername`.
	s = s.replace(/(?<![A-Za-z0-9_])\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/g, '$1')
	s = s.replace(/\s+/g, ' ').trim()
	// `(NOT <bare column>)` inside a compound predicate. Deliberately narrow, so a real grouping
	// like `(a OR b)` cannot collapse.
	s = s.replace(/\(\s*NOT\s+([A-Za-z_][A-Za-z0-9_]*)\s*\)/g, 'NOT $1')
	// A whole-expression wrapper: `(isDeleted = false)`.
	const wrapped = s.match(/^\((.*)\)$/)
	return (wrapped ? wrapped[1] : s).trim()
}

// `$defaultFn()` emits no DB default, serial's sequence name is not pinned, and SQL-valued
// defaults must be rendered, not stringified.
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

function normalizeDefault(raw: string): string {
	const s = raw.trim()
	// The sequence name is a serial detail; that it IS a nextval is the assertion.
	if (s.startsWith('nextval(')) return 'nextval'
	return normalizeExpr(s)
}

// Strips every paren, so operator precedence is invisible here; the constraint behaviour
// tests prove what each predicate means.
function normalizeCheckExpr(raw: string): string {
	// `pg_get_constraintdef` wraps the whole predicate in `CHECK (...)`.
	const body = raw.trim().replace(/^CHECK\s*\(([\s\S]*)\)$/i, '$1')
	return (
		normalizeExpr(body)
			.replace(/[()]/g, ' ')
			// Re-space operators: the cast-stripping pattern also eats the space before `<>`.
			.replace(/([<>=!]+)/g, ' $1 ')
			.replace(/\s+/g, ' ')
			.trim()
	)
}

type ExpectedColumn = {
	type: string
	notNull: boolean
}

const expectedTables = new Map<string, Map<string, ExpectedColumn>>()
const expectedPrimaryKeys = new Map<string, string[]>()
const expectedForeignKeys = new Map<string, Set<string>>()
const expectedDefaults = new Map<string, Record<string, string>>()
const expectedUniqueConstraints = new Map<string, string[]>()
const expectedUniqueIndexes = new Map<string, string[]>()
const expectedChecks = new Map<string, Record<string, string>>()

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

	// `column.uniqueName` is set on every column, so gate on `isUnique`.
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
					.map((c) => {
						if (is(c, SQL)) return normalizeExpr(renderSql(c))
						if (!('name' in c) || typeof c.name !== 'string') {
							throw new Error(`${table}: index ${index.config.name} has a column with no name`)
						}
						return normalizeExpr(c.name)
					})
					.join(', ')
				const where = index.config.where
					? ` WHERE ${normalizeExpr(renderSql(index.config.where))}`
					: ''
				return `${index.config.name}(${cols})${where}`
			})
			.sort()
	)

	const checks: Record<string, string> = {}
	for (const check of config.checks) {
		checks[check.name] = normalizeCheckExpr(renderSql(check.value))
	}
	expectedChecks.set(table, checks)
}

// Collected from module exports, not columns: an empty `it.each` generates zero tests and stays green.
const expectedEnums = new Map<string, string[]>()
for (const value of Object.values(schema)) {
	if (isPgEnum(value)) expectedEnums.set(value.enumName, [...value.enumValues])
}

let db: PGlite
let appliedStatements = 0

beforeAll(async () => {
	db = await PGlite.create()
	// One transaction for the whole chain, like drizzle's migrator: autocommit would green a
	// migration that adds an enum value and uses it in the same transaction.
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
		// Measured from the run, never predicted: they catch a migration generated but not committed,
		// or a regeneration that drops the hand-written SQL.
		expect(journal.entries.length).toBe(27)
		expect(appliedStatements).toBe(169)
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
			// Whole-map comparison so a wrong type on a correctly-named column can't pass.
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

	it('derived a non-zero set of defaults, unique rules and CHECKs (guards against asserting nothing)', () => {
		// Guards against the metadata walk silently finding nothing and comparing {} to {}.
		const totalDefaults = [...expectedDefaults.values()].reduce(
			(n, d) => n + Object.keys(d).length,
			0
		)
		const totalUniques = [...expectedUniqueConstraints.values()].reduce((n, u) => n + u.length, 0)
		const totalUniqueIndexes = [...expectedUniqueIndexes.values()].reduce((n, u) => n + u.length, 0)
		// Exactly eight: most tables declare no check, so a collapsed derivation would pass on them.
		const totalChecks = [...expectedChecks.values()].reduce((n, c) => n + Object.keys(c).length, 0)
		expect(totalDefaults).toBeGreaterThan(0)
		expect(totalUniques).toBeGreaterThan(0)
		expect(totalUniqueIndexes).toBeGreaterThan(0)
		expect(totalChecks).toBe(8)
	})

	it.each([...expectedTables.keys()].sort())(
		'lands %s with the CHECK constraints schema.ts declares',
		async (table) => {
			const result = await db.query<{ conname: string; def: string }>(
				`SELECT con.conname, pg_get_constraintdef(con.oid) AS def
           FROM pg_constraint con
           JOIN pg_class cl ON cl.oid = con.conrelid
           JOIN pg_namespace n ON n.oid = cl.relnamespace
          WHERE con.contype = 'c' AND n.nspname = 'public' AND cl.relname = $1`,
				[table]
			)
			// `contype = 'c'` exactly: PostgreSQL 18 also catalogues NOT NULL constraints, as 'n'.
			const actual = Object.fromEntries(
				result.rows.map((r) => [r.conname, normalizeCheckExpr(r.def)])
			)
			// Whole map, so a drifted predicate under the right name can't pass.
			expect(actual).toEqual(expectedChecks.get(table))
		}
	)

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
			// Whole maps: catches a forgotten, an invented and a drifted default.
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
				// Indexes backing a unique constraint are excluded, or every `.unique()` column would show up.
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
			// The partial predicate matters: without it, soft-deleted names would block re-use.
			expect(actual).toEqual(expectedUniqueIndexes.get(table))
		}
	)

	it('creates users.sessionsRevokedAt as declared (the column session revocation needs)', async () => {
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
		// Without this, broken enum detection turns the it.each below into zero tests.
		expect(expectedEnums.size).toBe(7)
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
