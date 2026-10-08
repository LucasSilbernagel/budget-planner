import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	clearSyncBridge,
	registerSyncBridge,
	type SyncBridgeHandle,
} from '../../lib/sync/syncBridge'
import { useExpenseStore } from '../expenseStore'
import { useIncomeStore } from '../incomeStore'
import { useSavingsStore } from '../savingsStore'

const SESSION_USER_ID = '550e8400-e29b-41d4-a716-446655440000'

function makeHandle() {
	return {
		userId: SESSION_USER_ID,
		queueCreate: vi.fn<SyncBridgeHandle['queueCreate']>(async () => {}),
		queueUpdate: vi.fn<SyncBridgeHandle['queueUpdate']>(async () => {}),
		queueDelete: vi.fn<SyncBridgeHandle['queueDelete']>(async () => {}),
	}
}

let handle: ReturnType<typeof makeHandle>

beforeEach(() => {
	handle = makeHandle()
	useIncomeStore.setState({ incomeSources: [] })
	useExpenseStore.setState({ expenses: [] })
	useSavingsStore.setState({ savingsGoals: [] })
	localStorage.clear()
})

afterEach(() => {
	clearSyncBridge()
	vi.restoreAllMocks()
})

describe('free tier (no bridge registered) — localStorage only', () => {
	it('adding income makes no queue calls but still persists locally', () => {
		useIncomeStore
			.getState()
			.addIncomeSource({ name: 'Salary', amount: 500000, frequency: 'monthly' })

		expect(handle.queueCreate).not.toHaveBeenCalled()
		expect(useIncomeStore.getState().incomeSources).toHaveLength(1)
	})
})

describe('paid tier (bridge registered) — mirrors edits to the queue', () => {
	beforeEach(() => {
		registerSyncBridge(handle)
	})

	it('add → queueCreate with the server payload + shared uuid id', () => {
		useIncomeStore
			.getState()
			.addIncomeSource({ name: 'Salary', amount: 500000, frequency: 'monthly' })

		const created = useIncomeStore.getState().incomeSources[0]
		expect(handle.queueCreate).toHaveBeenCalledTimes(1)
		expect(handle.queueCreate).toHaveBeenCalledWith('incomeSource', created.id, {
			name: 'Salary',
			amount: 500000,
			frequency: 'monthly',
			categoryId: null,
			// Always forwarded (updateEntity does a partial set). Exhaustive on purpose so an extra payload
			// key fails.
			sortOrder: 0,
			userId: SESSION_USER_ID,
		})
	})

	it('update → queueUpdate carrying a baseVersion from the pre-edit row', () => {
		useIncomeStore.setState({
			incomeSources: [
				{
					id: 'inc-1',
					userId: 0,
					categoryId: null,
					name: 'Salary',
					amount: 500000,
					frequency: 'monthly',
					createdAt: '2026-06-01T00:00:00.000Z',
					updatedAt: '2026-06-28T00:00:00.000Z',
				},
			],
		})

		useIncomeStore.getState().updateIncomeSource('inc-1', { amount: 600000 })

		expect(handle.queueUpdate).toHaveBeenCalledTimes(1)
		const [entityType, entityId, data, , baseVersion] = handle.queueUpdate.mock.calls[0]
		expect(entityType).toBe('incomeSource')
		expect(entityId).toBe('inc-1')
		expect(data).toMatchObject({ amount: 600000, userId: SESSION_USER_ID })
		expect(baseVersion).toBe(Date.parse('2026-06-28T00:00:00.000Z'))
	})

	it('delete → queueDelete with a tombstone baseVersion', () => {
		useExpenseStore.setState({
			expenses: [
				{
					id: 'exp-1',
					userId: 0,
					categoryId: null,
					name: 'Rent',
					amount: 100000,
					frequency: 'monthly',
					createdAt: '2026-06-01T00:00:00.000Z',
					updatedAt: '2026-06-28T00:00:00.000Z',
				},
			],
		})

		useExpenseStore.getState().deleteExpense('exp-1')

		expect(handle.queueDelete).toHaveBeenCalledWith(
			'expense',
			'exp-1',
			Date.parse('2026-06-28T00:00:00.000Z')
		)
		expect(useExpenseStore.getState().expenses).toHaveLength(0)
	})

	it('savings add → queueCreate with savings columns', () => {
		useSavingsStore.getState().addSavingsGoal({
			name: 'Emergency',
			targetAmount: 1000000,
			currentBalance: 250000,
		})

		const goal = useSavingsStore.getState().savingsGoals[0]
		expect(handle.queueCreate).toHaveBeenCalledWith('savingsGoal', goal.id, {
			name: 'Emergency',
			targetAmount: 1000000,
			currentBalance: 250000,
			// monthlyAllocation is forwarded as an explicit null so a manual→automatic switch resets the
			// server value.
			allocationMode: 'automatic',
			monthlyAllocation: null,
			sortOrder: 0,
			userId: SESSION_USER_ID,
		})
	})

	it('stops queuing after the bridge is cleared (paid → free / logout)', () => {
		clearSyncBridge()
		useIncomeStore.getState().addIncomeSource({ name: 'X', amount: 100, frequency: 'monthly' })
		expect(handle.queueCreate).not.toHaveBeenCalled()
	})
})
