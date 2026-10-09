import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderWithProviders, screen } from '@/test/utils'
import { INITIAL_SYNC_PENDING_TIMEOUT_MS } from '../../hooks/useIsInitialSyncPending'
import { useIncomeStore } from '../../stores/incomeStore'

const STORAGE_KEY = 'sync:hasCompletedInitialPull'

const sessionStatus = vi.hoisted(() => ({
	resolved: true,
	isPaidSyncSession: true,
}))
const lastPullTimestamp = vi.hoisted(() => ({ value: null as number | null }))

vi.mock('../../lib/sync/sessionStatusStore', () => ({
	useSyncSessionStatus: () => ({
		resolved: sessionStatus.resolved,
		isPaidSyncSession: sessionStatus.isPaidSyncSession,
	}),
	useLastPullTimestamp: () => lastPullTimestamp.value,
}))

import { IncomePage } from '../IncomePage'

beforeEach(() => {
	sessionStatus.resolved = true
	sessionStatus.isPaidSyncSession = true
	lastPullTimestamp.value = null
	useIncomeStore.setState({ incomeSources: [] })
	window.localStorage.clear()
})

afterEach(() => {
	vi.useRealTimers()
	useIncomeStore.setState({ incomeSources: [] })
	window.localStorage.clear()
})

describe('IncomePage — initial sync pending', () => {
	it('a fresh paid device (never synced, pull not yet complete) shows a loading state, not "No income sources yet"', () => {
		renderWithProviders(<IncomePage />)

		expect(screen.getByTestId('page-loading-status')).toBeInTheDocument()
		expect(screen.queryByText('No income sources yet')).not.toBeInTheDocument()
	})

	it('once the pull completes with nothing, the real empty state appears', () => {
		lastPullTimestamp.value = 1_700_000_000_000
		renderWithProviders(<IncomePage />)

		expect(screen.getByText('No income sources yet')).toBeInTheDocument()
	})

	it('a device that has synced before is unaffected, even with zero local rows and no pull resolved this session', () => {
		window.localStorage.setItem(STORAGE_KEY, '1')
		// Only the persisted device-level flag distinguishes this from a fresh device.
		renderWithProviders(<IncomePage />)

		expect(screen.getByText('No income sources yet')).toBeInTheDocument()
		expect(screen.queryByTestId('page-loading-status')).not.toBeInTheDocument()
	})

	it('an established device that already has local rows is unaffected by the pull still being in flight', () => {
		useIncomeStore.getState().addIncomeSource({
			name: 'Salary',
			amount: 500000,
			frequency: 'monthly',
		})
		renderWithProviders(<IncomePage />)

		expect(screen.getByText('Salary')).toBeInTheDocument()
		expect(screen.queryByText('No income sources yet')).not.toBeInTheDocument()
	})

	it('a free (non-paid) session is unaffected regardless of pull state', () => {
		sessionStatus.isPaidSyncSession = false
		renderWithProviders(<IncomePage />)

		expect(screen.getByText('No income sources yet')).toBeInTheDocument()
	})

	it('an unresolved session probe is unaffected, so a free user never waits on it', () => {
		sessionStatus.resolved = false
		renderWithProviders(<IncomePage />)

		expect(screen.getByText('No income sources yet')).toBeInTheDocument()
		expect(screen.queryByTestId('page-loading-status')).not.toBeInTheDocument()
	})

	it('a completed pull marks the device, so a later visit before this session’s pull is not gated', () => {
		lastPullTimestamp.value = 1_700_000_000_000
		const first = renderWithProviders(<IncomePage />)
		expect(window.localStorage.getItem(STORAGE_KEY)).toBe('1')
		first.unmount()

		lastPullTimestamp.value = null
		renderWithProviders(<IncomePage />)

		expect(screen.getByText('No income sources yet')).toBeInTheDocument()
		expect(screen.queryByTestId('page-loading-status')).not.toBeInTheDocument()
	})

	it('a stalled pull gives way to the real empty state after the bounded wait', () => {
		vi.useFakeTimers()
		renderWithProviders(<IncomePage />)
		expect(screen.getByTestId('page-loading-status')).toBeInTheDocument()

		act(() => {
			vi.advanceTimersByTime(INITIAL_SYNC_PENDING_TIMEOUT_MS)
		})

		expect(screen.getByText('No income sources yet')).toBeInTheDocument()
		expect(screen.queryByTestId('page-loading-status')).not.toBeInTheDocument()
	})
})
