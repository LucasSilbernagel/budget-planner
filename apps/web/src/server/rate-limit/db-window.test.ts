import { beforeEach, describe, expect, it, vi } from 'vitest'

type Mode = 'fixed' | 'atomic' | 'throw' | 'empty'
type ExecuteMode = 'ok' | 'reject' | 'throwSync' | 'pending'

const state = vi.hoisted(() => ({
	mode: 'fixed' as Mode,
	executeMode: 'ok' as ExecuteMode,
	fixedCount: 1,
	serverCount: 0,
	captured: {
		values: undefined as Record<string, unknown> | undefined,
		conflictTarget: undefined as unknown,
		returning: undefined as Record<string, unknown> | undefined,
		executed: [] as unknown[],
	},
}))

vi.mock('@budget-planner/db', () => {
	// Column sentinels — identity is enough to assert the conflict target.
	const rateLimits = {
		scope: 'col:scope',
		subject: 'col:subject',
		windowStart: 'col:windowStart',
		requestCount: 'col:requestCount',
		// Present so the "no userId term" assertion is not vacuous.
		userId: 'col:userId',
	}
	const db = {
		insert: vi.fn(() => ({
			values: vi.fn((v: Record<string, unknown>) => {
				state.captured.values = v
				return {
					onConflictDoUpdate: vi.fn((c: { target: unknown }) => {
						state.captured.conflictTarget = c.target
						return {
							returning: vi.fn((r: Record<string, unknown>) => {
								state.captured.returning = r
								if (state.mode === 'throw') return Promise.reject(new Error('db down'))
								if (state.mode === 'empty') return Promise.resolve([])
								const count = state.mode === 'atomic' ? ++state.serverCount : state.fixedCount
								return Promise.resolve([{ count }])
							}),
						}
					}),
				}
			}),
		})),
		execute: vi.fn((query: unknown) => {
			state.captured.executed.push(query)
			if (state.executeMode === 'throwSync') throw new Error('sweep exploded synchronously')
			if (state.executeMode === 'reject') return Promise.reject(new Error('sweep failed'))
			// Never settles — used to prove the decision does not await the sweep.
			if (state.executeMode === 'pending') return new Promise(() => {})
			return Promise.resolve(undefined)
		}),
	}
	return { db, rateLimits }
})

vi.mock('@/lib/logger', () => ({
	logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))
vi.mock('@/server/retention/backstop', () => ({ maybeRunRetentionBackstop: vi.fn() }))

import { logger } from '@/lib/logger'
import { maybeRunRetentionBackstop } from '@/server/retention/backstop'
import { __resetReapGateForTests, checkDbRateLimit } from './db-window'

beforeEach(() => {
	vi.clearAllMocks()
	state.mode = 'fixed'
	state.fixedCount = 1
	state.serverCount = 0
	state.executeMode = 'ok'
	state.captured = {
		values: undefined,
		conflictTarget: undefined,
		returning: undefined,
		executed: [],
	}
	// The sweep is gated to once per interval per process; without this the first
	// test to trip it would silence every later one.
	__resetReapGateForTests()
})

/** Flatten a drizzle SQL into text + params; queryChunks interleaves StringChunks with raw values. */
function renderSql(query: unknown): { text: string; params: unknown[] } {
	const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? []
	let text = ''
	const params: unknown[] = []
	for (const chunk of chunks) {
		const value = (chunk as { value?: unknown } | null)?.value
		if (Array.isArray(value)) {
			text += value.join('')
		} else {
			params.push(chunk)
			text += ` $${params.length} `
		}
	}
	return { text: text.replace(/\s+/g, ' ').trim(), params }
}

describe('checkDbRateLimit — atomic upsert shape', () => {
	it('writes the row keyed by scope/subject and floors windowStart to the bucket boundary', async () => {
		const windowMs = 60_000
		const now = 1_700_000_123_456 // arbitrary; not a bucket boundary
		await checkDbRateLimit({ scope: 'ip', subject: '203.0.113.5', windowMs, maxAttempts: 5, now })

		const v = state.captured.values
		expect(v?.scope).toBe('ip')
		expect(v?.subject).toBe('203.0.113.5')
		// Floored to the enclosing window, NOT `now`.
		expect((v?.windowStart as Date).getTime()).toBe(Math.floor(now / windowMs) * windowMs)
		expect(v?.requestCount).toBe(1)
	})

	it('uses (scope, subject, windowStart) as the ON CONFLICT target and returns the count', async () => {
		await checkDbRateLimit({ scope: 'sync', subject: 'u1', windowMs: 60_000, maxAttempts: 100 })
		expect(state.captured.conflictTarget).toEqual(['col:scope', 'col:subject', 'col:windowStart'])
		expect(state.captured.returning).toEqual({ count: 'col:requestCount' })
	})

	it('leaves userId NULL for IP/email buckets but sets it for the sync scope (erasure/FK)', async () => {
		await checkDbRateLimit({ scope: 'email', subject: 'a@b.com', windowMs: 60_000, maxAttempts: 5 })
		expect(state.captured.values?.userId).toBeNull()

		await checkDbRateLimit({
			scope: 'sync',
			subject: 'u9',
			userId: 'u9',
			windowMs: 60_000,
			maxAttempts: 100,
		})
		expect(state.captured.values?.userId).toBe('u9')
	})
})

describe('checkDbRateLimit — decision boundary on the returned count', () => {
	it('allows while count <= maxAttempts and rejects the (max+1)th', async () => {
		state.fixedCount = 5
		expect(
			await checkDbRateLimit({ scope: 'ip', subject: 'x', windowMs: 60_000, maxAttempts: 5 })
		).toEqual({
			allowed: true,
			remaining: 0,
		})

		state.fixedCount = 6
		expect(
			await checkDbRateLimit({ scope: 'ip', subject: 'x', windowMs: 60_000, maxAttempts: 5 })
		).toEqual({
			allowed: false,
			remaining: 0,
		})
	})

	it('reports remaining from the atomic total', async () => {
		state.fixedCount = 2
		const r = await checkDbRateLimit({
			scope: 'ip',
			subject: 'x',
			windowMs: 60_000,
			maxAttempts: 5,
		})
		expect(r).toEqual({ allowed: true, remaining: 3 })
	})

	it('under a serialised atomic counter, exactly maxAttempts of N concurrent requests pass', async () => {
		// Simulates Postgres serialising the conflicting upserts: each call gets a
		// unique incremented total.
		state.mode = 'atomic'
		const maxAttempts = 5
		const results = await Promise.all(
			Array.from({ length: 8 }, () =>
				checkDbRateLimit({ scope: 'login-verify', subject: 'ip', windowMs: 60_000, maxAttempts })
			)
		)
		expect(results.filter((r) => r.allowed).length).toBe(maxAttempts)
		expect(results.filter((r) => !r.allowed).length).toBe(3)
	})
})

describe('checkDbRateLimit — scope isolation', () => {
	it('two scopes with the same subject write distinct buckets (no cross-scope collision)', async () => {
		await checkDbRateLimit({ scope: 'ip', subject: 'same', windowMs: 60_000, maxAttempts: 5 })
		const ipScope = state.captured.values?.scope
		await checkDbRateLimit({
			scope: 'sync',
			subject: 'same',
			userId: 'same',
			windowMs: 60_000,
			maxAttempts: 100,
		})
		const syncScope = state.captured.values?.scope
		expect(ipScope).toBe('ip')
		expect(syncScope).toBe('sync')
		expect(ipScope).not.toBe(syncScope)
	})
})

describe('checkDbRateLimit — DB-error degrade', () => {
	it('fails CLOSED (deny, degraded) when the DB throws and no fallback is given', async () => {
		state.mode = 'throw'
		const r = await checkDbRateLimit({
			scope: 'ip',
			subject: 'x',
			windowMs: 60_000,
			maxAttempts: 5,
		})
		expect(r).toEqual({ allowed: false, remaining: 0, degraded: true })
	})

	it('fails CLOSED (deny, degraded) when the upsert returns no row — never a fresh budget', async () => {
		state.mode = 'empty'
		const r = await checkDbRateLimit({
			scope: 'login-verify',
			subject: 'x',
			windowMs: 60_000,
			maxAttempts: 5,
		})
		expect(r).toEqual({ allowed: false, remaining: 0, degraded: true })
	})

	it('routes an empty-row result through the fallback when one is provided', async () => {
		state.mode = 'empty'
		const onDbError = vi.fn(() => ({ allowed: true, remaining: 7 }))
		const r = await checkDbRateLimit({
			scope: 'sync',
			subject: 'u1',
			userId: 'u1',
			windowMs: 60_000,
			maxAttempts: 100,
			onDbError,
		})
		expect(onDbError).toHaveBeenCalledOnce()
		expect(r).toEqual({ allowed: true, remaining: 7, degraded: true })
	})

	it('uses the provided fallback (flagged degraded) when the DB throws', async () => {
		state.mode = 'throw'
		const onDbError = vi.fn(() => ({ allowed: true, remaining: 42 }))
		const r = await checkDbRateLimit({
			scope: 'sync',
			subject: 'u1',
			userId: 'u1',
			windowMs: 60_000,
			maxAttempts: 100,
			onDbError,
		})
		expect(onDbError).toHaveBeenCalledOnce()
		expect(r).toEqual({ allowed: true, remaining: 42, degraded: true })
	})
})

describe('expired-window reaper', () => {
	const ONE_HOUR_MS = 60 * 60 * 1000
	const LONGEST_CONFIGURED_WINDOW_MS = 15 * 60 * 1000 // EMAIL_LIMIT
	const call = (now: number) =>
		checkDbRateLimit({ scope: 'ip', subject: '203.0.113.5', windowMs: 60_000, maxAttempts: 5, now })

	it('sweeps on the success path, with a cutoff OLDER than the longest window', async () => {
		const now = 1_800_000_000_000
		await call(now)

		expect(state.captured.executed).toHaveLength(1)
		const { params } = renderSql(state.captured.executed[0])

		// Must reach the driver as a UTC string: a raw Date is serialized as local time,
		// and the timestamp-without-tz column drops the offset.
		const cutoff = params.find((p): p is string => typeof p === 'string' && p.endsWith('Z'))
		expect(cutoff, 'cutoff must be an ISO-8601 UTC string, not a Date').toBeDefined()
		expect(new Date(cutoff as string).getTime()).toBe(now - ONE_HOUR_MS)
		expect(params.some((p) => p instanceof Date)).toBe(false)

		// A cutoff inside the longest window would delete live buckets. The real guard is
		// the runtime check in checkDbRateLimit; this constant is a copy.
		expect(now - new Date(cutoff as string).getTime()).toBeGreaterThan(LONGEST_CONFIGURED_WINDOW_MS)
	})

	it('compares with a STRICT < so a row exactly AT the cutoff survives (boundary)', async () => {
		await call(1_800_000_000_000)
		const { text } = renderSql(state.captured.executed[0])
		// `<` errs toward keeping a boundary row one sweep longer, the safe direction.
		expect(text).toContain('<')
		expect(text).not.toContain('<=')
	})

	it('carries NO userId term, so it cannot race account erasure on that predicate', async () => {
		await call(1_800_000_000_000)
		const { params } = renderSql(state.captured.executed[0])

		// Assert on params, not text: interpolated columns render as `$n`, so a column
		// name never appears in the text.
		expect(params).toContain('col:windowStart')
		expect(params).not.toContain('col:userId')
	})

	it('uses FOR UPDATE SKIP LOCKED so it can never deadlock with erasure', async () => {
		await call(1_800_000_000_000)
		const { text } = renderSql(state.captured.executed[0])
		// SKIP LOCKED is load-bearing: sync rows have both userId and windowStart, so the
		// reaper overlaps erasure's delete and could otherwise deadlock it.
		expect(text).toContain('FOR UPDATE SKIP LOCKED')
	})

	it('sweeps at most ONCE per interval however many requests arrive', async () => {
		const now = 1_800_000_000_000
		for (let i = 0; i < 25; i += 1) {
			await call(now + i * 1000)
		}
		expect(state.captured.executed).toHaveLength(1)

		await call(now + 15 * 60 * 1000 + 1)
		expect(state.captured.executed).toHaveLength(2)
	})

	it('a REJECTED sweep does not fail the rate-limit decision', async () => {
		state.executeMode = 'reject'
		state.fixedCount = 1
		await expect(call(1_800_000_000_000)).resolves.toEqual({ allowed: true, remaining: 4 })
		await Promise.resolve()
		expect(logger.error).toHaveBeenCalledWith(
			'[RateLimit] expired-window sweep failed',
			expect.objectContaining({ error: 'sweep failed' })
		)
	})

	it('a SYNCHRONOUSLY throwing sweep does not fail the decision either', async () => {
		state.executeMode = 'throwSync'
		state.fixedCount = 1
		await expect(call(1_800_000_000_000)).resolves.toEqual({ allowed: true, remaining: 4 })
		expect(logger.error).toHaveBeenCalledWith(
			'[RateLimit] expired-window sweep failed',
			expect.objectContaining({ error: 'sweep exploded synchronously' })
		)
	})

	it('does not AWAIT the sweep — a sweep that never settles does not delay it', async () => {
		state.executeMode = 'pending'
		state.fixedCount = 1
		// If the decision awaited the sweep this would hang and time out.
		await expect(call(1_800_000_000_000)).resolves.toEqual({ allowed: true, remaining: 4 })
	})

	it('does NOT sweep on the DB-error path (no extra statement during an outage)', async () => {
		state.mode = 'throw'
		await checkDbRateLimit({
			scope: 'ip',
			subject: '203.0.113.5',
			windowMs: 60_000,
			maxAttempts: 5,
			now: 1_800_000_000_000,
		})
		expect(state.captured.executed).toHaveLength(0)
	})
})

describe('reaper bounds and invariants', () => {
	const call = (now: number, windowMs = 60_000) =>
		checkDbRateLimit({ scope: 'ip', subject: '203.0.113.5', windowMs, maxAttempts: 5, now })

	it('CAPS the sweep, so a concurrent account erasure cannot be blocked unboundedly', async () => {
		await call(1_800_000_000_000)
		const { text, params } = renderSql(state.captured.executed[0])
		// SKIP LOCKED stops US waiting; it does NOT stop erasure waiting on us.
		// A cap is what bounds how long erasure can be made to queue.
		expect(text).toContain('LIMIT')
		expect(params).toContain(5000)
	})

	it('DISABLES the sweep for a caller whose window is longer than the cutoff', async () => {
		// Otherwise the reaper would delete that caller's live buckets; enforced in code,
		// not by a constant copied into a test.
		await call(1_800_000_000_000, 2 * 60 * 60 * 1000)
		expect(state.captured.executed).toHaveLength(0)
		expect(logger.error).toHaveBeenCalledWith(
			expect.stringContaining('window is longer than the reap cutoff'),
			expect.objectContaining({ windowMs: 2 * 60 * 60 * 1000 })
		)
	})

	it('still sweeps for a caller at the longest window actually configured (15 min)', async () => {
		await call(1_800_000_000_000, 15 * 60 * 1000)
		expect(state.captured.executed).toHaveLength(1)
	})
})

describe('retention backstop wiring', () => {
	const opts = { scope: 'sync' as const, subject: 'u1', windowMs: 60_000, maxAttempts: 5 }

	it('offers the backstop the request clock on the success path', async () => {
		await checkDbRateLimit({ ...opts, now: 1_700_000_000_000 })
		expect(maybeRunRetentionBackstop).toHaveBeenCalledWith(1_700_000_000_000)
	})

	it('does NOT run it on a DB failure — the last thing to add during an outage', async () => {
		state.mode = 'throw'
		await checkDbRateLimit({ ...opts, now: 1_700_000_000_000 })
		expect(maybeRunRetentionBackstop).not.toHaveBeenCalled()
	})
})
