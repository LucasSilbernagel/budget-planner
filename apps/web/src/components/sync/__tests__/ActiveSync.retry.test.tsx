import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const useSyncMock = vi.fn()
const forceSync = vi.fn(async () => undefined)

vi.mock('@/lib/sync/syncBridge', () => ({
	registerSyncBridge: vi.fn(),
	clearSyncBridge: vi.fn(),
}))

vi.mock('@/lib/sync/seedLocalData', () => ({
	seedOnce: vi.fn(async () => 0),
}))

vi.mock('@/hooks/useSync', () => ({
	useSync: (...args: unknown[]) => useSyncMock(...args),
}))

import {
	type RefusalNotice,
	reconcileNotSyncedNotices,
	resetRefusalNotices,
} from '@/lib/sync/refusalNoticeStore'
import { ActiveSync } from '../ActiveSync'

const USER = '79279279-2792-4792-8792-792792792792'

const STUCK: RefusalNotice = {
	key: 'expense:row-1',
	entityType: 'expense',
	name: 'Rent',
	kind: 'expense',
	fallback: 'An expense',
	outcome: 'not-synced',
	change: 'update',
}

function syncReturn(isSyncing: boolean) {
	return {
		queueCreate: vi.fn(),
		queueUpdate: vi.fn(),
		queueDelete: vi.fn(),
		forcePull: vi.fn(async () => undefined),
		forceSync,
		isSyncing,
	}
}

beforeEach(() => {
	vi.clearAllMocks()
	resetRefusalNotices()
})

afterEach(() => {
	cleanup()
	act(() => resetRefusalNotices())
})

describe('ActiveSync › "Try again"', () => {
	it('calls useSync.forceSync', () => {
		useSyncMock.mockReturnValue(syncReturn(false))
		render(<ActiveSync userId={USER} />)
		act(() => reconcileNotSyncedNotices([STUCK]))

		const retry = screen.getByRole('button', { name: 'Try again to sync “Rent” (expense)' })
		expect(retry).toBeEnabled()
		fireEvent.click(retry)

		expect(forceSync).toHaveBeenCalledTimes(1)
	})

	it('is disabled while useSync reports a sync in progress', () => {
		useSyncMock.mockReturnValue(syncReturn(true))
		render(<ActiveSync userId={USER} />)
		act(() => reconcileNotSyncedNotices([STUCK]))

		const retry = screen.getByRole('button', { name: 'Try again to sync “Rent” (expense)' })
		expect(retry).toBeDisabled()
		fireEvent.click(retry)
		expect(forceSync).not.toHaveBeenCalled()
	})
})
