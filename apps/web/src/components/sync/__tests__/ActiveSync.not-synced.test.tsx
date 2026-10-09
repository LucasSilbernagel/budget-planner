import type { SyncOperation } from '@budget-planner/core/sync/types'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
import { useExpenseStore } from '@/stores/expenseStore'
import { useProfileStore } from '@/stores/profileStore'
import { ActiveSync } from '../ActiveSync'

const USER = '79279279-2792-4792-8792-792792792792'
const PROFILE = '79200000-0000-4000-8000-000000000792'
const EXPENSE = '79211111-1111-4111-8111-111111111792'
const ISO = '2026-09-01T00:00:00.000Z'
const UNCLASSIFIED = { success: false, retryable: false, error: 'Operation failed on server' }
// The engine escalates only after its fast-retry window (maxRetries × retryDelay) has passed.
const ESCALATION_FLOOR_MS = 15_000

const fetchMeta = fetchServerChangesWithMeta as unknown as ReturnType<typeof vi.fn>
const send = sendSyncOperation as unknown as ReturnType<typeof vi.fn>

let clockOffset = 0
const realNow = Date.now.bind(Date)

function expenseAttempts(): number {
	return send.mock.calls.filter(([op]) => op.entityId === EXPENSE).length
}

function queuedEdit(): SyncOperation {
	return {
		id: 'op-stuck-edit',
		type: 'update',
		entityType: 'expense',
		entityId: EXPENSE,
		data: { userId: USER, name: 'Rent', amount: 50_000, frequency: 'monthly' },
		timestamp: realNow(),
		deviceId: 'device-1',
		userId: USER,
		profileId: PROFILE,
	} as SyncOperation
}

async function refocusTab(expectedAttempts: number): Promise<void> {
	document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))
	await waitFor(() => expect(expenseAttempts()).toBe(expectedAttempts))
}

beforeEach(() => {
	vi.clearAllMocks()
	clockOffset = 0
	vi.spyOn(Date, 'now').mockImplementation(() => realNow() + clockOffset)
	resetSyncStore()
	resetSessionStatusStore()
	resetRefusalNotices()
	clearSyncBridge()
	localStorage.clear()
	localStorage.setItem('sync:hasCompletedInitialPull', '1')
	localStorage.setItem(seedMarkerKey(USER), '1')
	localStorage.setItem(`bp-sync-queue-${USER}`, JSON.stringify([queuedEdit()]))
	useProfileStore.setState({
		profiles: [{ id: PROFILE, userId: USER, name: 'Main', isDefault: true, currency: 'NONE' }],
		activeProfileId: PROFILE,
	})
	useExpenseStore.setState({
		expenses: [
			{
				id: EXPENSE,
				userId: USER,
				profileId: PROFILE,
				name: 'Rent',
				amount: 50_000,
				frequency: 'monthly',
				createdAt: ISO,
				updatedAt: ISO,
			} as never,
		],
	})
	fetchMeta.mockResolvedValue({ changes: [], profileIds: [PROFILE] })
	send.mockImplementation(async (op: { entityId: string }) =>
		op.entityId === EXPENSE ? UNCLASSIFIED : { success: true }
	)
})

afterEach(() => {
	cleanup()
	clearSyncBridge()
	vi.restoreAllMocks()
})

describe('an edit that keeps failing to sync', () => {
	it('is named only after repeated attempts, and "Try again" is disabled for the whole push and clears the notice once it lands', async () => {
		render(<ActiveSync userId={USER} />)
		await waitFor(() => expect(expenseAttempts()).toBe(1))
		await refocusTab(2)
		await refocusTab(3)
		expect(screen.queryByRole('alert')).not.toBeInTheDocument()

		clockOffset = ESCALATION_FLOOR_MS
		await refocusTab(4)

		const alert = await screen.findByRole('alert')
		expect(alert).toHaveTextContent('Not synced yet')
		expect(alert).toHaveTextContent(
			"Your change to “Rent” (expense) hasn't reached your account yet."
		)

		let release: (result: unknown) => void = () => {}
		send.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					release = resolve
				})
		)
		const retry = screen.getByRole('button', { name: 'Try again to sync “Rent” (expense)' })
		fireEvent.click(retry)
		await waitFor(() => expect(expenseAttempts()).toBe(5))
		await waitFor(() => expect(retry).toBeDisabled())

		release({ success: true })

		await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
	})
})
