// The pin is a startup parameter, so the only honest witness is the StartupMessage: a TCP stub
// records it and hangs up. Assertions are on the capture, never on exit codes.
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { closeDb, DB_SESSION_OPTIONS, testDbConnection } from '../client'
import { stepEnv } from '../migrate-lock'

/** A literal on purpose, not the imported constant. */
const EXPECTED_OPTIONS = '-c TimeZone=UTC'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const BIN_DIR = path.join(PACKAGE_ROOT, 'node_modules', '.bin')

type StartupParams = Record<string, string>

type StartupStub = {
	port: number
	captures: StartupParams[]
	close: () => Promise<void>
}

const SSL_REQUEST_CODE = 80877103
const PROTOCOL_V3 = 196608

function parseStartup(packet: Buffer): StartupParams | null {
	if (packet.readInt32BE(4) !== PROTOCOL_V3) return null
	const params: StartupParams = {}
	const fields = packet.subarray(8).toString('utf8').split('\0')
	for (let i = 0; i + 1 < fields.length; i += 2) {
		const key = fields[i]
		if (!key) break
		params[key] = fields[i + 1] ?? ''
	}
	return params
}

async function startStartupStub(): Promise<StartupStub> {
	const captures: StartupParams[] = []
	const sockets = new Set<net.Socket>()
	const server = net.createServer((socket) => {
		sockets.add(socket)
		socket.on('close', () => sockets.delete(socket))
		socket.on('error', () => undefined)
		let buffered = Buffer.alloc(0)
		socket.on('data', (chunk) => {
			buffered = Buffer.concat([buffered, chunk])
			while (buffered.length >= 8) {
				const length = buffered.readInt32BE(0)
				if (buffered.length < length) return
				const packet = buffered.subarray(0, length)
				buffered = buffered.subarray(length)
				if (length === 8 && packet.readInt32BE(4) === SSL_REQUEST_CODE) {
					socket.write('N')
					continue
				}
				const params = parseStartup(packet)
				if (params) captures.push(params)
				socket.destroy()
				return
			}
		})
	})
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	const address = server.address()
	if (address === null || typeof address === 'string') throw new Error('stub has no port')
	return {
		port: address.port,
		captures,
		close: () =>
			new Promise<void>((resolve) => {
				for (const socket of sockets) socket.destroy()
				server.close(() => resolve())
			}),
	}
}

function runBin(
	bin: string,
	args: string[],
	env: NodeJS.ProcessEnv,
	cwd = PACKAGE_ROOT
): Promise<{ code: number | null; output: string }> {
	return new Promise((resolve) => {
		const child = spawn(path.join(BIN_DIR, bin), args, { cwd, env })
		let output = ''
		child.stdout.on('data', (d) => {
			output += d
		})
		child.stderr.on('data', (d) => {
			output += d
		})
		child.on('close', (code) => resolve({ code, output }))
	})
}

function childEnv(port: number, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...process.env }
	for (const name of ['PGOPTIONS', 'DATABASE_CA_CERT', 'PGHOST', 'PGPORT', 'PGSSLMODE']) {
		Reflect.deleteProperty(env, name)
	}
	return {
		...env,
		NODE_ENV: 'test',
		DATABASE_URL: `postgresql://u:p@127.0.0.1:${port}/d`,
		...extra,
	}
}

/** Assigning `undefined` would store the string "undefined". */
function restoreEnv(name: string, saved: string | undefined): void {
	if (saved === undefined) Reflect.deleteProperty(process.env, name)
	else process.env[name] = saved
}

let stub: StartupStub | null = null

afterEach(async () => {
	await closeDb()
	await stub?.close()
	stub = null
})

describe('DB_SESSION_OPTIONS', () => {
	it('is the one UTC startup option', () => {
		expect(DB_SESSION_OPTIONS).toBe(EXPECTED_OPTIONS)
	})
})

describe('the app pool sends TimeZone=UTC on every connection', () => {
	it('getPool() (via testDbConnection) puts the option in the StartupMessage', async () => {
		stub = await startStartupStub()
		const savedUrl = process.env['DATABASE_URL']
		const savedEnv = process.env['NODE_ENV']
		const savedCa = process.env['DATABASE_CA_CERT']
		// An ambient PGOPTIONS would make this pass with the pin removed.
		const savedPgOptions = process.env['PGOPTIONS']
		process.env['DATABASE_URL'] = `postgresql://u:p@127.0.0.1:${stub.port}/d`
		process.env['NODE_ENV'] = 'test'
		Reflect.deleteProperty(process.env, 'DATABASE_CA_CERT')
		Reflect.deleteProperty(process.env, 'PGOPTIONS')
		vi.spyOn(console, 'error').mockImplementation(() => undefined)
		try {
			await closeDb()
			await testDbConnection()
		} finally {
			restoreEnv('DATABASE_URL', savedUrl)
			restoreEnv('NODE_ENV', savedEnv)
			restoreEnv('DATABASE_CA_CERT', savedCa)
			restoreEnv('PGOPTIONS', savedPgOptions)
		}

		expect(stub.captures.length).toBeGreaterThanOrEqual(1)
		expect(stub.captures[0]).toMatchObject({ user: 'u', database: 'd' })
		expect(stub.captures[0]?.['options']).toBe(EXPECTED_OPTIONS)
	})
})

describe('the migrator CLIs send it too', () => {
	for (const cli of ['src/migrate-preflight-cli.ts', 'src/migrate-lock-cli.ts']) {
		it(`${cli} puts the option in the StartupMessage`, async () => {
			stub = await startStartupStub()
			const { output } = await runBin('tsx', [cli], childEnv(stub.port))

			expect(stub.captures.length, output).toBeGreaterThanOrEqual(1)
			expect(stub.captures[0]).toMatchObject({ user: 'u', database: 'd' })
			expect(stub.captures[0]?.['options']).toBe(EXPECTED_OPTIONS)
		}, 30_000)
	}
})

describe('stepEnv pins PGOPTIONS for the spawned steps (drizzle-kit = C4)', () => {
	it('sets PGOPTIONS exactly and keeps the rest of the environment', () => {
		const parent: NodeJS.ProcessEnv = {
			DATABASE_URL: 'postgresql://u:p@budget-planner-prod-rw:5432/d',
			DATABASE_CA_CERT: '-----BEGIN CERTIFICATE-----x',
			NODE_ENV: 'production',
			PATH: '/usr/bin',
			PGOPTIONS: '-c TimeZone=Europe/Berlin',
		}
		const env = stepEnv(parent)
		expect(env['PGOPTIONS']).toBe(EXPECTED_OPTIONS)
		expect(env).toEqual({ ...parent, PGOPTIONS: EXPECTED_OPTIONS })
		expect(parent['PGOPTIONS']).toBe('-c TimeZone=Europe/Berlin')
	})
})

describe('library-behaviour pin for drizzle-kit migrate', () => {
	// drizzle-kit strips an `options` key, and pg falls back to PGOPTIONS only without one. The
	// config carries a different value, so either change shows up in the capture.
	it('PGOPTIONS reaches the wire; an `options` key in dbCredentials does not', async () => {
		stub = await startStartupStub()
		const dir = mkdtempSync(path.join(tmpdir(), 'ops2-drizzle-kit-'))
		try {
			const out = path.join(dir, 'migrations')
			mkdirSync(path.join(out, 'meta'), { recursive: true })
			writeFileSync(
				path.join(out, 'meta', '_journal.json'),
				JSON.stringify({ version: '7', dialect: 'postgresql', entries: [] })
			)
			const config = path.join(dir, 'drizzle.config.json')
			writeFileSync(
				config,
				JSON.stringify({
					dialect: 'postgresql',
					schema: './schema.ts',
					out,
					dbCredentials: {
						host: '127.0.0.1',
						port: stub.port,
						user: 'u',
						password: 'p',
						database: 'd',
						ssl: false,
						options: '-c TimeZone=Europe/Berlin',
					},
				})
			)
			const { output } = await runBin(
				'drizzle-kit',
				['migrate', `--config=${config}`],
				childEnv(stub.port, { PGOPTIONS: EXPECTED_OPTIONS })
			)

			expect(stub.captures.length, output).toBeGreaterThanOrEqual(1)
			expect(stub.captures[0]).toMatchObject({ user: 'u', database: 'd' })
			expect(stub.captures[0]?.['options']).toBe(EXPECTED_OPTIONS)
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	}, 60_000)
})
