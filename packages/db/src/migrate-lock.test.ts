/**
 * Tests for the migration advisory lock (Story 5.18, live finding 2026-09-16).
 *
 * Written against a real incident, not a hypothetical: run 35042874267-1 started
 * two Knative revisions of the migrate container and BOTH ran the preflight and
 * `drizzle-kit migrate` against the production database. These pin the behaviour
 * that makes a second pod harmless.
 */

import { describe, expect, it, vi } from 'vitest'
import { LOCK_WAIT_TIMEOUT_MS, MIGRATION_LOCK_KEY, acquireMigrationLock } from './migrate-lock'

function clientThat(impl: (sql: string, values?: unknown[]) => Promise<unknown>) {
  return { query: vi.fn(impl) }
}

describe('MIGRATION_LOCK_KEY', () => {
  // A changed key does not fail loudly — it creates a SECOND lock that excludes
  // nobody, which looks exactly like working code. Pin the value.
  it('is a fixed key inside the signed 64-bit range pg_advisory_lock accepts', () => {
    expect(MIGRATION_LOCK_KEY).toBe(8_014_930_517_264_331n)
    expect(MIGRATION_LOCK_KEY).toBeLessThan(2n ** 63n - 1n)
    expect(MIGRATION_LOCK_KEY).toBeGreaterThan(-(2n ** 63n))
  })
})

describe('acquireMigrationLock', () => {
  it('sets a bounded lock_timeout before waiting, so a stuck holder cannot hang the release', async () => {
    const client = clientThat(async () => ({}))

    await acquireMigrationLock(client, 1234)

    const sqls = client.query.mock.calls.map((c) => String(c[0]))
    expect(sqls[0]).toMatch(/set lock_timeout = 1234/)
    // Order matters: a timeout set AFTER the lock request would not bound it.
    expect(sqls[1]).toMatch(/pg_advisory_lock/)
  })

  it('uses the blocking lock, not the try- variant', async () => {
    const client = clientThat(async () => ({}))

    await acquireMigrationLock(client)

    const sqls = client.query.mock.calls.map((c) => String(c[0])).join(' ')
    // `pg_try_advisory_lock` would make a second pod skip, and a pod that skipped
    // could report neither success nor failure honestly. Waiting is the point.
    expect(sqls).not.toMatch(/pg_try_advisory_lock/)
    expect(sqls).toMatch(/select pg_advisory_lock\(\$1\)/)
  })

  it('passes the key as a parameter rather than interpolating it', async () => {
    const client = clientThat(async () => ({}))

    await acquireMigrationLock(client)

    const lockCall = client.query.mock.calls.find((c) => String(c[0]).includes('pg_advisory_lock'))
    expect(lockCall?.[1]).toEqual([MIGRATION_LOCK_KEY.toString()])
  })

  it('reports success when the lock is taken', async () => {
    const client = clientThat(async () => ({}))

    await expect(acquireMigrationLock(client)).resolves.toEqual({ acquired: true })
  })

  // 55P03 is "another session holds it and we waited long enough" — a different
  // operational story from "the database refused us", and worth distinguishing
  // in the logs when someone is working out why a release stalled.
  it('classifies a lock_timeout as a timeout, not a generic error', async () => {
    const timeout = Object.assign(new Error('canceling statement due to lock timeout'), {
      code: '55P03',
    })
    const client = clientThat(async (sql) => {
      if (sql.includes('pg_advisory_lock')) throw timeout
      return {}
    })

    await expect(acquireMigrationLock(client)).resolves.toMatchObject({
      acquired: false,
      reason: 'timeout',
    })
  })

  it('classifies any other failure as an error, and never as acquired', async () => {
    const client = clientThat(async () => {
      throw new Error('connection terminated unexpectedly')
    })

    const outcome = await acquireMigrationLock(client)

    expect(outcome).toMatchObject({ acquired: false, reason: 'error' })
    expect(outcome.acquired).toBe(false)
  })

  // Fail-closed: anything thrown must become `acquired: false`, never an
  // exception that a caller might catch and treat as "carry on".
  it('never throws, whatever the client does', async () => {
    const client = { query: vi.fn().mockRejectedValue('a string, not an Error') }

    await expect(acquireMigrationLock(client)).resolves.toMatchObject({ acquired: false })
  })

  it('defaults to a five-minute wait', () => {
    expect(LOCK_WAIT_TIMEOUT_MS).toBe(300_000)
  })
})
