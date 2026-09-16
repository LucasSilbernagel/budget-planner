/**
 * Serialise production migrations across concurrent pods (Story 5.18, live finding 2026-09-16).
 *
 * ⚠️ THIS EXISTS BECAUSE IT HAPPENED, not because it might.
 *
 * Run `35042874267-1` started **two** Knative revisions of the migrate container
 * (`budget-planner-migrate-00001` and `-00003`), both carrying the same run id and
 * the same credentials. Both passed the preflight and both executed
 * `drizzle-kit migrate` against the production database, milliseconds apart. It
 * was harmless only because there were no unapplied migrations that day: the
 * journal already held 17 rows and both appliers had nothing to write.
 *
 * The lesson is not "stop the second pod" — Knative starts pods for its own
 * reasons (`min-scale 0` does not mean "nothing boots", as that run proved), and
 * a pipeline cannot reliably prevent it. The lesson is that **correctness must
 * not depend on how many pods run.** So the critical section is guarded in the
 * one place every pod necessarily shares: the database itself.
 *
 * `pg_advisory_lock` is a session-level lock. It is held for exactly as long as
 * the connection that took it lives, and PostgreSQL releases it automatically if
 * that connection dies — which is the property that matters when the holder is a
 * container that may be killed mid-migration. A row-in-a-table mutex would need
 * its own crash recovery; this needs none.
 */

/**
 * The advisory lock key. Arbitrary but FIXED — every migrating process must pick
 * the same number or the lock guards nothing.
 *
 * Chosen from the ASCII of "bpmigrat" folded into the signed 64-bit range that
 * `pg_advisory_lock(bigint)` accepts. Do not change it: a change silently
 * partitions old and new deployments into two locks that do not exclude
 * each other, which is indistinguishable from having no lock at all.
 */
export const MIGRATION_LOCK_KEY = 8_014_930_517_264_331n

/** How long to wait for another pod's migration before giving up. */
export const LOCK_WAIT_TIMEOUT_MS = 300_000

export type LockOutcome =
  | { acquired: true }
  | { acquired: false; reason: 'timeout' | 'error'; detail: string }

interface LockClient {
  query(sql: string, values?: unknown[]): Promise<unknown>
}

/**
 * Take the migration lock, waiting if another pod holds it.
 *
 * Deliberately BLOCKING rather than `pg_try_advisory_lock`. A pod that simply
 * skipped would have to report something, and neither answer is safe: reporting
 * `succeeded` would let the release proceed on a pod that did nothing, and
 * reporting `failed` would fail a release whose migration is being applied
 * correctly by the other pod. Waiting sidesteps the dilemma — the follower
 * proceeds once the leader is done, re-runs the preflight, finds the journal
 * already current, and applies nothing. `drizzle-kit migrate` is journal-driven,
 * so that second pass is a genuine no-op and its success is not a lie.
 *
 * `lock_timeout` bounds the wait so a stuck holder cannot hang the release past
 * the pipeline's own deadline.
 */
export async function acquireMigrationLock(
  client: LockClient,
  timeoutMs: number = LOCK_WAIT_TIMEOUT_MS
): Promise<LockOutcome> {
  try {
    // Applies to the lock acquisition below; PostgreSQL raises 55P03
    // (lock_not_available) rather than waiting forever.
    await client.query(`set lock_timeout = ${Number(timeoutMs)}`)
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY.toString()])
    return { acquired: true }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    // 55P03 is specifically "another session holds it and we waited long enough",
    // which is a different operational story from "the database refused us".
    const code = (error as { code?: string } | null)?.code
    return { acquired: false, reason: code === '55P03' ? 'timeout' : 'error', detail }
  }
}
