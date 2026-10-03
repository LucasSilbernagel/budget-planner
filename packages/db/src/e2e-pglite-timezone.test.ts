/**
 * Story ops-2, AC-4 (decision D3): the e2e PGlite database behind `chromium-db`
 * runs in UTC whatever the host's zone is.
 *
 * PGlite inherits the host zone as a FIXED standard offset (EDT became
 * `Etc/GMT+5`, MEASURED while drafting), so a `DEFAULT now()` row was ~5 h off
 * an app-written `toISOString()` row on a dev box (87.2's "~5 h createdAt shift").
 *
 * This spawns the REAL `apps/web/e2e/helpers/pglite-server.mjs` with
 * `TZ=America/New_York` FORCED on the child, so it is RED without the pin on
 * every host, CI's UTC runners included. America/New_York is -4 or -5, never 0,
 * so the semantic check cannot sit on a zero-offset boundary.
 *
 * Lives in packages/db (not apps/web) because `pg` is a dependency here only.
 */
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
    // The seed ran seconds ago; a 4-5 h zone shift is far outside this window.
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
    // The harness has no drizzle journal, so the verdict is a refusal; only the
    // log line matters here, and the verdict is unaffected by the new field.
    expect(out).toMatch(/\[migrate-preflight\] host=127\.0\.0\.1 .* timezone=UTC -> /)
  }, 30_000)
})
