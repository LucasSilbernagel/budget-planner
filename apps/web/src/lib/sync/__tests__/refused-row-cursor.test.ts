/**
 * A refused row still advances the pull cursor: holding it would re-fetch the bad row
 * forever and stall every later change (the server filters on updatedAt > cursor).
 */

import type { ServerChange, SynchronizationService } from '@budget-planner/core/sync'
import { createSynchronizationService } from '@budget-planner/core/sync'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useIncomeStore } from '../../../stores/incomeStore'
import { applyServerChangesToStores, reportRefusedServerChanges } from '../applyServerChanges'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const PROFILE_ID = '22222222-2222-4222-8222-222222222222'
const GOOD_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const BAD_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ISO = '2026-09-01T00:00:00.000Z'

function incomeChange(id: string, amount: unknown, updatedAt: number): ServerChange {
	return {
		entityType: 'incomeSource',
		entityId: id,
		data: {
			id,
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
		updatedAt,
		isDeleted: false,
	}
}

describe('AC-4: the pull cursor when a row is refused', () => {
	let service: SynchronizationService
	let fetchServerChanges: ReturnType<typeof vi.fn>
	let warn: ReturnType<typeof vi.spyOn>

	beforeEach(() => {
		useIncomeStore.setState({ incomeSources: [] })
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
	})

	afterEach(() => {
		warn.mockRestore()
		service.destroy()
	})

	it('advances PAST a refused row, so one bad row cannot stall the whole sync', async () => {
		fetchServerChanges.mockResolvedValue([incomeChange(BAD_ID, '500000', 1500)])

		const result = await service.pull()

		expect(result.success).toBe(true)
		expect(result.refused.map((r) => r.entityId)).toEqual([BAD_ID])
		expect(result.applied).toEqual([])
		expect(result.conflicts).toEqual([])
		expect(result.lastPullTimestamp).toBe(1500)
		expect(service.getState().lastPullTimestamp).toBe(1500)
		expect(useIncomeStore.getState().incomeSources).toHaveLength(0)
		expect(warn).toHaveBeenCalledTimes(1)
	})

	it('the next pull asks from the ADVANCED cursor — the poison row is not re-fetched', async () => {
		fetchServerChanges.mockResolvedValueOnce([incomeChange(BAD_ID, '500000', 1500)])
		await service.pull()

		fetchServerChanges.mockResolvedValueOnce([])
		await service.pull()

		expect(fetchServerChanges).toHaveBeenNthCalledWith(1, null)
		expect(fetchServerChanges).toHaveBeenNthCalledWith(2, 1500)
	})

	it('a LATER valid row still lands — the refusal does not block what follows it', async () => {
		fetchServerChanges.mockResolvedValueOnce([
			incomeChange(BAD_ID, '500000', 1500),
			incomeChange(GOOD_ID, 500_000, 1600),
		])

		await service.pull()

		const rows = useIncomeStore.getState().incomeSources
		expect(rows).toHaveLength(1)
		expect(rows[0]?.id).toBe(GOOD_ID)
		expect(service.getState().lastPullTimestamp).toBe(1600)
	})

	it('a refused row is NOT reported as a conflict — the two are different things', async () => {
		// A conflict resolves once the local edit pushes; a malformed row never does, so counting
		// it as one would hold the cursor and stall sync permanently.
		const conflicts: unknown[] = []
		service.onConflict((c) => conflicts.push(c))
		fetchServerChanges.mockResolvedValue([incomeChange(BAD_ID, '500000', 1500)])

		const result = await service.pull()

		expect(result.conflicts).toEqual([])
		expect(conflicts).toEqual([])
		expect(service.getState().conflictOperations).toEqual([])
	})

	it('⚠️ a RELOAD re-fetches the refused row — the skip is per-session, not permanent', async () => {
		fetchServerChanges.mockResolvedValueOnce([incomeChange(BAD_ID, '500000', 1500)])
		await service.pull()
		expect(service.getState().lastPullTimestamp).toBe(1500)

		// A reload is a new service: `lastPullTimestamp` is in-memory only.
		const reloaded = createSynchronizationService(USER_ID, {
			autoSync: false,
			debug: false,
			processOperation: async () => ({ success: true }),
			fetchServerChanges,
		})
		try {
			reloaded.onChangesPulled((changes) => applyServerChangesToStores(changes, USER_ID))
			fetchServerChanges.mockResolvedValueOnce([incomeChange(BAD_ID, '500000', 1500)])
			await reloaded.pull()
			expect(fetchServerChanges).toHaveBeenLastCalledWith(null)
			expect(useIncomeStore.getState().incomeSources).toHaveLength(0)
		} finally {
			reloaded.destroy()
		}
	})

	it('CONTROL: a valid row advances the cursor the same way and DOES land', async () => {
		fetchServerChanges.mockResolvedValue([incomeChange(GOOD_ID, 500_000, 1500)])

		const result = await service.pull()

		expect(result.lastPullTimestamp).toBe(1500)
		expect(useIncomeStore.getState().incomeSources).toHaveLength(1)
		expect(warn).not.toHaveBeenCalled()
	})
})
