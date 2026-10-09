import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../features/api/client', () => ({
	fetchServerChangesWithMeta: vi.fn(),
	sendSyncOperation: vi.fn(),
}))

import { fetchServerChangesWithMeta, sendSyncOperation } from '../../features/api/client'
import { dismissAllRefusalNotices, getRefusalNotices } from '../../lib/sync/refusalNoticeStore'
import {
	resetSessionStatusStore,
	setLastPullTimestamp,
	useLastPullTimestamp,
} from '../../lib/sync/sessionStatusStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { useProfileStore } from '../../stores/profileStore'
import { resetSyncStore, useSync } from '../useSync'

const USER = '66666666-6666-4666-8666-666666666666'
const PROFILE = '77777777-7777-4777-8777-777777777777'
const ROW = '88888888-8888-4888-8888-888888888888'
const ISO = '2026-09-01T00:00:00.000Z'
const QUEUE_KEY = `bp-sync-queue-${USER}`
const fetchMeta = fetchServerChangesWithMeta as unknown as ReturnType<typeof vi.fn>
const send = sendSyncOperation as unknown as ReturnType<typeof vi.fn>

const REFUSED = { success: false, retryable: false, statusCode: 422, error: 'refused' }

function queuedIds(): string[] {
	const raw = localStorage.getItem(QUEUE_KEY)
	return raw ? (JSON.parse(raw) as { entityId: string }[]).map((op) => op.entityId) : []
}

beforeEach(() => {
	vi.clearAllMocks()
	resetSyncStore()
	resetSessionStatusStore()
	localStorage.clear()
	dismissAllRefusalNotices()
	useProfileStore.setState({
		profiles: [{ id: PROFILE, userId: USER, name: 'Main', isDefault: true, currency: 'NONE' }],
		activeProfileId: PROFILE,
	})
	useIncomeStore.setState({
		incomeSources: [
			{
				id: ROW,
				userId: USER,
				profileId: PROFILE,
				name: 'Side gig',
				amount: 1000,
				frequency: 'monthly',
				categoryId: null,
				sortOrder: 0,
				createdAt: ISO,
				updatedAt: ISO,
			},
		],
	})
	fetchMeta.mockResolvedValue({ changes: [], profileIds: [PROFILE] })
})

describe('useSync teardown mid-sync', () => {
	it('a create refused after unmount is refused again, named and reverted by the next session', async () => {
		let release: (value: unknown) => void = () => {}
		send.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					release = resolve
				})
		)
		send.mockResolvedValue(REFUSED)

		const first = renderHook(() => useSync({ userId: USER, autoSync: false, autoPull: false }))
		await first.result.current.queueCreate('incomeSource', ROW, {
			userId: USER,
			name: 'Side gig',
			amount: 1000,
			frequency: 'monthly',
		})
		const inFlight = first.result.current.forceSync()
		await waitFor(() => expect(send).toHaveBeenCalledTimes(1))

		first.unmount()
		release(REFUSED)
		await inFlight

		expect(getRefusalNotices()).toEqual([])
		expect(useIncomeStore.getState().incomeSources.map((row) => row.id)).toEqual([ROW])
		expect(queuedIds()).toEqual([ROW])

		const second = renderHook(() => useSync({ userId: USER, autoSync: false, autoPull: false }))
		await waitFor(async () => {
			await second.result.current.forceSync()
			expect(send).toHaveBeenCalledTimes(2)
		})

		await waitFor(() =>
			expect(getRefusalNotices().map((notice) => [notice.name, notice.outcome])).toEqual([
				['Side gig', 'removed'],
			])
		)
		expect(useIncomeStore.getState().incomeSources).toEqual([])
		expect(queuedIds()).toEqual([])
		second.unmount()
	})

	it("a pull that resolves after unmount writes nothing into the next session's stores (code review 79.1)", async () => {
		let release: (value: unknown) => void = () => {}
		fetchMeta.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					release = resolve
				})
		)
		setLastPullTimestamp(4242)
		const cursor = renderHook(() => useLastPullTimestamp())

		const first = renderHook(() => useSync({ userId: USER, autoSync: false, autoPull: false }))
		const inFlight = first.result.current.pull()
		await waitFor(() => expect(fetchMeta).toHaveBeenCalledTimes(1))

		first.unmount()
		release({ changes: [], profileIds: [PROFILE] })
		const result = await inFlight

		expect(result?.error).toBe('Sync service destroyed')
		expect(cursor.result.current).toBe(4242)
		cursor.unmount()
	})
})
