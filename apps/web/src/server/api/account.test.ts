/**
 * Account erasure server-function tests (Story 10-5, AC-1/2/3)
 *
 * Verifies the security- and correctness-critical invariants of
 * `deleteUserAccount`:
 *  - it hard-DELETEs every owned row across all 8 child tables + `users`, in a
 *    single transaction, in FK-safe order (children before parents);
 *  - the target user id comes from the SESSION only — never the request body —
 *    so a caller can only erase their OWN account (ownership);
 *  - no session → an `unauthenticated` result the route maps to 401, and NO
 *    deletion runs;
 *  - a session-resolution failure → an `error` result, and NO deletion runs;
 *  - it is idempotent (already-deleted user still reports success);
 *  - a best-effort Paddle cancel never blocks erasure when Paddle is unconfigured.
 *
 * The Drizzle `db` and Paddle config are mocked so this runs with no database
 * and no external calls (project testing rules). `eq` is mocked to a plain
 * `{ col, val }` sentinel so the WHERE clause target is inspectable.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { transaction, txDelete, whereCalls, getCurrentUserSession, getPaddleConfig } = vi.hoisted(
  () => {
    const whereCalls: Array<{ table: unknown; arg: unknown }> = []
    const txDelete = vi.fn((table: unknown) => ({
      where: vi.fn((arg: unknown) => {
        whereCalls.push({ table, arg })
        return Promise.resolve(undefined)
      }),
    }))
    const transaction = vi.fn(async (cb: (tx: { delete: typeof txDelete }) => Promise<void>) =>
      cb({ delete: txDelete })
    )
    return {
      transaction,
      txDelete,
      whereCalls,
      getCurrentUserSession: vi.fn(),
      getPaddleConfig: vi.fn(() => ({ isConfigured: false })),
    }
  }
)

vi.mock('@budget-planner/db', () => ({ db: { transaction } }))
// Preserve real drizzle exports (schema.ts needs `sql` at module load); only
// override `eq` so each WHERE clause target is an inspectable { col, val }.
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>()
  return { ...actual, eq: (col: unknown, val: unknown) => ({ col, val }) }
})
vi.mock('./auth/paddle', () => ({ getCurrentUserSession }))
vi.mock('@budget-planner/config', () => ({ getPaddleConfig }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }))

import {
  balanceTracking,
  categories,
  expenses,
  forecastingProfiles,
  incomeSources,
  loginTokens,
  rateLimits,
  savingsGoals,
  userProfiles,
  users,
} from '@budget-planner/db/src/schema'
import { deleteUserAccount } from './account'

/**
 * FK-safe deletion order: children before parents, `users` last.
 *
 * ⚠️ `categories` (Story 30.4a) sits after incomeSources/expenses — which
 * reference it via categoryId — and before userProfiles/users, which it
 * references. It is the only entry here with both a parent and a child in this
 * list, so its position is load-bearing in BOTH directions: move it earlier and
 * the cashflow FKs break; move it later and its own FKs do.
 */
const EXPECTED_ORDER = [
  forecastingProfiles,
  incomeSources,
  expenses,
  categories,
  savingsGoals,
  balanceTracking,
  loginTokens,
  rateLimits,
  userProfiles,
  users,
]

const authedSession = (userId: string, paddleId = 'pdl_1') => ({
  success: true,
  data: { userId, email: 'a@test.dev', paddleId, subscriptionStatus: 'active', currency: 'EUR' },
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
    expect(whereCalls.map((c) => c.table)).toEqual(EXPECTED_ORDER)
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
    // tx.delete already resolves affecting zero rows; no throw ⇒ success.
    const result = await deleteUserAccount(req())
    expect(result).toEqual({ success: true })
  })

  it('erases ONLY the session user, never a client-supplied id (ownership)', async () => {
    getCurrentUserSession.mockResolvedValue(authedSession('user-A'))

    // A malicious body naming a different user must be ignored entirely.
    await deleteUserAccount(req({ userId: 'user-B' }))

    const usersDelete = whereCalls.find((c) => c.table === users)
    expect(usersDelete?.arg).toEqual({ col: users.id, val: 'user-A' })
    // Every WHERE clause targets user-A; none references user-B.
    for (const call of whereCalls) {
      expect((call.arg as { val: unknown }).val).toBe('user-A')
    }
  })

  it('still succeeds when Paddle is not configured (best-effort cancel never blocks)', async () => {
    getCurrentUserSession.mockResolvedValue(authedSession('user-A'))
    getPaddleConfig.mockReturnValue({ isConfigured: false })

    const result = await deleteUserAccount(req())

    expect(result).toEqual({ success: true })
    expect(transaction).toHaveBeenCalledTimes(1)
  })

  it('propagates a transaction failure as an error result (rolled back, not 500-crash)', async () => {
    getCurrentUserSession.mockResolvedValue(authedSession('user-A'))
    transaction.mockRejectedValueOnce(new Error('constraint violation'))

    const result = await deleteUserAccount(req())

    expect(result.success).toBe(false)
    expect(result.reason).toBe('error')
  })
})
