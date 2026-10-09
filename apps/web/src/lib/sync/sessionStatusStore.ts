/** Separate from useSync's store, importing only zustand, to keep the sync engine out of the root chunk. */

import { create } from 'zustand'

type SessionStatusState = {
	/** False until SyncProvider's probe resolves (including skipped probes); check before trusting isPaidSyncSession. */
	resolved: boolean

	/** Set from the same resolution SyncProvider uses to mount ActiveSync, so readers can't disagree with it. */
	isPaidSyncSession: boolean

	lastPullTimestamp: number | null
}

const useSessionStatusStore = create<SessionStatusState>(() => ({
	resolved: false,
	isPaidSyncSession: false,
	lastPullTimestamp: null,
}))

export function useSyncSessionStatus(): { resolved: boolean; isPaidSyncSession: boolean } {
	return useSessionStatusStore((s) => ({
		resolved: s.resolved,
		isPaidSyncSession: s.isPaidSyncSession,
	}))
}

export function setSyncSessionStatus(resolved: boolean, isPaidSyncSession: boolean): void {
	useSessionStatusStore.setState({ resolved, isPaidSyncSession })
}

export function useLastPullTimestamp(): number | null {
	return useSessionStatusStore((s) => s.lastPullTimestamp)
}

export function setLastPullTimestamp(value: number | null): void {
	useSessionStatusStore.setState({ lastPullTimestamp: value })
}

export function resetSessionStatusStore(): void {
	useSessionStatusStore.setState({
		resolved: false,
		isPaidSyncSession: false,
		lastPullTimestamp: null,
	})
}
