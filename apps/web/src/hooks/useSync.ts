import type {
	FetchServerChangesFn,
	ProcessOperationFn,
	PullResult,
	ServerChange,
	SyncEntityType,
	SyncOperation,
	SyncResult,
	SyncStatus,
} from '@budget-planner/core/sync'
import {
	createSynchronizationService,
	type SynchronizationService,
	SyncStatus as SyncStatusEnum,
} from '@budget-planner/core/sync'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'
import { fetchServerChangesWithMeta, sendSyncOperation } from '../features/api/client'
import { isOwnedByAnotherAccount } from '../lib/sync/accountOwner'
import {
	applyServerChangesToStores,
	findLocalRow,
	reportRefusedServerChanges,
	stampSyncedOwner,
} from '../lib/sync/applyServerChanges'
import { registerSyncPurgeHandle } from '../lib/sync/purgeHandle'
import {
	addRefusalNotices,
	reconcileNotSyncedNotices,
	resetRefusalNotices,
} from '../lib/sync/refusalNoticeStore'
import { describeNotSyncedRows, handleRejectedOperations } from '../lib/sync/refusedEdits'
import { notePlanOpRefused } from '../lib/sync/retirementPlanPush'
import { setLastPullTimestamp } from '../lib/sync/sessionStatusStore'
import { toServerPayload } from '../lib/sync/syncBridge'
import { useProfileStore } from '../stores/profileStore'

type SyncStoreState = {
	status: SyncStatus

	isOnline: boolean

	pendingCount: number

	failedCount: number

	conflictCount: number

	lastSyncTimestamp: number | null

	lastPullTimestamp: number | null

	changesPulledCount: number

	lastError: string | undefined

	isSyncing: boolean

	retryCount: number
}

type SyncStoreActions = {
	setState: (state: Partial<SyncStoreState>) => void

	reset: () => void
}

type SyncStore = SyncStoreState & SyncStoreActions

export type UseSyncOptions = {
	userId: string

	autoSync?: boolean

	debounceDelay?: number

	autoPull?: boolean

	pullInterval?: number

	pullLimit?: number

	syncConfig?: Partial<Parameters<typeof createSynchronizationService>[1]>
}

export type UseSyncReturn = {
	status: SyncStatus

	isOnline: boolean

	pendingCount: number

	failedCount: number

	conflictCount: number

	lastSyncTimestamp: number | null

	lastPullTimestamp: number | null

	changesPulledCount: number

	lastError: string | undefined

	isSyncing: boolean

	retryCount: number

	hasPendingChanges: boolean

	hasConflicts: boolean

	hasFailures: boolean

	sync: () => Promise<SyncResult | undefined>

	forceSync: () => Promise<SyncResult | undefined>

	pull: () => Promise<PullResult | undefined>

	forcePull: () => Promise<PullResult | undefined>

	queueCreate: (
		entityType: SyncEntityType,
		entityId: string | number,
		data: Record<string, unknown>
	) => Promise<void>

	queueUpdate: (
		entityType: SyncEntityType,
		entityId: string | number,
		data: Record<string, unknown>,
		version?: number,
		baseVersion?: number,
		dependsOn?: SyncOperation['dependsOn']
	) => Promise<void>

	queueDelete: (
		entityType: SyncEntityType,
		entityId: string | number,
		baseVersion?: number
	) => Promise<void>

	reset: () => void
}

const initialState: SyncStoreState = {
	status: SyncStatusEnum.PENDING,
	isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
	pendingCount: 0,
	failedCount: 0,
	conflictCount: 0,
	lastSyncTimestamp: null,
	lastPullTimestamp: null,
	changesPulledCount: 0,
	lastError: undefined,
	isSyncing: false,
	retryCount: 0,
}

const createSyncStore = () =>
	create<SyncStore>()(
		subscribeWithSelector<SyncStore>((set) => ({
			...initialState,
			setState: (state) => set(state),
			reset: () => set(initialState),
		}))
	)

let syncStore: ReturnType<typeof createSyncStore> | null = null

function getSyncStore(): ReturnType<typeof createSyncStore> {
	if (!syncStore) {
		syncStore = createSyncStore()
	}
	return syncStore
}

export function resetSyncStore(): void {
	syncStore = null
}

/**
 * Stable identity: the init effect depends on syncConfig, and recreating the service resets the
 * pull cursor.
 */
const EMPTY_SYNC_CONFIG: Partial<Parameters<typeof createSynchronizationService>[1]> = {}

export function useSync(options: UseSyncOptions): UseSyncReturn {
	const {
		userId,
		autoSync = true,
		debounceDelay = 2000,
		autoPull = true,
		pullInterval = 30000,
		pullLimit = 100,
		syncConfig = EMPTY_SYNC_CONFIG,
	} = options

	const store = getSyncStore()
	const activeProfileId = useProfileStore((s) => s.activeProfileId)
	const syncServiceRef = useRef<SynchronizationService | null>(null)
	const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const pullInFlightRef = useRef(false)
	// A pull requested mid-pull re-runs once on completion instead of being dropped.
	const repullRequestedRef = useRef(false)
	const pullRef = useRef<() => Promise<PullResult | undefined>>(async () => undefined)
	const isFirstProfileEffectRef = useRef(true)
	const lastLiveProfileIdsRef = useRef<string[] | undefined>(undefined)
	const syncSoonTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	/**
	 * pull() is a no-op while one is in flight, and that pull would write a cursor over the reset, so
	 * ask for a re-pull instead.
	 */
	const requestFullRepull = useCallback((): void => {
		const svc = syncServiceRef.current
		if (!svc) {
			return
		}
		svc.resetPullCursor()
		if (pullInFlightRef.current) {
			repullRequestedRef.current = true
			return
		}
		pullRef.current().catch((error) => {
			console.error('Full re-pull failed:', error)
		})
	}, [])

	useEffect(() => {
		syncServiceRef.current = createSynchronizationService(userId, {
			autoSync: false,
			processOperation: sendSyncOperation as ProcessOperationFn,
			// Profile-scoped entities need `profileId NOT NULL` server-side; a switch updates it via updateConfig.
			profileId: useProfileStore.getState().activeProfileId ?? undefined,
			fetchServerChanges: (async (since: number | null) => {
				const { changes, profileIds } = await fetchServerChangesWithMeta(
					since,
					pullLimit,
					useProfileStore.getState().activeProfileId ?? undefined
				)
				lastLiveProfileIdsRef.current = profileIds
				return changes
			}) as FetchServerChangesFn,
			...syncConfig,
		})

		// Flush the persisted queue only after initialize(): before it resolves the queue is not loaded.
		const service = syncServiceRef.current
		const unregisterPurgeHandle = registerSyncPurgeHandle({
			userId,
			clearQueue: () => service.clearQueue(),
		})
		service
			.initialize()
			.then(() => {
				if (
					autoSync &&
					syncServiceRef.current === service &&
					service.getState().pendingOperations.length > 0
				) {
					return service.forceSync()
				}
				return
			})
			.catch((error) => {
				console.error('Failed to initialize sync service:', error)
			})

		const unsubscribe = syncServiceRef.current.onStatusChange((state) => {
			store.getState().setState({
				status: state.status,
				isOnline: state.isOnline,
				pendingCount: state.pendingOperations.length,
				failedCount: state.failedOperations.length,
				conflictCount: state.conflictOperations.length,
				lastSyncTimestamp: state.lastSyncTimestamp,
				lastPullTimestamp: state.lastPullTimestamp,
				lastError: state.lastError,
				// Derived from the status so it also covers syncs this hook did not start.
				isSyncing: state.status === SyncStatusEnum.IN_PROGRESS,
				retryCount: state.retryCount,
			})
			try {
				reconcileNotSyncedNotices(describeNotSyncedRows(state.escalatedOperations, findLocalRow))
			} catch (error) {
				console.error('Naming not-synced sync edits failed:', error)
			}
		})

		// Asks the live queue so a pull never clobbers a still-queued retirement-plan edit.
		const hasPendingOperation = (entityType: SyncEntityType, entityId: string) =>
			service.getQueue().hasPendingOperations(entityType, entityId)

		const unsubscribeChanges = syncServiceRef.current.onChangesPulled((changes: ServerChange[]) => {
			applyServerChangesToStores(changes, userId, { hasPendingOperation })
			const svc = syncServiceRef.current
			store.getState().setState({
				lastPullTimestamp: svc ? svc.getState().lastPullTimestamp : null,
				changesPulledCount: changes.length,
			})
		})

		const unsubscribeRefusedRows = syncServiceRef.current.onServerChangesRefused(
			reportRefusedServerChanges
		)

		// Stamp accepted rows as this account's, so they don't look like free-tier rows to the next account.
		const unsubscribeSynced = syncServiceRef.current.onOperationsSynced((operations) => {
			stampSyncedOwner(operations, userId)
		})

		// A refused update/delete re-pulls even when autoPull is off: the revert has to happen.
		const unsubscribeRejected = syncServiceRef.current.onOperationsRejected((operations) => {
			handleRejectedOperations(operations, {
				queue: service.getQueue(),
				discardOperationsForDeletedProfile: (profileId) =>
					service.discardOperationsForDeletedProfile(profileId),
				applyChanges: (changes) =>
					applyServerChangesToStores(changes, userId, { hasPendingOperation }),
				lookupLocalRow: findLocalRow,
				requestFullRepull,
				notify: addRefusalNotices,
				markPlanRefused: notePlanOpRefused,
			}).catch((error) => {
				console.error('Handling refused sync edits failed:', error)
			})
		})

		return () => {
			// First, so a purge from here on clears storage directly instead of calling a dying service.
			unregisterPurgeHandle()
			unsubscribe()
			unsubscribeChanges()
			unsubscribeRefusedRows()
			unsubscribeSynced()
			unsubscribeRejected()
			// The notice store is module-level; reset it so the next account never sees this one's entries.
			resetRefusalNotices()
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current)
			}
			syncServiceRef.current?.destroy()
			syncServiceRef.current = null
		}
	}, [userId, syncConfig, store, pullLimit, autoSync, requestFullRepull])

	const {
		status,
		isOnline,
		pendingCount,
		failedCount,
		conflictCount,
		lastSyncTimestamp,
		lastPullTimestamp,
		changesPulledCount,
		lastError,
		isSyncing,
		retryCount,
	} = store(
		// useShallow: the selector returns a fresh object, so without it every store write would
		// re-render in a loop.
		useShallow((state) => ({
			status: state.status,
			isOnline: state.isOnline,
			pendingCount: state.pendingCount,
			failedCount: state.failedCount,
			conflictCount: state.conflictCount,
			lastSyncTimestamp: state.lastSyncTimestamp,
			lastPullTimestamp: state.lastPullTimestamp,
			changesPulledCount: state.changesPulledCount,
			lastError: state.lastError,
			isSyncing: state.isSyncing,
			retryCount: state.retryCount,
		}))
	)

	const hasPendingChanges = pendingCount > 0
	const hasConflicts = conflictCount > 0
	const hasFailures = failedCount > 0

	const handleStatusChange = useCallback(
		(isSyncingFlag: boolean) => {
			store.getState().setState({ isSyncing: isSyncingFlag })
		},
		[store]
	)

	const sync = useCallback(async (): Promise<SyncResult | undefined> => {
		if (!syncServiceRef.current) {
			return undefined
		}

		handleStatusChange(true)

		try {
			const result = await syncServiceRef.current.forceSync()
			return result
		} catch (error) {
			console.error('Sync failed:', error)
			return undefined
		} finally {
			handleStatusChange(false)
		}
	}, [handleStatusChange])

	const forceSync = useCallback(async (): Promise<SyncResult | undefined> => {
		if (!syncServiceRef.current) {
			return undefined
		}

		handleStatusChange(true)

		try {
			const result = await syncServiceRef.current.forceSync()
			return result
		} catch (error) {
			console.error('Force sync failed:', error)
			return undefined
		} finally {
			handleStatusChange(false)
		}
	}, [handleStatusChange])

	// Re-arms while another sync runs: sync() returns immediately if one is already in progress.
	const syncSoon = useCallback((): void => {
		const schedule = (attempt: number): void => {
			if (syncSoonTimerRef.current) {
				clearTimeout(syncSoonTimerRef.current)
			}
			syncSoonTimerRef.current = setTimeout(() => {
				syncSoonTimerRef.current = null
				const service = syncServiceRef.current
				if (!service) {
					return
				}
				service
					.forceSync()
					.then((result) => {
						if (result.error === 'Sync already in progress' && attempt < 10) {
							schedule(attempt + 1)
						}
					})
					.catch((error) => {
						console.error('Sync after profile upload failed:', error)
					})
			}, debounceDelay)
		}
		schedule(0)
	}, [debounceDelay])

	/**
	 * Uploads local profiles the server lacks (e.g. created before the push bridge registered), so their
	 * rows stop failing as "Profile not found". Never another account's profiles.
	 */
	const uploadMissingProfiles = useCallback(
		async (profileIds: string[]): Promise<void> => {
			const service = syncServiceRef.current
			if (!service) {
				return
			}
			const live = new Set(profileIds)
			const queue = service.getQueue()
			const missing = useProfileStore
				.getState()
				.profiles.filter(
					(profile) =>
						Boolean(profile.userId) &&
						!isOwnedByAnotherAccount(profile.userId, userId) &&
						!live.has(profile.id) &&
						!queue.hasPendingOperations('userProfile', profile.id)
				)
			for (const profile of missing) {
				await service.queueCreate(
					'userProfile',
					profile.id,
					toServerPayload('userProfile', profile, userId),
					userId
				)
			}
			if (missing.length > 0 && autoSync) {
				syncSoon()
			}
		},
		[userId, autoSync, syncSoon]
	)

	const pull = useCallback(async (): Promise<PullResult | undefined> => {
		if (!syncServiceRef.current || pullInFlightRef.current) {
			return undefined
		}
		pullInFlightRef.current = true
		const service = syncServiceRef.current
		try {
			const result = await service.pull()
			// Torn down mid-pull: don't write this ended session's result into module-level stores.
			if (service.isDestroyed()) {
				return result
			}
			store.getState().setState({
				lastPullTimestamp: result.lastPullTimestamp,
				changesPulledCount: result.changesPulledCount,
				lastError: result.success ? undefined : result.error,
			})
			setLastPullTimestamp(result.lastPullTimestamp)
			// A dependent op was dropped because its parent lost last-writer-wins; a full re-pull restores the
			// server rows (never a store action, which would queue a new op).
			if (result.success && result.droppedDependents.length > 0) {
				requestFullRepull()
			}
			const liveProfileIds = lastLiveProfileIdsRef.current
			lastLiveProfileIdsRef.current = undefined
			// Empty means the server has no default profile yet: nothing trustworthy to compare against.
			if (result.success && liveProfileIds && liveProfileIds.length > 0) {
				await uploadMissingProfiles(liveProfileIds).catch((error) => {
					console.error('Uploading unsynced profiles failed:', error)
				})
			}
			return result
		} catch (error) {
			console.error('Pull failed:', error)
			return undefined
		} finally {
			pullInFlightRef.current = false
			if (repullRequestedRef.current) {
				repullRequestedRef.current = false
				// A re-pull was requested mid-pull and this pull just advanced the cursor; reset again.
				syncServiceRef.current?.resetPullCursor()
				pullRef.current().catch((error) => {
					console.error('Re-pull failed:', error)
				})
			}
		}
	}, [store, uploadMissingProfiles, requestFullRepull])
	pullRef.current = pull

	const forcePull = pull

	useEffect(() => {
		if (!autoPull || pullInterval <= 0) {
			return
		}
		const timer = setInterval(() => {
			if (typeof navigator !== 'undefined' && !navigator.onLine) {
				return
			}
			pull().catch((error) => {
				console.error('Auto-pull failed:', error)
			})
		}, pullInterval)
		return () => {
			clearInterval(timer)
		}
	}, [autoPull, pullInterval, pull])

	// On a profile switch: re-stamp the push config, reset the global pull cursor (deltas are
	// profile-scoped) and pull now rather than waiting for the next poll.
	useEffect(() => {
		syncServiceRef.current?.updateConfig({ profileId: activeProfileId ?? undefined })
		syncServiceRef.current?.resetPullCursor()
		if (isFirstProfileEffectRef.current) {
			isFirstProfileEffectRef.current = false
			return
		}
		if (!autoPull || !syncServiceRef.current) {
			return
		}
		requestFullRepull()
	}, [activeProfileId, autoPull, requestFullRepull])

	const queueCreate = useCallback(
		async (
			entityType: SyncEntityType,
			entityId: string | number,
			data: Record<string, unknown>
		): Promise<void> => {
			if (!syncServiceRef.current) {
				throw new Error('Sync service not initialized')
			}

			await syncServiceRef.current.queueCreate(entityType, entityId, data, userId)

			if (autoSync && debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current)
			}

			if (autoSync) {
				debounceTimerRef.current = setTimeout(() => {
					forceSync().catch((error) => {
						console.error('Auto-sync after queue failed:', error)
					})
				}, debounceDelay)
			}
		},
		[userId, autoSync, debounceDelay, forceSync]
	)

	const queueUpdate = useCallback(
		async (
			entityType: SyncEntityType,
			entityId: string | number,
			data: Record<string, unknown>,
			version?: number,
			baseVersion?: number,
			dependsOn?: SyncOperation['dependsOn']
		): Promise<void> => {
			if (!syncServiceRef.current) {
				throw new Error('Sync service not initialized')
			}

			await syncServiceRef.current.queueUpdate(
				entityType,
				entityId,
				data,
				userId,
				version,
				baseVersion,
				dependsOn
			)

			if (autoSync && debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current)
			}

			if (autoSync) {
				debounceTimerRef.current = setTimeout(() => {
					forceSync().catch((error) => {
						console.error('Auto-sync after queue failed:', error)
					})
				}, debounceDelay)
			}
		},
		[userId, autoSync, debounceDelay, forceSync]
	)

	const queueDelete = useCallback(
		async (
			entityType: SyncEntityType,
			entityId: string | number,
			baseVersion?: number
		): Promise<void> => {
			if (!syncServiceRef.current) {
				throw new Error('Sync service not initialized')
			}

			// Server delete validation requires `userId` inside the operation payload.
			await syncServiceRef.current.queueDelete(
				entityType,
				entityId,
				userId,
				{ userId },
				baseVersion
			)

			if (autoSync && debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current)
			}

			if (autoSync) {
				debounceTimerRef.current = setTimeout(() => {
					forceSync().catch((error) => {
						console.error('Auto-sync after queue failed:', error)
					})
				}, debounceDelay)
			}
		},
		[userId, autoSync, debounceDelay, forceSync]
	)

	const reset = useCallback(() => {
		store.getState().reset()
	}, [store])

	useEffect(() => {
		return () => {
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current)
			}
			if (syncSoonTimerRef.current) {
				clearTimeout(syncSoonTimerRef.current)
			}
		}
	}, [])

	return useMemo(
		() => ({
			status,
			isOnline,
			pendingCount,
			failedCount,
			conflictCount,
			lastSyncTimestamp,
			lastPullTimestamp,
			changesPulledCount,
			lastError,
			isSyncing,
			retryCount,

			hasPendingChanges,
			hasConflicts,
			hasFailures,

			sync,
			forceSync,
			pull,
			forcePull,
			queueCreate,
			queueUpdate,
			queueDelete,
			reset,
		}),
		[
			status,
			isOnline,
			pendingCount,
			failedCount,
			conflictCount,
			lastSyncTimestamp,
			lastPullTimestamp,
			changesPulledCount,
			lastError,
			isSyncing,
			retryCount,
			hasPendingChanges,
			hasConflicts,
			hasFailures,
			sync,
			forceSync,
			pull,
			forcePull,
			queueCreate,
			queueUpdate,
			queueDelete,
			reset,
		]
	)
}

export const SYNC_STATUS_LABELS: Record<SyncStatus, string> = {
	[SyncStatusEnum.PENDING]: 'Pending',
	[SyncStatusEnum.IN_PROGRESS]: 'Syncing...',
	[SyncStatusEnum.COMPLETED]: 'Synced',
	[SyncStatusEnum.FAILED]: 'Sync Failed',
	[SyncStatusEnum.CONFLICT]: 'Conflicts',
	[SyncStatusEnum.PARTIAL]: 'Partially Synced',
	[SyncStatusEnum.OFFLINE]: 'Offline',
}

export const SYNC_STATUS_ICONS: Record<SyncStatus, string> = {
	[SyncStatusEnum.PENDING]: '⏳',
	[SyncStatusEnum.IN_PROGRESS]: '🔄',
	[SyncStatusEnum.COMPLETED]: '✅',
	[SyncStatusEnum.FAILED]: '❌',
	[SyncStatusEnum.CONFLICT]: '⚠️',
	[SyncStatusEnum.PARTIAL]: '⚠️',
	[SyncStatusEnum.OFFLINE]: '📵',
}

export const SYNC_STATUS_COLORS: Record<SyncStatus, string> = {
	[SyncStatusEnum.PENDING]: 'text-yellow-500',
	[SyncStatusEnum.IN_PROGRESS]: 'text-blue-500',
	[SyncStatusEnum.COMPLETED]: 'text-green-500',
	[SyncStatusEnum.FAILED]: 'text-red-500',
	[SyncStatusEnum.CONFLICT]: 'text-orange-500',
	[SyncStatusEnum.PARTIAL]: 'text-orange-500',
	[SyncStatusEnum.OFFLINE]: 'text-gray-500',
}

export function getSyncStatusLabel(status: SyncStatus): string {
	return SYNC_STATUS_LABELS[status] || 'Unknown'
}

export function getSyncStatusIcon(status: SyncStatus): string {
	return SYNC_STATUS_ICONS[status] || '❓'
}

export function getSyncStatusColor(status: SyncStatus): string {
	return SYNC_STATUS_COLORS[status] || 'text-gray-500'
}

export { SyncStatusEnum as SyncStatus }
