// Holds an advisory lock across preflight AND migrate, so the classification can't describe a
// state another pod is changing. Steps are spawned; the lock lives on this connection.

import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import { normalizeCaCert } from './ca-cert'
import { DB_SESSION_OPTIONS } from './client'
import { buildMigrationCredentials } from './migrate-credentials'
import { acquireMigrationLock, LOCK_WAIT_TIMEOUT_MS, stepEnv } from './migrate-lock'

/** `import.meta.url`, not `__dirname`: this package is ESM. */
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BIN_DIR = path.join(PACKAGE_ROOT, 'node_modules', '.bin')

type Step = {
	name: string
	bin: string
	args: string[]
}

const STEPS: Step[] = [
	{ name: 'preflight', bin: 'tsx', args: ['src/migrate-preflight-cli.ts'] },
	{ name: 'migrate', bin: 'drizzle-kit', args: ['migrate'] },
]

function runStep(step: Step): Promise<number> {
	console.log(`[migrate-lock] running ${step.name}: ${step.bin} ${step.args.join(' ')}`)
	return new Promise((resolve) => {
		const child = spawn(path.join(BIN_DIR, step.bin), step.args, {
			cwd: PACKAGE_ROOT,
			stdio: 'inherit',
			// PGOPTIONS pins drizzle-kit's own connection to UTC (it strips an `options` key).
			env: stepEnv(process.env),
		})
		child.on('error', (error) => {
			console.error(`[migrate-lock] could not start ${step.name}: ${error.message}`)
			resolve(1)
		})
		// A signal-killed step reports a null code; treat it as a failure.
		child.on('close', (code) => resolve(code ?? 1))
	})
}

async function main(): Promise<number> {
	const databaseUrl = process.env['DATABASE_URL']
	if (!databaseUrl) {
		console.error('[migrate-lock] DATABASE_URL is not set. Refusing to migrate.')
		return 1
	}

	// Catch the refusal so it prints a one-line reason instead of a stack trace.
	let client: Client
	try {
		client = new Client({
			...buildMigrationCredentials(
				process.env['NODE_ENV'],
				databaseUrl,
				normalizeCaCert(process.env['DATABASE_CA_CERT'])
			),
			options: DB_SESSION_OPTIONS,
			connectionTimeoutMillis: 15_000,
		})
	} catch (error) {
		console.error(
			`[migrate-lock] refusing to migrate: ${
				error instanceof Error ? error.message : String(error)
			}`
		)
		return 1
	}

	try {
		await client.connect()
	} catch (error) {
		console.error(
			'[migrate-lock] could not connect to take the migration lock; refusing to migrate.',
			error instanceof Error ? error.message : error
		)
		return 1
	}

	try {
		console.log('[migrate-lock] acquiring the migration advisory lock…')
		const lock = await acquireMigrationLock(client, LOCK_WAIT_TIMEOUT_MS)

		if (!lock.acquired) {
			console.error(
				`[migrate-lock] did not get the migration lock (${lock.reason}): ${lock.detail}`
			)
			console.error(
				'[migrate-lock] another migrate pod is holding it. Refusing to migrate concurrently.'
			)
			return 1
		}

		console.log('[migrate-lock] lock held. This pod is the migrator.')

		for (const step of STEPS) {
			const code = await runStep(step)
			if (code !== 0) {
				console.error(`[migrate-lock] ${step.name} exited with code ${code}; aborting.`)
				return code
			}
		}

		console.log('[migrate-lock] all steps completed.')
		return 0
	} finally {
		// Ending the session releases the lock; PostgreSQL also releases it if this process dies.
		await client.end().catch(() => undefined)
	}
}

main().then(
	(code) => {
		process.exitCode = code
	},
	(error: unknown) => {
		console.error('[migrate-lock] unexpected failure; refusing to migrate.', error)
		process.exitCode = 1
	}
)
