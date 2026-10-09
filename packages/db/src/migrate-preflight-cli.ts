// Exits 0 only for a clean slate or a journal-tracked database; anything else (e.g. a
// `drizzle-kit push`-built one) aborts the deploy before any migration runs.

import process from 'node:process'
import { Pool } from 'pg'
import { normalizeCaCert } from './ca-cert'
import {
	DB_SESSION_OPTIONS,
	isEuSovereignDbHost,
	isInClusterDbHost,
	isRelaxedDbEnv,
} from './client'
import { buildMigrationCredentials } from './migrate-credentials'
import { assessMigrateSafety, type DbShape } from './migrate-preflight'

const JOURNAL = 'drizzle.__drizzle_migrations'

/** `count(*)` arrives as a string; unparseable becomes NaN and fails closed downstream. */
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

	// Count every non-system schema, not just `public`; `drizzle` holds the journal itself.
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

/** Log-only witness that the UTC pin took effect; never part of the verdict. */
async function readSessionTimeZone(pool: Pool): Promise<string> {
	try {
		const result = await pool.query<{ tz: string }>("select current_setting('TimeZone') as tz")
		return result.rows[0]?.tz ?? 'unknown'
	} catch {
		return 'unknown'
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

	if (!isRelaxedDbEnv(nodeEnv)) {
		if (!isEuSovereignDbHost(host)) {
			console.error(
				`[migrate-preflight] Refusing to migrate: "${host}" is not a DanubeData EU host (CLOUD Act immunity). Expected e.g. *.danubedata.ro.`
			)
			return 1
		}

		// `buildMigrationCredentials` enforces this too; checking here gives a readable message.
		if (!isInClusterDbHost(host)) {
			console.error(
				`[migrate-preflight] Refusing to migrate over the public endpoint "${host}". Migrations run in-cluster only, over internal DNS (the public-DNS exception is retired).`
			)
			return 1
		}
	}

	// Decomposed credentials, never `connectionString`: a `?sslmode=` would override `ssl` and
	// drop the CA.
	const pool = new Pool({
		...buildMigrationCredentials(
			nodeEnv,
			databaseUrl,
			normalizeCaCert(process.env['DATABASE_CA_CERT'])
		),
		options: DB_SESSION_OPTIONS,
		max: 1,
		connectionTimeoutMillis: 10_000,
		// A probe blocked on another session's lock would hang, and later deploys queue behind it.
		statement_timeout: 15_000,
		query_timeout: 15_000,
	})

	try {
		const shape = await probe(pool)
		const verdict = assessMigrateSafety(shape)
		const timezone = await readSessionTimeZone(pool)

		console.log(
			`[migrate-preflight] host=${host} journalTable=${shape.hasJournalTable} ` +
				`journalRows=${shape.journalRowCount} publicTables=${shape.userTableCount} ` +
				`timezone=${timezone} -> ${verdict.provenance}`
		)

		if (!verdict.safe) {
			console.error(`[migrate-preflight] ABORTING DEPLOY: ${verdict.reason}`)
			return 1
		}

		console.log(`[migrate-preflight] OK: ${verdict.reason}`)
		return 0
	} catch (error) {
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
