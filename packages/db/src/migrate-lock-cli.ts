/**
 * The locked migration sequence (Story 5.18, live finding 2026-09-16).
 *
 * Single entry point for applying production migrations. It holds a PostgreSQL
 * advisory lock across BOTH steps, so that however many migrate pods Knative
 * decides to start, exactly one is inside the critical section at a time:
 *
 *   acquire lock -> migrate-preflight-cli -> drizzle-kit migrate -> release
 *
 * Why the lock wraps the preflight too, not just the DDL: the preflight's whole
 * job is to classify the database's current shape. If another pod is midway
 * through applying migrations while this one is classifying, the classification
 * describes a state that is already gone. Reading and writing belong in the same
 * critical section.
 *
 * Both steps are SPAWNED rather than imported, so their behaviour is byte-for-byte
 * what it was when they ran as separate pipeline steps — this change moves where
 * they run, not what they do. The lock lives on this process's own connection, so
 * spawning children does not weaken it.
 *
 * Run by `apps/web/migrate-entry.mjs` inside the migrate container. Exits with the
 * first non-zero child status, or 1 if the lock cannot be taken.
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import { normalizeCaCert } from './ca-cert'
import { buildMigrationCredentials } from './migrate-credentials'
import { LOCK_WAIT_TIMEOUT_MS, acquireMigrationLock } from './migrate-lock'

/**
 * Both run from the package root, where `drizzle.config.ts` and `migrations/` live.
 *
 * `import.meta.url`, not `__dirname`: this package is `"type": "module"`, so the
 * CommonJS globals do not exist here and referencing one is a boot-time crash.
 */
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BIN_DIR = path.join(PACKAGE_ROOT, 'node_modules', '.bin')

interface Step {
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
      env: process.env,
    })
    child.on('error', (error) => {
      console.error(`[migrate-lock] could not start ${step.name}: ${error.message}`)
      resolve(1)
    })
    // A step killed by a signal reports a null code. Reading that as anything but
    // a failure would call an OOM-killed migration a success.
    child.on('close', (code) => resolve(code ?? 1))
  })
}

async function main(): Promise<number> {
  const databaseUrl = process.env['DATABASE_URL']
  if (!databaseUrl) {
    console.error('[migrate-lock] DATABASE_URL is not set. Refusing to migrate.')
    return 1
  }

  // Same credentials, same TLS posture, same in-cluster host rule as the
  // migration itself — this connection reaches the same production database and
  // has no business being held to a weaker standard.
  //
  // `buildMigrationCredentials` THROWS on a refused host (a public
  // `*.danubedata.ro` endpoint, a non-EU host, an unparseable URL). Catching it
  // here turns a refusal into a one-line reason instead of a stack trace; the
  // exit status is 1 either way, but only one of those is readable at 2am.
  let client: Client
  try {
    client = new Client({
      ...buildMigrationCredentials(
        process.env['NODE_ENV'],
        databaseUrl,
        normalizeCaCert(process.env['DATABASE_CA_CERT'])
      ),
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
    // Ending the session releases the advisory lock; PostgreSQL would also
    // release it on its own if this process died, which is the property that
    // makes a session lock the right primitive for a killable container.
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
