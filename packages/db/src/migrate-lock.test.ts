import { describe, expect, it, vi } from 'vitest'
import { acquireMigrationLock, LOCK_WAIT_TIMEOUT_MS, MIGRATION_LOCK_KEY } from './migrate-lock'

function clientThat(impl: (sql: string, values?: unknown[]) => Promise<unknown>) {
	return { query: vi.fn(impl) }
}

describe('MIGRATION_LOCK_KEY', () => {
	// A changed key silently creates a second lock that excludes nobody.
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
		// A timeout set after the lock request would not bound it.
		expect(sqls[1]).toMatch(/pg_advisory_lock/)
	})

	it('uses the blocking lock, not the try- variant', async () => {
		const client = clientThat(async () => ({}))

		await acquireMigrationLock(client)

		const sqls = client.query.mock.calls.map((c) => String(c[0])).join(' ')
		// Blocking, not `pg_try_advisory_lock`: a pod that skipped could not report honestly.
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

	it('never throws, whatever the client does', async () => {
		const client = { query: vi.fn().mockRejectedValue('a string, not an Error') }

		await expect(acquireMigrationLock(client)).resolves.toMatchObject({ acquired: false })
	})

	it('defaults to a five-minute wait', () => {
		expect(LOCK_WAIT_TIMEOUT_MS).toBe(300_000)
	})
})
