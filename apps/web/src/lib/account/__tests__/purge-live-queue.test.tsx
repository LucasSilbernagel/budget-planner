import { render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../features/api/client', () => ({
	fetchServerChangesWithMeta: vi.fn(),
	sendSyncOperation: vi.fn(),
}))

import { AccountSection } from '../../../components/settings/account-section'
import { fetchServerChangesWithMeta, sendSyncOperation } from '../../../features/api/client'
import { resetSyncStore, useSync } from '../../../hooks/useSync'
import { useIncomeStore } from '../../../stores/incomeStore'
import { useProfileStore } from '../../../stores/profileStore'
import { dismissAllRefusalNotices, getRefusalNotices } from '../../sync/refusalNoticeStore'
import { resetSessionStatusStore } from '../../sync/sessionStatusStore'
import { purgeLocalFinancialData } from '../purge-local-financial-data'
import { resetSignOutStateForTests } from '../sign-out'

const USER = '86868686-8686-4868-8868-868686868686'
const PROFILE = '77777777-7777-4777-8777-777777777777'
const ROW_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ROW_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ISO = '2026-09-01T00:00:00.000Z'
const QUEUE_KEY = `bp-sync-queue-${USER}`
const fetchMeta = fetchServerChangesWithMeta as unknown as ReturnType<typeof vi.fn>
const send = sendSyncOperation as unknown as ReturnType<typeof vi.fn>

const ACCEPTED = { success: true }
const REFUSED = { success: false, retryable: false, statusCode: 422, error: 'refused' }
const RETRYABLE = { success: false, retryable: true, error: 'server busy' }
const INCOME = { userId: USER, name: 'Side gig', amount: 1000, frequency: 'monthly' }

function queuedIds(): string[] {
	const raw = localStorage.getItem(QUEUE_KEY)
	return raw ? (JSON.parse(raw) as { entityId: string }[]).map((op) => op.entityId) : []
}

function holdNextPush(): (value: unknown) => void {
	let release: (value: unknown) => void = () => {}
	send.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				release = resolve
			})
	)
	return (value) => release(value)
}

function mountSync() {
	return renderHook(() => useSync({ userId: USER, autoSync: false, autoPull: false }))
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
				id: ROW_A,
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
	send.mockResolvedValue(ACCEPTED)
})

describe('purgeLocalFinancialData with a live sync service (story 86.1)', () => {
	it('a new edit after the purge does not write the purged ops back (AC 1 i)', async () => {
		const sync = mountSync()
		await sync.result.current.queueCreate('incomeSource', ROW_A, INCOME)
		expect(queuedIds()).toEqual([ROW_A])

		await purgeLocalFinancialData(USER)
		await sync.result.current.queueCreate('incomeSource', ROW_B, { ...INCOME, name: 'New' })

		expect(queuedIds()).toEqual([ROW_B])
		sync.unmount()
	})

	it('a push in flight across the purge does not write the purged ops back (AC 1 ii)', async () => {
		const release = holdNextPush()
		const sync = mountSync()
		await sync.result.current.queueCreate('incomeSource', ROW_A, INCOME)
		const inFlight = sync.result.current.forceSync()
		await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
		await sync.result.current.queueCreate('incomeSource', ROW_B, { ...INCOME, name: 'New' })
		expect(queuedIds()).toEqual([ROW_A, ROW_B])

		await purgeLocalFinancialData(USER)
		release(ACCEPTED)
		await inFlight

		expect(queuedIds()).toEqual([])
		sync.unmount()
	})

	it('a refusal that lands after the purge is neither reverted nor named (AC 3, D2)', async () => {
		const release = holdNextPush()
		const sync = mountSync()
		await sync.result.current.queueUpdate('incomeSource', ROW_A, { ...INCOME, amount: 2000 })
		const inFlight = sync.result.current.forceSync()
		await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
		fetchMeta.mockClear()

		await purgeLocalFinancialData(USER)
		release(REFUSED)
		await inFlight
		await new Promise((resolve) => setTimeout(resolve, 50))

		expect(getRefusalNotices()).toEqual([])
		expect(fetchMeta).not.toHaveBeenCalled()
		expect(useIncomeStore.getState().incomeSources).toEqual([])
		expect(queuedIds()).toEqual([])
		sync.unmount()
	})

	it('the sync counts drop at once, and a new edit still syncs (AC 4)', async () => {
		const sync = mountSync()
		await sync.result.current.queueCreate('incomeSource', ROW_A, INCOME)
		send.mockResolvedValueOnce(RETRYABLE)
		await sync.result.current.forceSync()
		await waitFor(() => expect(sync.result.current.pendingCount).toBe(1))
		expect(sync.result.current.failedCount).toBe(1)
		send.mockClear()

		await purgeLocalFinancialData(USER)
		await waitFor(() => expect(sync.result.current.pendingCount).toBe(0))
		expect(sync.result.current.failedCount).toBe(0)

		await sync.result.current.queueCreate('incomeSource', ROW_B, { ...INCOME, name: 'New' })
		await sync.result.current.forceSync()
		expect(send.mock.calls.map(([op]) => (op as { entityId: string }).entityId)).toEqual([ROW_B])
		expect(queuedIds()).toEqual([])
		sync.unmount()
	})

	it("never touches another user's live queue, and still clears its own key (AC 5)", async () => {
		const OTHER = '99999999-9999-4999-8999-999999999999'
		const otherKey = `bp-sync-queue-${OTHER}`
		localStorage.setItem(otherKey, JSON.stringify([{ id: 'x', entityId: 'stale' }]))
		const sync = mountSync()
		await sync.result.current.queueCreate('incomeSource', ROW_A, INCOME)

		await purgeLocalFinancialData(OTHER)

		expect(localStorage.getItem(otherKey)).toBeNull()
		await sync.result.current.queueCreate('incomeSource', ROW_B, { ...INCOME, name: 'New' })
		expect(queuedIds()).toEqual([ROW_A, ROW_B])
		sync.unmount()
	})
})

describe('account deletion with a live sync service (story 86.1, AC 2)', () => {
	const assign = vi.fn()
	const originalFetch = global.fetch

	beforeEach(() => {
		resetSignOutStateForTests()
		vi.stubGlobal('location', { ...globalThis.location, assign })
		global.fetch = vi.fn((input: RequestInfo | URL) => {
			const url = String(input)
			if (url.includes('/api/auth/me')) {
				const user = { userId: USER, email: 'u@example.com', subscriptionStatus: 'active' }
				return Promise.resolve(new Response(JSON.stringify({ user }), { status: 200 }))
			}
			if (url.includes('/api/account/delete')) {
				return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }))
			}
			return Promise.resolve(new Response('{}', { status: 200 }))
		}) as typeof global.fetch
	})
	afterEach(() => {
		global.fetch = originalFetch
		vi.unstubAllGlobals()
	})

	it('a write before the page unloads does not bring the purged ops back', async () => {
		const sync = mountSync()
		await sync.result.current.queueCreate('incomeSource', ROW_A, INCOME)
		expect(queuedIds()).toEqual([ROW_A])

		const user = userEvent.setup()
		render(<AccountSection />)
		await user.click(await screen.findByRole('button', { name: /^delete account$/i }))
		await user.click(await screen.findByTestId('delete-confirm-confirm'))
		await waitFor(() => expect(assign).toHaveBeenCalledWith('/'))

		// jsdom does not unload: the live service can still write, as a real browser's can.
		await sync.result.current.queueCreate('incomeSource', ROW_B, { ...INCOME, name: 'New' })

		expect(queuedIds()).toEqual([ROW_B])
		sync.unmount()
	})
})
