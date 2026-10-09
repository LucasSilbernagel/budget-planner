import type { ServerChange } from '@budget-planner/core/sync/types'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/features/api/client', () => ({
	fetchServerChangesWithMeta: vi.fn(),
	sendSyncOperation: vi.fn(),
}))

import { IncomePage } from '@/components/IncomePage'
import { fetchServerChangesWithMeta, sendSyncOperation } from '@/features/api/client'
import { resetSyncStore } from '@/hooks/useSync'
import { seedMarkerKey } from '@/lib/sync/seedLocalData'
import { resetSessionStatusStore } from '@/lib/sync/sessionStatusStore'
import { clearSyncBridge } from '@/lib/sync/syncBridge'
import { useIncomeStore } from '@/stores/incomeStore'
import { useProfileStore } from '@/stores/profileStore'
import { ActiveSync } from '../ActiveSync'

const USER = '99999999-9999-4999-8999-999999999999'
const PROFILE = '44444444-4444-4444-8444-444444444444'
const LOCAL_ROW = '11111111-1111-4111-8111-111111111111'
const SERVER_ROW = '22222222-2222-4222-8222-222222222222'
const ISO = '2026-09-01T00:00:00.000Z'
const POLL_INTERVAL_MS = 30_000

const fetchMeta = fetchServerChangesWithMeta as unknown as ReturnType<typeof vi.fn>
const send = sendSyncOperation as unknown as ReturnType<typeof vi.fn>

const SERVER_INCOME: ServerChange = {
	entityType: 'incomeSource',
	entityId: SERVER_ROW,
	data: {
		id: SERVER_ROW,
		userId: USER,
		profileId: PROFILE,
		name: 'Bonus from another device',
		amount: 123_400,
		frequency: 'monthly',
		createdAt: ISO,
		updatedAt: ISO,
	},
	updatedAt: 1000,
	isDeleted: false,
}

beforeEach(() => {
	vi.useFakeTimers({ shouldAdvanceTime: true })
	vi.clearAllMocks()
	resetSyncStore()
	resetSessionStatusStore()
	clearSyncBridge()
	localStorage.clear()
	localStorage.setItem('sync:hasCompletedInitialPull', '1')
	localStorage.setItem(seedMarkerKey(USER), '1')
	useProfileStore.setState({
		profiles: [{ id: PROFILE, userId: USER, name: 'Main', isDefault: true, currency: 'NONE' }],
		activeProfileId: PROFILE,
	})
	useIncomeStore.setState({
		incomeSources: [
			{
				id: LOCAL_ROW,
				userId: USER,
				profileId: PROFILE,
				name: 'Salary',
				amount: 500_000,
				frequency: 'monthly',
				categoryId: null,
				sortOrder: 0,
				createdAt: ISO,
				updatedAt: ISO,
			},
		],
	})
	send.mockResolvedValue({ success: true })
})

afterEach(() => {
	cleanup()
	clearSyncBridge()
	vi.useRealTimers()
})

describe('pulling while signed in', () => {
	it('a failed pull leaves local data alone, and the next poll brings in the server’s rows', async () => {
		fetchMeta.mockRejectedValueOnce(new Error('network down'))
		fetchMeta.mockResolvedValue({ changes: [SERVER_INCOME], profileIds: [PROFILE] })

		render(
			<>
				<ActiveSync userId={USER} />
				<IncomePage />
			</>
		)

		await waitFor(() => expect(fetchMeta).toHaveBeenCalledTimes(1))
		expect(screen.getByText('Salary')).toBeInTheDocument()
		expect(screen.queryByText('Bonus from another device')).not.toBeInTheDocument()

		await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)

		expect(await screen.findByText('Bonus from another device')).toBeInTheDocument()
		expect(screen.getByText('Salary')).toBeInTheDocument()
		expect(fetchMeta).toHaveBeenCalledTimes(2)
	})

	it('a server tombstone removes the row from the page on the next poll', async () => {
		fetchMeta.mockResolvedValueOnce({ changes: [], profileIds: [PROFILE] })
		fetchMeta.mockResolvedValue({
			changes: [{ ...SERVER_INCOME, entityId: LOCAL_ROW, isDeleted: true, updatedAt: 2000 }],
			profileIds: [PROFILE],
		})

		render(
			<>
				<ActiveSync userId={USER} />
				<IncomePage />
			</>
		)
		await waitFor(() => expect(fetchMeta).toHaveBeenCalledTimes(1))
		expect(screen.getByText('Salary')).toBeInTheDocument()

		await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)

		await waitFor(() => expect(screen.queryByText('Salary')).not.toBeInTheDocument())
	})
})
