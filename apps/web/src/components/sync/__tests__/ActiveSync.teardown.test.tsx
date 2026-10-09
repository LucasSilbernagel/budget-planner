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
import { resetRefusalNotices } from '@/lib/sync/refusalNoticeStore'
import { seedMarkerKey } from '@/lib/sync/seedLocalData'
import { resetSessionStatusStore, setSyncSessionStatus } from '@/lib/sync/sessionStatusStore'
import { clearSyncBridge, isSyncActive } from '@/lib/sync/syncBridge'
import { useIncomeStore } from '@/stores/incomeStore'
import { useProfileStore } from '@/stores/profileStore'
import { ActiveSync } from '../ActiveSync'

const ACCOUNT_A = 'aaaaaaaa-0000-4000-8000-000000000079'
const ACCOUNT_B = 'bbbbbbbb-0000-4000-8000-000000000079'
const A_MAIN = 'aaaaaaaa-1111-4111-8111-111111111079'
const B_MAIN = 'bbbbbbbb-1111-4111-8111-111111111079'
const QUEUE_KEY = `bp-sync-queue-${ACCOUNT_A}`
const REFUSED = { success: false, retryable: false, statusCode: 422, error: 'refused' }

const fetchMeta = fetchServerChangesWithMeta as unknown as ReturnType<typeof vi.fn>
const send = sendSyncOperation as unknown as ReturnType<typeof vi.fn>

function mainProfile(id: string, userId: string): ServerChange {
	return {
		entityType: 'userProfile',
		entityId: id,
		data: { id, userId, name: 'Main Profile', isDefault: true, currency: 'NONE' },
		updatedAt: 1000,
		isDeleted: false,
	}
}

function queuedIds(): string[] {
	const raw = localStorage.getItem(QUEUE_KEY)
	return raw ? (JSON.parse(raw) as { entityId: string }[]).map((op) => op.entityId) : []
}

function pullAnswer(userId: string, profileId: string) {
	return { changes: [mainProfile(profileId, userId)], profileIds: [profileId] }
}

beforeEach(() => {
	vi.clearAllMocks()
	resetSyncStore()
	resetSessionStatusStore()
	resetRefusalNotices()
	clearSyncBridge()
	localStorage.clear()
	localStorage.setItem(seedMarkerKey(ACCOUNT_A), '1')
	localStorage.setItem(seedMarkerKey(ACCOUNT_B), '1')
	useProfileStore.setState({
		profiles: [
			{ id: A_MAIN, userId: ACCOUNT_A, name: 'Main Profile', isDefault: true, currency: 'NONE' },
		],
		activeProfileId: A_MAIN,
	})
	useIncomeStore.setState({ incomeSources: [] })
	fetchMeta.mockResolvedValue(pullAnswer(ACCOUNT_A, A_MAIN))
	send.mockResolvedValue({ success: true })
})

afterEach(() => {
	cleanup()
	clearSyncBridge()
})

describe('sync torn down while a request is in flight', () => {
	it('a new row refused after sign-out stays on the device, then is refused again, named and removed in the next session', async () => {
		localStorage.setItem('sync:hasCompletedInitialPull', '1')
		render(<ActiveSync userId={ACCOUNT_A} />)
		await waitFor(() => expect(isSyncActive()).toBe(true))
		let release: (result: unknown) => void = () => {}
		send.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					release = resolve
				})
		)
		useIncomeStore
			.getState()
			.addIncomeSource({ name: 'Side gig', amount: 1000, frequency: 'monthly' })
		const rowId = (useIncomeStore.getState().incomeSources[0] as { id: string }).id
		await waitFor(() => expect(send).toHaveBeenCalledTimes(1), { timeout: 6000 })

		cleanup()
		resetSyncStore()
		release(REFUSED)
		await new Promise((r) => setTimeout(r, 100))

		expect(useIncomeStore.getState().incomeSources.map((row) => row.id)).toEqual([rowId])
		expect(queuedIds()).toEqual([rowId])

		send.mockResolvedValue(REFUSED)
		render(<ActiveSync userId={ACCOUNT_A} />)

		expect(
			await screen.findByText(
				/“Side gig” \(income\) couldn't be saved to your account/,
				undefined,
				{
					timeout: 6000,
				}
			)
		).toBeInTheDocument()
		expect(screen.getAllByRole('alert')).toHaveLength(1)
		await waitFor(() => expect(useIncomeStore.getState().incomeSources).toEqual([]))
		expect(queuedIds()).toEqual([])
		expect(send).toHaveBeenCalledTimes(2)
	}, 15_000)

	it("the previous account's pull answering after an account switch does not put the page back into loading", async () => {
		setSyncSessionStatus(true, true)
		let releaseA: () => void = () => {}
		fetchMeta.mockImplementation(
			async (_since: number | null, _limit: number, profileId?: string) => {
				if (profileId === A_MAIN) {
					await new Promise<void>((r) => {
						releaseA = r
					})
					return pullAnswer(ACCOUNT_A, A_MAIN)
				}
				return pullAnswer(ACCOUNT_B, B_MAIN)
			}
		)

		const { rerender } = render(
			<>
				<ActiveSync userId={ACCOUNT_A} />
				<IncomePage />
			</>
		)
		await waitFor(() => expect(fetchMeta).toHaveBeenCalledTimes(1))
		expect(screen.getByTestId('page-loading-status')).toBeInTheDocument()

		rerender(
			<>
				<ActiveSync userId={ACCOUNT_B} />
				<IncomePage />
			</>
		)
		expect(await screen.findByText('No income sources yet')).toBeInTheDocument()

		releaseA()
		await new Promise((r) => setTimeout(r, 100))

		expect(screen.queryByTestId('page-loading-status')).not.toBeInTheDocument()
		expect(screen.getByText('No income sources yet')).toBeInTheDocument()
	})
})
