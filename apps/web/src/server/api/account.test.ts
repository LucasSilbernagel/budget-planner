import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
	transaction,
	txDelete,
	whereCalls,
	getCurrentUserSession,
	getPaddleConfig,
	cancelActiveSubscriptionsForCustomer,
} = vi.hoisted(() => {
	const whereCalls: Array<{ table: unknown; arg: unknown }> = []
	const txDelete = vi.fn((table: unknown) => ({
		where: vi.fn((arg: unknown) => {
			whereCalls.push({ table, arg })
			return Promise.resolve(undefined)
		}),
	}))
	// Recorded in the same call log as the deletes so the lock-first order is assertable.
	const txExecute = vi.fn((query: unknown) => {
		whereCalls.push({ table: 'LOCK users', arg: query })
		return Promise.resolve(undefined)
	})
	const transaction = vi.fn(
		async (cb: (tx: { delete: typeof txDelete; execute: typeof txExecute }) => Promise<void>) =>
			cb({ delete: txDelete, execute: txExecute })
	)
	return {
		transaction,
		txDelete,
		whereCalls,
		getCurrentUserSession: vi.fn(),
		getPaddleConfig: vi.fn(() => ({ isConfigured: false })),
		cancelActiveSubscriptionsForCustomer: vi.fn().mockResolvedValue(undefined),
	}
})

vi.mock('@budget-planner/db', () => ({ db: { transaction } }))
// Preserve real drizzle exports (schema.ts needs `sql` at module load); only
// override `eq` so each WHERE clause target is an inspectable { col, val }.
vi.mock('drizzle-orm', async (importOriginal) => {
	const actual = await importOriginal<typeof import('drizzle-orm')>()
	return {
		...actual,
		eq: (col: unknown, val: unknown) => ({ col, val }),
		and: (...conds: unknown[]) => ({ and: conds }),
	}
})
vi.mock('./auth/paddle', () => ({ getCurrentUserSession }))
vi.mock('@budget-planner/config', () => ({ getPaddleConfig }))
vi.mock('../paddle/subscription-api', () => ({ cancelActiveSubscriptionsForCustomer }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }))

import {
	balanceTracking,
	categories,
	expenses,
	forecastingProfiles,
	incomeSources,
	loginTokens,
	rateLimits,
	retirementPlans,
	savingsGoals,
	userProfiles,
	users,
} from '@budget-planner/db/src/schema'
import { deleteUserAccount } from './account'

// `categories` is both a parent and a child here: earlier breaks the cashflow FKs, later its own.
const EXPECTED_ORDER = [
	forecastingProfiles,
	incomeSources,
	expenses,
	categories,
	savingsGoals,
	balanceTracking,
	retirementPlans,
	loginTokens,
	rateLimits,
	rateLimits,
	userProfiles,
	users,
]

// Mixed case + padding: only an un-normalized address shows the delete keys on normalizeEmail.
const SESSION_EMAIL = '  A@Test.Dev '

const authedSession = (userId: string, paddleId = 'pdl_1') => ({
	success: true,
	data: { userId, email: SESSION_EMAIL, paddleId, subscriptionStatus: 'active', currency: 'EUR' },
})

const req = (body?: unknown) =>
	new Request('https://app.test/api/account/delete', {
		method: 'POST',
		body: body ? JSON.stringify(body) : undefined,
	})

beforeEach(() => {
	vi.clearAllMocks()
	whereCalls.length = 0
	getPaddleConfig.mockReturnValue({ isConfigured: false })
})

describe('deleteUserAccount', () => {
	it('hard-deletes all owned rows in FK-safe order inside one transaction', async () => {
		getCurrentUserSession.mockResolvedValue(authedSession('user-A'))

		const result = await deleteUserAccount(req())

		expect(result).toEqual({ success: true })
		expect(transaction).toHaveBeenCalledTimes(1)
		expect(txDelete).toHaveBeenCalledTimes(EXPECTED_ORDER.length)
		expect(whereCalls.map((c) => c.table)).toEqual(['LOCK users', ...EXPECTED_ORDER])
	})

	it('deletes the email-scoped throttle by the NORMALIZED session address', async () => {
		getCurrentUserSession.mockResolvedValue(authedSession('user-A'))

		await deleteUserAccount(req())

		const [byUser, byEmail] = whereCalls.filter((c) => c.table === rateLimits)
		expect(byUser?.arg).toEqual({ col: rateLimits.userId, val: 'user-A' })
		expect(byEmail?.arg).toEqual({
			and: [
				{ col: rateLimits.scope, val: 'email' },
				{ col: rateLimits.subject, val: 'a@test.dev' },
			],
		})
	})

	it('returns unauthenticated (→401) and deletes nothing when there is no session', async () => {
		getCurrentUserSession.mockResolvedValue({ success: true, data: null })

		const result = await deleteUserAccount(req())

		expect(result).toEqual({ success: false, reason: 'unauthenticated' })
		expect(transaction).not.toHaveBeenCalled()
	})

	it('returns an error (→500) and deletes nothing when the session cannot be resolved', async () => {
		getCurrentUserSession.mockResolvedValue({ success: false, error: 'db down' })

		const result = await deleteUserAccount(req())

		expect(result.success).toBe(false)
		expect(result.reason).toBe('error')
		expect(transaction).not.toHaveBeenCalled()
	})

	it('is idempotent — an already-erased user still reports success', async () => {
		getCurrentUserSession.mockResolvedValue(authedSession('user-A'))
		const result = await deleteUserAccount(req())
		expect(result).toEqual({ success: true })
	})

	it('erases ONLY the session user, never a client-supplied id (ownership)', async () => {
		getCurrentUserSession.mockResolvedValue(authedSession('user-A'))

		await deleteUserAccount(req({ userId: 'user-B', email: 'victim@test.dev' }))

		const usersDelete = whereCalls.find((c) => c.table === users)
		expect(usersDelete?.arg).toEqual({ col: users.id, val: 'user-A' })
		for (const call of whereCalls) {
			if (call.table === 'LOCK users') {
				// A drizzle `sql` template keeps its interpolated values as raw
				// entries of `queryChunks`: the lock must be keyed on user-A too.
				const chunks = (call.arg as { queryChunks: unknown[] }).queryChunks
				expect(chunks).toContain('user-A')
				expect(chunks).not.toContain('user-B')
				continue
			}
			if ('and' in (call.arg as object)) {
				const vals = (call.arg as { and: Array<{ val: unknown }> }).and.map((c) => c.val)
				expect(vals).toEqual(['email', 'a@test.dev'])
				continue
			}
			expect((call.arg as { val: unknown }).val).toBe('user-A')
		}
	})

	it('still succeeds when Paddle is not configured (best-effort cancel never blocks)', async () => {
		getCurrentUserSession.mockResolvedValue(authedSession('user-A'))
		getPaddleConfig.mockReturnValue({ isConfigured: false })

		const result = await deleteUserAccount(req())

		expect(result).toEqual({ success: true })
		expect(transaction).toHaveBeenCalledTimes(1)
		expect(cancelActiveSubscriptionsForCustomer).not.toHaveBeenCalled()
	})

	it('cancels the Paddle subscription for the account customer id when configured', async () => {
		getCurrentUserSession.mockResolvedValue(authedSession('user-A', 'ctm_123'))
		getPaddleConfig.mockReturnValue({ isConfigured: true })

		const result = await deleteUserAccount(req())

		expect(result).toEqual({ success: true })
		expect(cancelActiveSubscriptionsForCustomer).toHaveBeenCalledWith('ctm_123')
		expect(transaction).toHaveBeenCalledTimes(1)
	})

	it('still succeeds and still erases when the Paddle cancel call throws', async () => {
		getCurrentUserSession.mockResolvedValue(authedSession('user-A'))
		getPaddleConfig.mockReturnValue({ isConfigured: true })
		cancelActiveSubscriptionsForCustomer.mockRejectedValueOnce(new Error('paddle down'))

		const result = await deleteUserAccount(req())

		expect(result).toEqual({ success: true })
		expect(transaction).toHaveBeenCalledTimes(1)
	})

	it('still succeeds and still erases when the Paddle cancel step HANGS past its overall deadline (not just an individual request timeout)', async () => {
		// A never-resolving mock proves the outer deadline, not a per-call timeout, unblocks this.
		vi.useFakeTimers()
		try {
			getCurrentUserSession.mockResolvedValue(authedSession('user-A'))
			getPaddleConfig.mockReturnValue({ isConfigured: true })
			cancelActiveSubscriptionsForCustomer.mockReturnValue(new Promise(() => {}))

			const resultPromise = deleteUserAccount(req())
			await vi.advanceTimersByTimeAsync(8000)
			const result = await resultPromise

			expect(result).toEqual({ success: true })
			expect(transaction).toHaveBeenCalledTimes(1)
		} finally {
			vi.useRealTimers()
		}
	})

	it('propagates a transaction failure as an error result (rolled back, not 500-crash)', async () => {
		getCurrentUserSession.mockResolvedValue(authedSession('user-A'))
		transaction.mockRejectedValueOnce(new Error('constraint violation'))

		const result = await deleteUserAccount(req())

		expect(result.success).toBe(false)
		expect(result.reason).toBe('error')
	})
})
