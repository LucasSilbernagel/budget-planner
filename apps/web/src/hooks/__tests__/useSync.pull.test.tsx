/**
 * pull() is deliberately not wrapped in act(): that deadlocks against the hook's still-settling
 * init effect under React 19.
 */

import type { ServerChange } from '@budget-planner/core/sync/types'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../features/api/client', () => {
	const fetchServerChanges = vi.fn()
	return {
		fetchServerChanges,
		fetchServerChangesWithMeta: async (...args: unknown[]) => ({
			changes: await fetchServerChanges(...args),
			profileIds: undefined,
		}),
		sendSyncOperation: vi.fn(async () => ({ success: true })),
	}
})

import { fetchServerChanges } from '../../features/api/client'
import { useIncomeStore } from '../../stores/incomeStore'
import { useProfileStore } from '../../stores/profileStore'
import { resetSyncStore, useSync } from '../useSync'

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

/** `userProfileSchema` declares `currency` nullable but not optional, so the fixture needs the key. */
const SERVER_USER_ID = '99999999-9999-4999-8999-999999999999'

const INCOME_ID = '11111111-1111-4111-8111-111111111111'
const INCOME_ID_2 = '22222222-2222-4222-8222-222222222222'

function incomeChange(overrides: Partial<ServerChange> = {}): ServerChange {
	return {
		entityType: 'incomeSource',
		entityId: INCOME_ID,
		data: {
			id: INCOME_ID,
			userId: SERVER_USER_ID,
			name: 'Pulled Salary',
			amount: 123400,
			frequency: 'monthly',
			createdAt: '2026-06-28T00:00:00.000Z',
			updatedAt: '2026-06-28T00:00:00.000Z',
		},
		updatedAt: 1000,
		isDeleted: false,
		...overrides,
	}
}

describe('useSync pull wiring', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		resetSyncStore()
		useIncomeStore.setState({ incomeSources: [] })
		localStorage.clear()
		asMock(fetchServerChanges).mockResolvedValue([])
	})

	it('manual pull() applies a pulled create into the income store', async () => {
		asMock(fetchServerChanges).mockResolvedValue([incomeChange()])

		const { result, unmount } = renderHook(() =>
			useSync({ userId: 'u-1', autoSync: false, autoPull: false })
		)

		const pullResult = await result.current.pull()

		expect(fetchServerChanges).toHaveBeenCalled()
		expect(pullResult?.changesPulledCount).toBe(1)
		const sources = useIncomeStore.getState().incomeSources
		expect(sources.some((s) => s.id === INCOME_ID && s.name === 'Pulled Salary')).toBe(true)
		unmount()
	})

	it('a pulled tombstone removes the entity locally', async () => {
		useIncomeStore.setState({
			incomeSources: [
				{
					id: INCOME_ID,
					userId: 0,
					categoryId: null,
					name: 'Existing',
					amount: 500,
					frequency: 'monthly',
					createdAt: '2026-06-01T00:00:00.000Z',
					updatedAt: '2026-06-01T00:00:00.000Z',
				},
			],
		})
		asMock(fetchServerChanges).mockResolvedValue([
			incomeChange({ isDeleted: true, updatedAt: 2000 }),
		])

		const { result, unmount } = renderHook(() =>
			useSync({ userId: 'u-1', autoSync: false, autoPull: false })
		)

		await result.current.pull()

		expect(useIncomeStore.getState().incomeSources.some((s) => s.id === INCOME_ID)).toBe(false)
		unmount()
	})

	it('auto-poll fires a pull on the interval', async () => {
		const { unmount } = renderHook(() =>
			useSync({ userId: 'u-1', autoSync: false, autoPull: true, pullInterval: 20 })
		)

		await waitFor(() => {
			expect(fetchServerChanges).toHaveBeenCalled()
		})
		unmount()
	})

	it('does not crash when the pull transport fails', async () => {
		asMock(fetchServerChanges).mockRejectedValue(new Error('network down'))

		const { result, unmount } = renderHook(() =>
			useSync({ userId: 'u-1', autoSync: false, autoPull: false })
		)

		const pullResult = await result.current.pull()

		expect(pullResult?.success).toBe(false)
		expect(pullResult?.error).toContain('network down')
		expect(useIncomeStore.getState().incomeSources).toEqual([])
		unmount()
	})

	it("new device: once the first pull reconciles to the server profile, that profile's data is pulled immediately — not on the next poll", async () => {
		const PLACEHOLDER = '33333333-3333-4333-8333-333333333333'
		const SERVER_PROFILE = '44444444-4444-4444-8444-444444444444'
		useProfileStore.setState({
			profiles: [
				{ id: PLACEHOLDER, userId: '', name: 'Main Profile', isDefault: true, currency: 'NONE' },
			],
			activeProfileId: PLACEHOLDER,
		})
		asMock(fetchServerChanges).mockImplementation(
			async (_since: number | null, _limit: number, profileId?: string) =>
				profileId === SERVER_PROFILE
					? [incomeChange({ updatedAt: 900 })]
					: [
							{
								entityType: 'userProfile',
								entityId: SERVER_PROFILE,
								data: {
									id: SERVER_PROFILE,
									userId: SERVER_USER_ID,
									name: 'Main Profile',
									isDefault: true,
									currency: 'NONE',
								},
								updatedAt: 1000,
								isDeleted: false,
							},
						]
		)

		const { result, unmount } = renderHook(() =>
			// A poll interval far beyond the waitFor timeout: only the re-pull can pass.
			useSync({ userId: SERVER_USER_ID, autoSync: false, autoPull: true, pullInterval: 600_000 })
		)
		await result.current.forcePull()

		await waitFor(() => {
			expect(useIncomeStore.getState().incomeSources.some((s) => s.id === INCOME_ID)).toBe(true)
		})
		expect(fetchServerChanges).toHaveBeenLastCalledWith(null, 100, SERVER_PROFILE)
		unmount()
	})

	it('exposes forcePull as a callable manual trigger', async () => {
		asMock(fetchServerChanges).mockResolvedValue([
			incomeChange({ entityId: INCOME_ID_2, updatedAt: 1500 }),
		])

		const { result, unmount } = renderHook(() =>
			useSync({ userId: 'u-1', autoSync: false, autoPull: false })
		)

		await result.current.forcePull()

		expect(useIncomeStore.getState().incomeSources.some((s) => s.id === INCOME_ID_2)).toBe(true)
		unmount()
	})
})
