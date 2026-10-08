import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const useSyncSessionStatus = vi.fn()
const useLastPullTimestamp = vi.fn()

vi.mock('../../lib/sync/sessionStatusStore', () => ({
	useSyncSessionStatus: () => useSyncSessionStatus(),
	useLastPullTimestamp: () => useLastPullTimestamp(),
}))

const { useIsInitialSyncPending, INITIAL_SYNC_PENDING_TIMEOUT_MS } = await import(
	'../useIsInitialSyncPending'
)

const STORAGE_KEY = 'sync:hasCompletedInitialPull'

function status(overrides: { resolved?: boolean; isPaidSyncSession?: boolean }) {
	return { resolved: false, isPaidSyncSession: false, ...overrides }
}

beforeEach(() => {
	vi.clearAllMocks()
	window.localStorage.clear()
})

afterEach(() => {
	vi.useRealTimers()
	window.localStorage.clear()
})

describe('useIsInitialSyncPending', () => {
	it('is false for a free/unauthenticated session', () => {
		useSyncSessionStatus.mockReturnValue(status({ resolved: true, isPaidSyncSession: false }))
		useLastPullTimestamp.mockReturnValue(null)

		const { result } = renderHook(() => useIsInitialSyncPending(true))
		expect(result.current).toBe(false)
	})

	it('is false while the session probe has not resolved yet (fails closed toward not-pending)', () => {
		useSyncSessionStatus.mockReturnValue(status({ resolved: false, isPaidSyncSession: true }))
		useLastPullTimestamp.mockReturnValue(null)

		const { result } = renderHook(() => useIsInitialSyncPending(true))
		expect(result.current).toBe(false)
	})

	it('is true for a confirmed paid session, on a device that has never synced before, with no pull completed yet', () => {
		useSyncSessionStatus.mockReturnValue(status({ resolved: true, isPaidSyncSession: true }))
		useLastPullTimestamp.mockReturnValue(null)

		const { result } = renderHook(() => useIsInitialSyncPending(true))
		expect(result.current).toBe(true)
	})

	it('is false for a paid session once a pull has completed this session', () => {
		useSyncSessionStatus.mockReturnValue(status({ resolved: true, isPaidSyncSession: true }))
		useLastPullTimestamp.mockReturnValue(1_700_000_000_000)

		const { result } = renderHook(() => useIsInitialSyncPending(true))
		expect(result.current).toBe(false)
	})

	it('AC-6: is false for a device that has synced before (localStorage flag), even though THIS session has no pull yet', () => {
		window.localStorage.setItem(STORAGE_KEY, '1')
		useSyncSessionStatus.mockReturnValue(status({ resolved: true, isPaidSyncSession: true }))
		useLastPullTimestamp.mockReturnValue(null)

		const { result } = renderHook(() => useIsInitialSyncPending(true))
		expect(result.current).toBe(false)
	})

	it('starts false on the very first render regardless of localStorage (no hydration-mismatch risk)', () => {
		window.localStorage.setItem(STORAGE_KEY, '1')
		useSyncSessionStatus.mockReturnValue(status({ resolved: true, isPaidSyncSession: true }))
		useLastPullTimestamp.mockReturnValue(null)

		const { result } = renderHook(() => useIsInitialSyncPending(true))
		expect(result.current).toBe(false)
	})

	it('marks the device as synced (localStorage) once a pull completes, so a later mount is never gated again', () => {
		useSyncSessionStatus.mockReturnValue(status({ resolved: true, isPaidSyncSession: true }))
		useLastPullTimestamp.mockReturnValue(null)

		const { rerender } = renderHook(() => useIsInitialSyncPending(true))
		expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()

		useLastPullTimestamp.mockReturnValue(1_700_000_000_000)
		rerender()

		expect(window.localStorage.getItem(STORAGE_KEY)).toBe('1')
	})

	it('AC-6: is false when the calling page already has local data, even on a never-synced device with no pull yet', () => {
		useSyncSessionStatus.mockReturnValue(status({ resolved: true, isPaidSyncSession: true }))
		useLastPullTimestamp.mockReturnValue(null)

		const { result } = renderHook(() => useIsInitialSyncPending(false))
		expect(result.current).toBe(false)
	})

	it('gives up after the bounded timeout so a stalled pull cannot stick forever', () => {
		vi.useFakeTimers()
		useSyncSessionStatus.mockReturnValue(status({ resolved: true, isPaidSyncSession: true }))
		useLastPullTimestamp.mockReturnValue(null)

		const { result } = renderHook(() => useIsInitialSyncPending(true))
		expect(result.current).toBe(true)

		act(() => {
			vi.advanceTimersByTime(INITIAL_SYNC_PENDING_TIMEOUT_MS)
		})

		expect(result.current).toBe(false)
	})
})
