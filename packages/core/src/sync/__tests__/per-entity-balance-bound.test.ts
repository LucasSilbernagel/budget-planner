/**
 * `savingsGoals.currentBalance` is refused at the client queue gate, while
 * `balanceTracking.currentBalance` stays negative-capable (Story 66.5, D1).
 *
 * ⚠️⚠️ WHY THIS GATE EXISTS, AND WHY IT IS NOT DEFENSIVE PADDING. Story 66.5 made
 * `savingsGoals_currentBalance_non_negative` a REAL database constraint. In this
 * product a constraint violation on the push path is not a clean rejection:
 * `server/api/sync.ts` catches the PostgreSQL error and returns a 200 envelope
 * with `failedCount > 0` and NO status code; `features/api/client.ts` marks that
 * `retryable: false` with no `statusCode`; and `synchronization.ts`'s
 * `unclassifiedFailedOperations` handling DELIBERATELY KEEPS IT QUEUED, because
 * removal requires positive proof of permanent rejection. The operation replays
 * every cycle, `consecutiveFailures` climbs, the circuit breaker opens, and ALL
 * sync for that account stops. Refusing here costs one un-synced row; letting it
 * through costs the account's whole sync.
 *
 * ⚠️⚠️ AND WHY IT COULD NOT SIMPLY BE ADDED TO THE SHARED SCHEMA.
 * `syncOperationDataSchema` is ONE FLAT SCHEMA shared by every entity type, so a
 * field two entities both carry gets the LOOSEST of the two bounds.
 * `balanceTracking` stores DEBT balances, which are negative by design, so the
 * shared declaration is `.min(PG_INT32_MIN)` and the savings bound had nowhere
 * to live. Narrowing the shared field would reject every debt row in the product
 * — a false rejection, which is worse than the corruption the gate exists to
 * stop. The last two assertions here are what stop someone "tidying" this into
 * the shared schema.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'
import { SynchronizationService, createSynchronizationService } from '../index'

/**
 * Assert the rejection came from the `currentBalance` bound and nothing else.
 *
 * ⚠️ A bare `.rejects.toThrow()` was the first version and code review was right to
 * call it out: `queueCreate`/`queueUpdate` also throw on a userId mismatch, and a
 * mis-keyed refinement map or any non-Zod throw from `queue.add` would satisfy it
 * too. That is the same argument `packages/db/src/check-constraints.test.ts` makes
 * for pinning the constraint name — applied inconsistently until now.
 */
async function expectCurrentBalanceRejection(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toThrow(ZodError)
  await promise.catch((error: unknown) => {
    const issues = (error as ZodError).issues
    expect(issues.map((issue) => issue.path.join('.'))).toContain('currentBalance')
  })
}

describe('per-entity currentBalance bound at the queue gate (story 66.5)', () => {
  let service: SynchronizationService
  const userId = 'test-user-66-5'

  beforeEach(() => {
    vi.useFakeTimers()
    service = createSynchronizationService(userId, {
      autoSync: false,
      debug: false,
      processOperation: async () => ({ success: true }),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    service.destroy()
  })

  it('REFUSES a create carrying a negative savingsGoal currentBalance', async () => {
    await expectCurrentBalanceRejection(
      service.queueCreate(
        'savingsGoal',
        'goal-1',
        { name: 'Overdrawn', currentBalance: -1 },
        userId
      )
    )
  })

  it('REFUSES an update carrying a negative savingsGoal currentBalance', async () => {
    // The update path is the one that actually bites in practice: the entry form
    // validates on create, but `updateSavingsGoal` spreads the PREVIOUS row into
    // the payload, so a bad balance that arrived some other way is re-sent on any
    // later edit — a rename is enough.
    await expectCurrentBalanceRejection(
      service.queueUpdate(
        'savingsGoal',
        'goal-1',
        { name: 'Renamed', currentBalance: -5000 },
        userId
      )
    )
  })

  it('ACCEPTS a zero savingsGoal currentBalance (the boundary is >= 0, not > 0)', async () => {
    const op = await service.queueCreate(
      'savingsGoal',
      'goal-2',
      { name: 'Fresh goal', currentBalance: 0 },
      userId
    )
    expect(op.data.currentBalance).toBe(0)
  })

  it('ACCEPTS a savingsGoal update that omits currentBalance entirely', async () => {
    // An operation payload is partial. A rename must not be rejected for not
    // mentioning the balance — that would be the false rejection this whole
    // design exists to avoid, just relocated.
    const op = await service.queueUpdate('savingsGoal', 'goal-3', { name: 'Just a rename' }, userId)
    expect(op.data).toEqual({ name: 'Just a rename' })
  })

  it('REFUSES an explicit null currentBalance on a savingsGoal', async () => {
    // ⚠️ `.optional()` does NOT accept `null` in zod — a recorded landmine in this
    // repo, where an `.optional()`-only field once would have refused nearly every
    // profile. Here the strictness is CORRECT (the column is NOT NULL, so a null
    // balance is not a legal row) and this test says so on purpose, rather than
    // leaving the behaviour undocumented and liable to be "fixed" with `.nullable()`.
    await expectCurrentBalanceRejection(
      service.queueUpdate('savingsGoal', 'goal-1', { currentBalance: null }, userId)
    )
  })

  it('⚠️ ACCEPTS a NEGATIVE balanceTracking currentBalance — debts live there', async () => {
    const op = await service.queueCreate(
      'balanceTracking',
      'debt-1',
      { name: 'Mortgage', type: 'debt', currentBalance: -250_000 },
      userId
    )
    expect(op.data.currentBalance).toBe(-250_000)
  })

  it('⚠️ ACCEPTS a NEGATIVE balanceTracking currentBalance on update', async () => {
    const op = await service.queueUpdate(
      'balanceTracking',
      'debt-1',
      { currentBalance: -100_000 },
      userId
    )
    expect(op.data.currentBalance).toBe(-100_000)
  })
})
