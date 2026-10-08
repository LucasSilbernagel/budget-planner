// Knative may start several migrate pods, so the database itself serialises them. A session
// lock is released automatically if the holder dies mid-migration.

import { DB_SESSION_OPTIONS } from './client'

// drizzle-kit strips an `options` key from `dbCredentials`, so the migrate steps get UTC via
// PGOPTIONS. Lives here because importing the CLI runs it.
export function stepEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, PGOPTIONS: DB_SESSION_OPTIONS }
}

/** Never change: a new key splits deployments into two locks that exclude nothing. */
export const MIGRATION_LOCK_KEY = 8_014_930_517_264_331n

export const LOCK_WAIT_TIMEOUT_MS = 300_000

export type LockOutcome =
  | { acquired: true }
  | { acquired: false; reason: 'timeout' | 'error'; detail: string }

interface LockClient {
  query(sql: string, values?: unknown[]): Promise<unknown>
}

// Blocking on purpose: the follower waits, re-runs the preflight, finds the journal current and
// applies nothing. `lock_timeout` bounds the wait.
export async function acquireMigrationLock(
  client: LockClient,
  timeoutMs: number = LOCK_WAIT_TIMEOUT_MS
): Promise<LockOutcome> {
  try {
    await client.query(`set lock_timeout = ${Number(timeoutMs)}`)
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY.toString()])
    return { acquired: true }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    // 55P03: another session holds it and we waited long enough, unlike "the database refused us".
    const code = (error as { code?: string } | null)?.code
    return { acquired: false, reason: code === '55P03' ? 'timeout' : 'error', detail }
  }
}
