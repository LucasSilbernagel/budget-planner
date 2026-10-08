import type { ServerChange } from '@budget-planner/core/sync'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../features/api/client', () => ({
	fetchServerChangesWithMeta: vi.fn(),
	sendSyncOperation: vi.fn(),
}))

import { fetchServerChangesWithMeta, sendSyncOperation } from '../../features/api/client'
import { dismissAllRefusalNotices, getRefusalNotices } from '../../lib/sync/refusalNoticeStore'
import { useProfileStore } from '../../stores/profileStore'
import { resetSyncStore, useSync } from '../useSync'

const USER = '66666666-6666-4666-8666-666666666666'
const PROFILE = '77777777-7777-4777-8777-777777777777'
const fetchMeta = fetchServerChangesWithMeta as unknown as ReturnType<typeof vi.fn>
const send = sendSyncOperation as unknown as ReturnType<typeof vi.fn>

const REFUSED = { success: false, retryable: false, statusCode: 422, error: 'refused' }

function incomeChange(updatedAt: number): ServerChange {
	const id = '88888888-8888-4888-8888-888888888888'
	return {
		entityType: 'incomeSource',
		entityId: id,
		data: {
			id,
			userId: USER,
			name: 'Salary',
			amount: 1000,
			frequency: 'monthly',
			createdAt: '2026-09-01T00:00:00.000Z',
			updatedAt: '2026-09-01T00:00:00.000Z',
		},
		updatedAt,
		isDeleted: false,
	}
}

beforeEach(() => {
	vi.clearAllMocks()
	resetSyncStore()
	localStorage.clear()
	dismissAllRefusalNotices()
	useProfileStore.setState({
		profiles: [{ id: PROFILE, userId: USER, name: 'Main', isDefault: true, currency: 'NONE' }],
		activeProfileId: PROFILE,
	})
})

describe('useSync refused-edit revert timing (story 75.2)', () => {
	it('a refusal during an in-flight pull still ends in a FULL re-pull', async () => {
		const sinces: (number | null)[] = []
		let releaseSecond: (value: unknown) => void = () => {}
		fetchMeta.mockImplementation(async (since: number | null) => {
			sinces.push(since)
			if (sinces.length === 1) {
				return { changes: [incomeChange(5000)], profileIds: [PROFILE] }
			}
			if (sinces.length === 2) {
				await new Promise((r) => {
					releaseSecond = r
				})
			}
			return { changes: [], profileIds: [PROFILE] }
		})
		send.mockResolvedValue(REFUSED)

		const { result, unmount } = renderHook(() =>
			useSync({ userId: USER, autoSync: false, autoPull: false })
		)
		await waitFor(() => expect(result.current.pull).toBeDefined())
		await result.current.pull()
		expect(sinces).toEqual([null])

		const inFlight = result.current.pull()
		await waitFor(() => expect(sinces).toEqual([null, 5000]))

		await result.current.queueUpdate('expense', '99999999-9999-4999-8999-999999999999', {
			userId: USER,
			name: 'Rent',
			amount: 50000,
			frequency: 'monthly',
		})
		await result.current.forceSync()
		expect(send).toHaveBeenCalledTimes(1)
		await waitFor(() => expect(getRefusalNotices().map((n) => n.outcome)).toEqual(['changed-back']))

		releaseSecond(undefined)
		await inFlight
		await waitFor(() => expect(sinces).toEqual([null, 5000, null]))
		unmount()
	})

	it('a refused PROFILE create is removed locally, so the next pull does not re-upload it', async () => {
		const LOCAL_ONLY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
		useProfileStore.setState({
			profiles: [
				{ id: PROFILE, userId: USER, name: 'Main', isDefault: true, currency: 'NONE' },
				{ id: LOCAL_ONLY, userId: USER, name: 'Side hustle', isDefault: false, currency: 'NONE' },
			],
			activeProfileId: PROFILE,
		})
		fetchMeta.mockResolvedValue({ changes: [], profileIds: [PROFILE] })
		send.mockImplementation(async (op: { entityType: string; entityId: string }) =>
			op.entityType === 'userProfile' && op.entityId === LOCAL_ONLY ? REFUSED : { success: true }
		)
		const profileCreates = () =>
			send.mock.calls.filter(
				([op]) => op.entityType === 'userProfile' && op.entityId === LOCAL_ONLY
			).length

		const { result, unmount } = renderHook(() =>
			useSync({ userId: USER, autoSync: false, autoPull: false })
		)
		await waitFor(() => expect(result.current.pull).toBeDefined())

		await result.current.pull()
		await result.current.forceSync()
		expect(profileCreates()).toBe(1)
		await waitFor(() =>
			expect(useProfileStore.getState().profiles.map((p) => p.id)).toEqual([PROFILE])
		)
		expect(getRefusalNotices()).toEqual([
			expect.objectContaining({ name: 'Side hustle', kind: 'profile', outcome: 'removed' }),
		])

		await result.current.pull()
		await result.current.forceSync()
		expect(profileCreates()).toBe(1)
		unmount()
	})
})
