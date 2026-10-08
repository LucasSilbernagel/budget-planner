/**
 * Must never import a domain store or the sync engine (import-cycle deadlock).
 * One entry per refused row; a later different outcome replaces it, moved to the end to be re-announced.
 */

import type { SyncEntityType, SyncOperationType } from '@budget-planner/core/sync'
import { create } from 'zustand'

export type RefusalOutcome =
	| 'removed'
	| 'changed-back'
	| 'restored'
	/** Not a refusal: the edit keeps failing but is still kept and queued. */
	| 'not-synced'

export interface RefusalNotice {
	key: string
	entityType: SyncEntityType
	name: string | null
	kind: string
	fallback: string
	outcome: RefusalOutcome
	change?: SyncOperationType
}

interface RefusalNoticeState {
	notices: RefusalNotice[]
	/** Core re-reports escalated edits on every status change, so a dismissal is kept until the row stops escalating. */
	dismissedNotSynced: ReadonlySet<string>
}

const EMPTY_KEYS: ReadonlySet<string> = new Set()

const useRefusalNoticeStore = create<RefusalNoticeState>(() => ({
	notices: [],
	dismissedNotSynced: EMPTY_KEYS,
}))

export function addRefusalNotices(notices: readonly RefusalNotice[]): void {
	if (notices.length === 0) {
		return
	}
	useRefusalNoticeStore.setState((state) => {
		let next = state.notices
		let changed = false
		for (const notice of notices) {
			const existing = next.find((n) => n.key === notice.key)
			if (existing && existing.outcome === notice.outcome) {
				continue
			}
			next = [...next.filter((n) => n.key !== notice.key), notice]
			changed = true
		}
		return changed ? { notices: next } : state
	})
}

/** An on-screen refusal for the row is kept. Returns the same state when nothing changes, to avoid re-rendering. */
export function reconcileNotSyncedNotices(current: readonly RefusalNotice[]): void {
	useRefusalNoticeStore.setState((state) => {
		const currentKeys = new Set(current.map((n) => n.key))

		let dismissed = state.dismissedNotSynced
		if ([...dismissed].some((key) => !currentKeys.has(key))) {
			dismissed = new Set([...dismissed].filter((key) => currentKeys.has(key)))
		}

		let notices = state.notices.filter((n) => n.outcome !== 'not-synced' || currentKeys.has(n.key))
		for (const notice of current) {
			if (dismissed.has(notice.key)) {
				continue
			}
			const onScreen = notices.find((n) => n.key === notice.key)
			if (onScreen === undefined) {
				notices = [...notices, { ...notice, outcome: 'not-synced' }]
			} else if (onScreen.outcome === 'not-synced' && !sameWording(onScreen, notice)) {
				// Rewritten in place, keeping its React key, so it is updated rather than re-announced.
				notices = notices.map((n) => (n === onScreen ? { ...notice, outcome: 'not-synced' } : n))
			}
		}

		const noticesChanged =
			notices.length !== state.notices.length || notices.some((n, i) => n !== state.notices[i])
		if (!noticesChanged && dismissed === state.dismissedNotSynced) {
			return state
		}
		return { notices, dismissedNotSynced: dismissed }
	})
}

function sameWording(a: RefusalNotice, b: RefusalNotice): boolean {
	return (
		a.name === b.name && a.kind === b.kind && a.fallback === b.fallback && a.change === b.change
	)
}

function withDismissed(
	dismissed: ReadonlySet<string>,
	notices: readonly RefusalNotice[]
): ReadonlySet<string> {
	const keys = notices.filter((n) => n.outcome === 'not-synced').map((n) => n.key)
	return keys.length === 0 ? dismissed : new Set([...dismissed, ...keys])
}

export function dismissRefusalNotice(key: string): void {
	useRefusalNoticeStore.setState((state) => ({
		notices: state.notices.filter((n) => n.key !== key),
		dismissedNotSynced: withDismissed(
			state.dismissedNotSynced,
			state.notices.filter((n) => n.key === key)
		),
	}))
}

export function dismissAllRefusalNotices(): void {
	useRefusalNoticeStore.setState((state) => ({
		notices: [],
		dismissedNotSynced: withDismissed(state.dismissedNotSynced, state.notices),
	}))
}

/** Teardown only: the next session may be another account's. */
export function resetRefusalNotices(): void {
	useRefusalNoticeStore.setState({ notices: [], dismissedNotSynced: EMPTY_KEYS })
}

export function useRefusalNotices(): RefusalNotice[] {
	return useRefusalNoticeStore((s) => s.notices)
}

export function getRefusalNotices(): RefusalNotice[] {
	return useRefusalNoticeStore.getState().notices
}
