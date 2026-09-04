/**
 * Live database smoke check (Story 4.17, AC-5).
 *
 *   DATABASE_URL=... NODE_ENV=production \
 *     pnpm --filter @budget-planner/db db:smoke
 *
 * Validates the connection posture (see `db-smoke.ts`), then asserts a real
 * `SELECT 1` through the application's own pool via `testDbConnection()` — so a
 * pass means the app itself can reach the database, not merely that some socket
 * opened.
 *
 * NOT wired into any CI job, by design: it requires a real `DATABASE_URL`, and a
 * smoke that skips itself into a green tick when unconfigured is a false signal.
 * Missing configuration is therefore an ERROR here, and CI never invokes it.
 */

import process from 'node:process'
import { closeDb, testDbConnection } from './client'
import { assessSmokePreconditions } from './db-smoke'

async function main(): Promise<number> {
  const nodeEnv = process.env['NODE_ENV']
  const pre = assessSmokePreconditions(
    nodeEnv,
    process.env['DATABASE_URL'],
    process.env['DATABASE_CA_CERT']
  )

  if (!pre.ok) {
    console.error(`[db-smoke] Refusing to run: ${pre.reason}`)
    return 1
  }

  const tls =
    pre.ssl === false ? 'disabled (relaxed env)' : pre.ssl.ca ? 'verified + CA' : 'verified'
  console.log(`[db-smoke] host=${pre.host} nodeEnv=${nodeEnv ?? '(unset)'} tls=${tls}`)

  try {
    const connected = await testDbConnection()
    if (!connected) {
      console.error('[db-smoke] FAILED: could not execute SELECT 1 against the database.')
      return 1
    }
    console.log('[db-smoke] OK: SELECT 1 succeeded.')
    return 0
  } finally {
    await closeDb().catch(() => undefined)
  }
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    console.error('[db-smoke] Unexpected failure.', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
