// PGlite inherits the host zone as a fixed offset. TZ is forced to New York on the child so
// this fails without the UTC pin on any host, UTC CI included.
import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const SCRIPT = path.join(REPO_ROOT, 'apps/web/e2e/helpers/pglite-server.mjs')
const SEED_EMAIL = 'ops2-timezone@example.test'

async function freePort(): Promise<number> {
	const server = net.createServer()
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	const address = server.address()
	await new Promise<void>((resolve) => server.close(() => resolve()))
	if (address === null || typeof address === 'string') throw new Error('no port')
	// Never the gate's fixed e2e database port.
	if (address.port === 55432) return freePort()
	return address.port
}

let child: ChildProcess | null = null
let output = ''
let port = 0
let scratch = ''

beforeAll(async () => {
	port = await freePort()
	scratch = mkdtempSync(path.join(tmpdir(), 'ops2-pglite-'))
	child = spawn(process.execPath, [SCRIPT], {
		cwd: path.dirname(SCRIPT),
		env: {
			...process.env,
			TZ: 'America/New_York',
			E2E_DB_PORT: String(port),
			E2E_DB_SEED_EMAIL: SEED_EMAIL,
			E2E_DB_SEED_PADDLE_ID: 'ctm_ops2_timezone',
			E2E_MAIL_OUTBOX: path.join(scratch, 'outbox.jsonl'),
		},
	})
	const proc = child
	await new Promise<void>((resolve, reject) => {
		const onData = (d: Buffer) => {
			output += d
			if (output.includes('listening on')) resolve()
		}
		proc.stdout?.on('data', onData)
		proc.stderr?.on('data', onData)
		proc.on('error', reject)
		proc.on('exit', (code) => reject(new Error(`pglite-server exited ${code}:\n${output}`)))
	})
}, 120_000)

afterAll(async () => {
	if (child && child.exitCode === null) {
		const proc = child
		await new Promise<void>((resolve) => {
			proc.on('exit', () => resolve())
			proc.kill('SIGTERM')
		})
	}
	if (scratch) rmSync(scratch, { recursive: true, force: true })
})

async function query<T>(sql: string): Promise<T[]> {
	const client = new Client({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres' })
	await client.connect()
	try {
		return (await client.query(sql)).rows as T[]
	} finally {
		await client.end()
	}
}

describe('AC-4: the e2e PGlite server runs in UTC under a non-UTC host zone', () => {
	it('reports the zone on its ready line', () => {
		expect(output).toMatch(/TimeZone=UTC\b/)
	})

	it('SHOW TimeZone over the wire is UTC', async () => {
		const rows = await query<{ TimeZone: string }>('SHOW TimeZone')
		expect(rows[0]?.TimeZone).toBe('UTC')
	})

	it('a DEFAULT now() timestamp reads as UTC wall time (the seeded user)', async () => {
		// ::text so the TEST process's own zone cannot re-parse the value.
		const rows = await query<{ created: string }>(
			`SELECT "createdAt"::text AS created FROM "users" WHERE "email" = '${SEED_EMAIL}'`
		)
		const created = rows[0]?.created
		expect(created).toBeTruthy()
		const asUtc = Date.parse(`${created?.replace(' ', 'T')}Z`)
		expect(Math.abs(Date.now() - asUtc)).toBeLessThan(120_000)
	})
})

describe('AC-7(a): the migrate preflight logs the session TimeZone (log-only)', () => {
	it('prints timezone=<value> on its shape line', async () => {
		const packageRoot = path.join(REPO_ROOT, 'packages/db')
		const out = await new Promise<string>((resolve) => {
			const proc = spawn(
				path.join(packageRoot, 'node_modules/.bin/tsx'),
				['src/migrate-preflight-cli.ts'],
				{
					cwd: packageRoot,
					env: {
						...process.env,
						NODE_ENV: 'test',
						DATABASE_URL: `postgresql://u:p@127.0.0.1:${port}/d`,
						DATABASE_CA_CERT: '',
					},
				}
			)
			let text = ''
			proc.stdout.on('data', (d) => {
				text += d
			})
			proc.stderr.on('data', (d) => {
				text += d
			})
			proc.on('close', () => resolve(text))
		})
		// No drizzle journal, so the verdict is a refusal; only the log line matters here.
		expect(out).toMatch(/\[migrate-preflight\] host=127\.0\.0\.1 .* timezone=UTC -> /)
	}, 30_000)
})
