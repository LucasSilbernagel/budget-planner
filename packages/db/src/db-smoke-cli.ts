// Not wired into CI by design: it needs a real DATABASE_URL, and missing config is an error
// rather than a skipped green tick.

import process from 'node:process'
import { normalizeCaCert } from './ca-cert'
import { closeDb, testDbConnection } from './client'
import { assessSmokePreconditions } from './db-smoke'

async function main(): Promise<number> {
  const nodeEnv = process.env['NODE_ENV']
  const pre = assessSmokePreconditions(
    nodeEnv,
    process.env['DATABASE_URL'],
    normalizeCaCert(process.env['DATABASE_CA_CERT'])
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
