import type { ServerChange, SyncOperation } from '@budget-planner/core/sync/types'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/features/api/client', () => ({
	fetchServerChangesWithMeta: vi.fn(),
	sendSyncOperation: vi.fn(),
}))

import { fetchServerChangesWithMeta, sendSyncOperation } from '@/features/api/client'
import { resetSyncStore } from '@/hooks/useSync'
import { resetRefusalNotices } from '@/lib/sync/refusalNoticeStore'
import { seedMarkerKey } from '@/lib/sync/seedLocalData'
import { resetSessionStatusStore } from '@/lib/sync/sessionStatusStore'
import { clearSyncBridge } from '@/lib/sync/syncBridge'
import { useIncomeStore } from '@/stores/incomeStore'
import { useProfileStore } from '@/stores/profileStore'
import { ActiveSync } from '../ActiveSync'

const USER = '66666666-6666-4666-8666-666666666666'
const MAIN = '77777777-7777-4777-8777-777777777777'
const SIDE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ROW = '88888888-8888-4888-8888-888888888888'
const ISO = '2026-09-01T00:00:00.000Z'
const QUEUE_KEY = `bp-sync-queue-${USER}`
const REFUSED = { success: false, retryable: false, statusCode: 422, error: 'refused' }

const fetchMeta = fetchServerChangesWithMeta as unknown as ReturnType<typeof vi.fn>
const send = sendSyncOperation as unknown as ReturnType<typeof vi.fn>

function profile(id: string, name: string, isDefault: boolean) {
	return { id, userId: USER, name, isDefault, currency: 'NONE' }
}

function serverIncome(updatedAt: number): ServerChange {
	return {
		entityType: 'incomeSource',
		entityId: ROW,
		data: {
			id: ROW,
			userId: USER,
			profileId: MAIN,
			name: 'Salary',
			amount: 1000,
			frequency: 'monthly',
			createdAt: ISO,
			updatedAt: ISO,
		},
		updatedAt,
		isDeleted: false,
	}
}

function queuedUpdate(): SyncOperation {
	return {
		id: 'op-refused-update',
		type: 'update',
		entityType: 'incomeSource',
		entityId: ROW,
		data: { userId: USER, name: 'Salary (edited)', amount: 1000, frequency: 'monthly' },
		timestamp: Date.now(),
		deviceId: 'device-1',
		userId: USER,
		profileId: MAIN,
	} as SyncOperation
}

function sideProfileCreates(): number {
	return send.mock.calls.filter(
		([op]) => op.entityType === 'userProfile' && op.entityId === SIDE && op.type === 'create'
	).length
}

beforeEach(() => {
	vi.clearAllMocks()
	resetSyncStore()
	resetSessionStatusStore()
	resetRefusalNotices()
	clearSyncBridge()
	localStorage.clear()
	localStorage.setItem('sync:hasCompletedInitialPull', '1')
	localStorage.setItem(seedMarkerKey(USER), '1')
	useProfileStore.setState({ profiles: [profile(MAIN, 'Main', true)], activeProfileId: MAIN })
	useIncomeStore.setState({ incomeSources: [] })
	fetchMeta.mockResolvedValue({ changes: [], profileIds: [MAIN] })
	send.mockResolvedValue({ success: true })
})

afterEach(() => {
	cleanup()
	clearSyncBridge()
})

describe('a refused edit while sync is running', () => {
	it('refused during the first pull, it is named and the whole account is pulled again once that pull ends', async () => {
		const sinces: (number | null)[] = []
		let releaseFirstPull: () => void = () => {}
		fetchMeta.mockImplementation(async (since: number | null) => {
			sinces.push(since)
			if (sinces.length === 1) {
				await new Promise<void>((r) => {
					releaseFirstPull = r
				})
				return { changes: [serverIncome(5000)], profileIds: [MAIN] }
			}
			return { changes: [], profileIds: [MAIN] }
		})
		send.mockResolvedValue(REFUSED)
		useIncomeStore.setState({
			incomeSources: [
				{
					id: ROW,
					userId: USER,
					profileId: MAIN,
					name: 'Salary (edited)',
					amount: 1000,
					frequency: 'monthly',
					categoryId: null,
					sortOrder: 0,
					createdAt: ISO,
					updatedAt: ISO,
				},
			],
		})
		localStorage.setItem(QUEUE_KEY, JSON.stringify([queuedUpdate()]))

		render(<ActiveSync userId={USER} />)

		expect(
			await screen.findByText(/Your change to “Salary \(edited\)” \(income\) couldn't be saved/)
		).toBeInTheDocument()
		expect(sinces).toEqual([null])

		releaseFirstPull()

		await waitFor(() => expect(sinces).toEqual([null, null]))
		await waitFor(() =>
			expect(useIncomeStore.getState().incomeSources.map((r) => r.name)).toEqual(['Salary'])
		)
	})

	it.each([
		['the active one', SIDE],
		['not the active one', MAIN],
	])(
		'a refused new profile (%s) is removed, named, and not uploaded again after a reload',
		async (_label, activeProfileId) => {
			useProfileStore.setState({
				profiles: [profile(MAIN, 'Main', true), profile(SIDE, 'Side hustle', false)],
				activeProfileId,
			})
			send.mockImplementation(async (op: { entityId: string }) =>
				op.entityId === SIDE ? REFUSED : { success: true }
			)

			render(<ActiveSync userId={USER} />)

			expect(
				await screen.findByText(/“Side hustle” \(profile\) couldn't be saved/, undefined, {
					timeout: 6000,
				})
			).toBeInTheDocument()
			await waitFor(() =>
				expect(useProfileStore.getState().profiles.map((p) => p.id)).toEqual([MAIN])
			)
			expect(useProfileStore.getState().activeProfileId).toBe(MAIN)
			expect(sideProfileCreates()).toBe(1)

			cleanup()
			resetSyncStore()
			const pullsBefore = fetchMeta.mock.calls.length
			render(<ActiveSync userId={USER} />)
			await waitFor(() => expect(fetchMeta.mock.calls.length).toBeGreaterThan(pullsBefore))
			await new Promise((r) => setTimeout(r, 2500))

			expect(sideProfileCreates()).toBe(1)
		},
		15_000
	)
})
