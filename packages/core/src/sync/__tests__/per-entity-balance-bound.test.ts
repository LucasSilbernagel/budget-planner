// A DB constraint violation on push stays queued and stalls the account's sync, so savings
// balances are refused at the queue gate. Debts stay negative-capable in the shared schema.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'
import { createSynchronizationService, type SynchronizationService } from '../index'

/** A bare `.rejects.toThrow()` would also pass on a userId mismatch or a mis-keyed refinement. */
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
		// `updateSavingsGoal` spreads the previous row, so a bad balance is re-sent on any later edit.
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
		// A partial payload: a rename must not be rejected for omitting the balance.
		const op = await service.queueUpdate('savingsGoal', 'goal-3', { name: 'Just a rename' }, userId)
		expect(op.data).toEqual({ name: 'Just a rename' })
	})

	it('REFUSES an explicit null currentBalance on a savingsGoal', async () => {
		// `.optional()` rejects `null`, which is correct here (the column is NOT NULL). Don't
		// "fix" it with `.nullable()`.
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
