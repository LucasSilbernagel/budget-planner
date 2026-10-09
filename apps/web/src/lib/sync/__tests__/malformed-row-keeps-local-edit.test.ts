// @vitest-environment jsdom
// jsdom supplies `localStorage` for core's sync queue; the node environment has none.

import type { SynchronizationService } from '@budget-planner/core/sync/synchronization'
import { createSynchronizationService } from '@budget-planner/core/sync/synchronization'
import type { FetchServerChangesFn, ServerChange } from '@budget-planner/core/sync/types'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { useIncomeStore } from '../../../stores/incomeStore'
import { applyServerChangesToStores, reportRefusedServerChanges } from '../applyServerChanges'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const PROFILE_ID = '22222222-2222-4222-8222-222222222222'
const INCOME_X = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ISO = '2026-09-01T00:00:00.000Z'

const LOCAL_ROW = {
	id: INCOME_X,
	userId: USER_ID,
	profileId: PROFILE_ID,
	name: 'Salary (edited here)',
	amount: 610_000,
	frequency: 'monthly',
	sortOrder: 0,
	createdAt: ISO,
	updatedAt: ISO,
}

function serverRow(amount: unknown): ServerChange {
	return {
		entityType: 'incomeSource',
		entityId: INCOME_X,
		data: {
			id: INCOME_X,
			userId: USER_ID,
			profileId: PROFILE_ID,
			name: 'Salary',
			amount,
			frequency: 'monthly',
			categoryId: null,
			sortOrder: 0,
			isDeleted: false,
			createdAt: ISO,
			updatedAt: ISO,
		},
		updatedAt: 2_000,
		isDeleted: false,
	}
}

describe('a malformed server row does not discard the local edit (web chain)', () => {
	let service: SynchronizationService
	let fetchServerChanges: Mock<FetchServerChangesFn>
	let warn: ReturnType<typeof vi.spyOn>

	beforeEach(async () => {
		vi.useFakeTimers()
		useIncomeStore.setState({ incomeSources: [LOCAL_ROW] as any })
		warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
		fetchServerChanges = vi.fn()
		service = createSynchronizationService(USER_ID, {
			autoSync: false,
			debug: false,
			processOperation: async () => ({ success: true }),
			fetchServerChanges,
		})
		service.onChangesPulled((changes) => applyServerChangesToStores(changes, USER_ID))
		service.onServerChangesRefused(reportRefusedServerChanges)
		vi.setSystemTime(1_000)
		await service.queueUpdate(
			'incomeSource',
			INCOME_X,
			{ name: LOCAL_ROW.name, amount: LOCAL_ROW.amount },
			USER_ID
		)
	})

	afterEach(() => {
		service.destroy()
		warn.mockRestore()
		vi.useRealTimers()
	})

	const queuedFor = (id: string) =>
		service
			.getQueue()
			.getAll()
			.filter((op) => op.entityId === id)
			.map((op) => op.type)

	it('keeps the queued edit AND the local value when the server row has a STRING amount', async () => {
		fetchServerChanges.mockResolvedValueOnce([serverRow('500000')])

		const result = await service.pull()

		expect(fetchServerChanges).toHaveBeenCalledTimes(1)
		expect(result.lastPullTimestamp).toBe(2_000)
		expect(result.refused.map((r) => r.entityId)).toEqual([INCOME_X])

		expect(queuedFor(INCOME_X)).toEqual(['update'])
		expect(useIncomeStore.getState().incomeSources).toEqual([LOCAL_ROW])
		expect(service.getState().conflictOperations).toEqual([])

		expect(warn).toHaveBeenCalledTimes(1)
		const [message, context] = warn.mock.calls[0] ?? []
		expect(String(message)).toContain('refused a malformed server row')
		expect(context).toEqual({
			entityType: 'incomeSource',
			entityId: INCOME_X,
			fields: ['amount:invalid_type'],
		})
		expect(JSON.stringify(warn.mock.calls)).not.toContain('500000')
	})

	it('CONTROL: a VALID newer server row still wins, replacing the local value and the edit', async () => {
		fetchServerChanges.mockResolvedValueOnce([serverRow(500_000)])

		const result = await service.pull()

		expect(result.applied).toHaveLength(1)
		expect(queuedFor(INCOME_X)).toEqual([])
		const rows = useIncomeStore.getState().incomeSources
		expect(rows).toHaveLength(1)
		expect(rows[0]?.amount).toBe(500_000)
		expect(service.getState().conflictOperations).toHaveLength(1)
		expect(warn).not.toHaveBeenCalled()
	})
})
