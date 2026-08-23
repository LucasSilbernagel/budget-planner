/**
 * useSync Hook
 *
 * Custom React hook for managing client-side synchronization state and operations.
 * Provides automatic sync, manual sync triggers, and sync status indicators.
 *
 * Features:
 * - Automatic sync on data changes with debouncing
 * - Manual sync trigger
 * - Sync status UI indicators
 * - Zustand-based state management
 * - Error handling and retry logic
 */

import type {
  FetchServerChangesFn,
  ProcessOperationFn,
  PullResult,
  ServerChange,
  SyncEntityType,
  SyncResult,
  SyncStatus,
} from '@budget-planner/core/sync'
import {
  SyncStatus as SyncStatusEnum,
  SynchronizationService,
  createSynchronizationService,
} from '@budget-planner/core/sync'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'
import {
  fetchServerChanges as fetchServerChangesHttp,
  sendSyncOperation,
} from '../features/api/client'
import { applyServerChangesToStores } from '../lib/sync/applyServerChanges'
import { useProfileStore } from '../stores/profileStore'

// ============================================================================
// Types
// ============================================================================

/**
 * State managed by the sync store
 */
interface SyncStoreState {
  /** Current sync status */
  status: SyncStatus

  /** Whether the device is online */
  isOnline: boolean

  /** Number of pending operations */
  pendingCount: number

  /** Number of failed operations */
  failedCount: number

  /** Number of conflict operations */
  conflictCount: number

  /** Last sync timestamp (null if never synced) */
  lastSyncTimestamp: number | null

  /** Last pull timestamp (null if never pulled) — server → client cursor */
  lastPullTimestamp: number | null

  /** Number of changes applied by the most recent pull */
  changesPulledCount: number

  /** Last error message */
  lastError: string | undefined

  /** Whether a sync is currently in progress */
  isSyncing: boolean

  /** Retry count for failed operations */
  retryCount: number
}

/**
 * Actions available in the sync store
 */
interface SyncStoreActions {
  /** Update the sync state */
  setState: (state: Partial<SyncStoreState>) => void

  /** Reset the store to initial state */
  reset: () => void
}

/**
 * Combined store type
 */
type SyncStore = SyncStoreState & SyncStoreActions

/**
 * Options for initializing the sync hook
 */
export interface UseSyncOptions {
  /** User ID for synchronization */
  userId: string

  /** Whether to enable automatic sync */
  autoSync?: boolean

  /** Debounce delay for automatic sync in milliseconds */
  debounceDelay?: number

  /** Whether to enable automatic server → client pulls (default: true) */
  autoPull?: boolean

  /** Interval between automatic pulls in milliseconds (default: 30000) */
  pullInterval?: number

  /** Max changes requested per pull (server caps this; default: 100) */
  pullLimit?: number

  /** Sync configuration overrides */
  syncConfig?: Partial<Parameters<typeof createSynchronizationService>[1]>
}

/**
 * Return value from useSync hook
 */
export interface UseSyncReturn {
  /** Current sync status */
  status: SyncStatus

  /** Whether the device is online */
  isOnline: boolean

  /** Number of pending operations */
  pendingCount: number

  /** Number of failed operations */
  failedCount: number

  /** Number of conflict operations */
  conflictCount: number

  /** Last sync timestamp */
  lastSyncTimestamp: number | null

  /** Last pull timestamp (server → client cursor) */
  lastPullTimestamp: number | null

  /** Number of changes applied by the most recent pull */
  changesPulledCount: number

  /** Last error message */
  lastError: string | undefined

  /** Whether a sync is currently in progress */
  isSyncing: boolean

  /** Retry count for failed operations */
  retryCount: number

  /** Whether there are pending changes */
  hasPendingChanges: boolean

  /** Whether there are conflicts to resolve */
  hasConflicts: boolean

  /** Whether there are failed operations */
  hasFailures: boolean

  /** Manual sync trigger */
  sync: () => Promise<SyncResult | undefined>

  /** Force sync immediately (bypasses debounce) */
  forceSync: () => Promise<SyncResult | undefined>

  /** Manually pull server → client changes and apply them (AC-5) */
  pull: () => Promise<PullResult | undefined>

  /** Force an immediate pull (alias of pull, for symmetry with forceSync) */
  forcePull: () => Promise<PullResult | undefined>

  /** Queue a create operation */
  queueCreate: (
    entityType: SyncEntityType,
    entityId: string | number,
    data: Record<string, unknown>
  ) => Promise<void>

  /** Queue an update operation */
  queueUpdate: (
    entityType: SyncEntityType,
    entityId: string | number,
    data: Record<string, unknown>,
    version?: number,
    /** Server `updatedAt` (ms) this edit was based on, for causal pull LWW (4-18 D1). */
    baseVersion?: number
  ) => Promise<void>

  /** Queue a delete operation */
  queueDelete: (
    entityType: SyncEntityType,
    entityId: string | number,
    /** Server `updatedAt` (ms) this delete was based on, for causal pull LWW (4-18 D1). */
    baseVersion?: number
  ) => Promise<void>

  /** Reset the sync state */
  reset: () => void
}

// ============================================================================
// Store
// ============================================================================

/**
 * Initial state for the sync store
 */
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

/**
 * Create the sync store
 */
const createSyncStore = () =>
  create<SyncStore>()(
    subscribeWithSelector<SyncStore>((set) => ({
      ...initialState,
      setState: (state) => set(state),
      reset: () => set(initialState),
    }))
  )

// Singleton store instance
let syncStore: ReturnType<typeof createSyncStore> | null = null

/**
 * Get or create the sync store
 */
function getSyncStore(): ReturnType<typeof createSyncStore> {
  if (!syncStore) {
    syncStore = createSyncStore()
  }
  return syncStore
}

/**
 * Reset the sync store (for testing)
 */
export function resetSyncStore(): void {
  syncStore = null
}

/**
 * Stable empty sync-config default (review P5). Using a module-level constant
 * (not an inline `= {}`) keeps the identity stable across renders so the init
 * effect — which lists `syncConfig` in its dependencies — does not tear down and
 * recreate the service on every render (which would reset the in-memory pull
 * cursor and force repeated full-snapshot pulls).
 */
const EMPTY_SYNC_CONFIG: Partial<Parameters<typeof createSynchronizationService>[1]> = {}

// ============================================================================
// Hook
// ============================================================================

/**
 * Custom hook for managing synchronization state
 *
 * @param options - Configuration options for the sync hook
 * @returns Sync state and actions
 */
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
  // Active profile drives profile-scoped pulls; a switch must reset the pull
  // cursor (review P7) so the newly-active profile gets a full snapshot rather
  // than a delta from the previous profile's (higher) cursor.
  const activeProfileId = useProfileStore((s) => s.activeProfileId)
  const syncServiceRef = useRef<SynchronizationService | null>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Guards against overlapping pulls (auto-poll vs manual) — debounce/skip when
  // a pull is already in flight.
  const pullInFlightRef = useRef(false)

  // Initialize sync service on first render
  useEffect(() => {
    // Create the synchronization service with custom processOperation
    // that calls the server sync function
    syncServiceRef.current = createSynchronizationService(userId, {
      autoSync: false, // We'll handle auto-sync ourselves
      // Push transport (Story 5-15): goes over HTTP to POST /api/sync/batch via
      // sendSyncOperation. Replaces the old direct import of the server function,
      // which dragged `@budget-planner/db` into the client graph (5-12 hazard).
      processOperation: sendSyncOperation as ProcessOperationFn,
      // Stamp the active profile onto every queued op so profile-scoped entities
      // satisfy the server's `profileId NOT NULL`. Read lazily at creation; a
      // later profile switch updates it via updateConfig (see effect below) rather
      // than recreating the service.
      profileId: useProfileStore.getState().activeProfileId ?? undefined,
      // Pull transport (Story 4-18): goes over HTTP to /api/sync/changes. The
      // active profile is read lazily at call time so a profile switch is
      // reflected without re-creating the service. Never imports the server fn.
      fetchServerChanges: ((since: number | null) =>
        fetchServerChangesHttp(
          since,
          pullLimit,
          useProfileStore.getState().activeProfileId ?? undefined
        )) as FetchServerChangesFn,
      ...syncConfig,
    })

    // Initialize the service
    syncServiceRef.current.initialize().catch((error) => {
      console.error('Failed to initialize sync service:', error)
    })

    // Subscribe to status changes
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
        isSyncing: false, // Will be set to true during sync
        retryCount: state.retryCount,
      })
    })

    // Subscribe to pulled changes: write them into the UI stores (Story 4-18).
    // The core emits applied changes; the web layer owns the store writes.
    const unsubscribeChanges = syncServiceRef.current.onChangesPulled((changes: ServerChange[]) => {
      applyServerChangesToStores(changes)
      const svc = syncServiceRef.current
      store.getState().setState({
        lastPullTimestamp: svc ? svc.getState().lastPullTimestamp : null,
        changesPulledCount: changes.length,
      })
    })

    // Cleanup on unmount
    return () => {
      unsubscribe()
      unsubscribeChanges()
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
      syncServiceRef.current?.destroy()
      syncServiceRef.current = null
    }
  }, [userId, syncConfig, store, pullLimit])

  // Sync state from store
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
    // useShallow: the selector returns a fresh object each call; without a
    // shallow comparator any repeated store write (Story 4-18 auto-poll fires
    // setState on an interval) would drive an infinite re-render loop, since
    // useSyncExternalStore sees a new snapshot reference on every notify.
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

  // Derived state
  const hasPendingChanges = pendingCount > 0
  const hasConflicts = conflictCount > 0
  const hasFailures = failedCount > 0

  // Handle sync status changes
  const handleStatusChange = useCallback(
    (isSyncingFlag: boolean) => {
      store.getState().setState({ isSyncing: isSyncingFlag })
    },
    [store]
  )

  // Manual sync
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

  // Force sync (bypasses debounce)
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

  // Pull server → client changes (AC-5 manual trigger; AC-4 auto-poll reuses it).
  // Skips if a pull is already in flight so overlapping triggers debounce.
  const pull = useCallback(async (): Promise<PullResult | undefined> => {
    if (!syncServiceRef.current || pullInFlightRef.current) {
      return undefined
    }
    pullInFlightRef.current = true
    try {
      const result = await syncServiceRef.current.pull()
      // Store writes happen via the onChangesPulled subscription; here we only
      // surface pull status/counters for UI (success/failure indication).
      store.getState().setState({
        lastPullTimestamp: result.lastPullTimestamp,
        changesPulledCount: result.changesPulledCount,
        lastError: result.success ? undefined : result.error,
      })
      return result
    } catch (error) {
      console.error('Pull failed:', error)
      return undefined
    } finally {
      pullInFlightRef.current = false
    }
  }, [store])

  // Force pull is an alias for pull (symmetry with forceSync).
  const forcePull = pull

  // Automatic polling (AC-4): pull on an interval while online. SSR-safe — the
  // effect (and timer) only run client-side after mount. The server enforces the
  // paid-tier gate, so a non-paid poll simply errors and is ignored.
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

  // React to an active-profile switch (review P7 + Story 5-15):
  //  1. Re-stamp the PUSH config so subsequently-queued ops carry the new
  //     profileId (profile-scoped entities require `profileId NOT NULL` server-side).
  //  2. Reset the PULL cursor: the cursor is global but the delta is profile-scoped,
  //     so a switch must force a full snapshot or the newly-active profile would
  //     miss every row older than the previous profile's cursor.
  // No-op on first mount (cursor already null).
  useEffect(() => {
    syncServiceRef.current?.updateConfig({ profileId: activeProfileId ?? undefined })
    syncServiceRef.current?.resetPullCursor()
  }, [activeProfileId])

  // Queue operations
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

      // Trigger debounced sync if auto-sync is enabled
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
      baseVersion?: number
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
        baseVersion
      )

      // Trigger debounced sync if auto-sync is enabled
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

      // The server's delete validation requires `userId` inside the operation
      // data payload, so pass it explicitly rather than relying on the default
      // empty object (which would be rejected as "Delete operations require userId").
      await syncServiceRef.current.queueDelete(
        entityType,
        entityId,
        userId,
        { userId },
        baseVersion
      )

      // Trigger debounced sync if auto-sync is enabled
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

  // Reset the sync state
  const reset = useCallback(() => {
    store.getState().reset()
  }, [store])

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [])

  return useMemo(
    () => ({
      // State
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

      // Derived state
      hasPendingChanges,
      hasConflicts,
      hasFailures,

      // Actions
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

// ============================================================================
// Status Indicators
// ============================================================================

/**
 * ⚠️ `PARTIAL` was missing from all three maps below while
 * `server/api/sync.ts:1044` genuinely produces it ("completed with some conflicts
 * but no failures"). The getters' `|| 'Unknown'` fallbacks meant a
 * partially-successful sync displayed as "Unknown ❓" in grey — reading as an
 * error state for a sync that mostly worked. `Record<SyncStatus, string>` was
 * always the right type; it just could not be checked until the module resolved.
 */
export const SYNC_STATUS_LABELS: Record<SyncStatus, string> = {
  [SyncStatusEnum.PENDING]: 'Pending',
  [SyncStatusEnum.IN_PROGRESS]: 'Syncing...',
  [SyncStatusEnum.COMPLETED]: 'Synced',
  [SyncStatusEnum.FAILED]: 'Sync Failed',
  [SyncStatusEnum.CONFLICT]: 'Conflicts',
  [SyncStatusEnum.PARTIAL]: 'Partially Synced',
  [SyncStatusEnum.OFFLINE]: 'Offline',
}

/**
 * Sync status indicator icons (can be replaced with actual icons)
 */
export const SYNC_STATUS_ICONS: Record<SyncStatus, string> = {
  [SyncStatusEnum.PENDING]: '⏳',
  [SyncStatusEnum.IN_PROGRESS]: '🔄',
  [SyncStatusEnum.COMPLETED]: '✅',
  [SyncStatusEnum.FAILED]: '❌',
  [SyncStatusEnum.CONFLICT]: '⚠️',
  [SyncStatusEnum.PARTIAL]: '⚠️',
  [SyncStatusEnum.OFFLINE]: '📵',
}

/**
 * Sync status color classes for Tailwind CSS
 */
export const SYNC_STATUS_COLORS: Record<SyncStatus, string> = {
  [SyncStatusEnum.PENDING]: 'text-yellow-500',
  [SyncStatusEnum.IN_PROGRESS]: 'text-blue-500',
  [SyncStatusEnum.COMPLETED]: 'text-green-500',
  [SyncStatusEnum.FAILED]: 'text-red-500',
  [SyncStatusEnum.CONFLICT]: 'text-orange-500',
  [SyncStatusEnum.PARTIAL]: 'text-orange-500',
  [SyncStatusEnum.OFFLINE]: 'text-gray-500',
}

/**
 * Get sync status label
 */
export function getSyncStatusLabel(status: SyncStatus): string {
  return SYNC_STATUS_LABELS[status] || 'Unknown'
}

/**
 * Get sync status icon
 */
export function getSyncStatusIcon(status: SyncStatus): string {
  return SYNC_STATUS_ICONS[status] || '❓'
}

/**
 * Get sync status color class
 */
export function getSyncStatusColor(status: SyncStatus): string {
  return SYNC_STATUS_COLORS[status] || 'text-gray-500'
}

// Re-export SyncStatus enum for convenience
export { SyncStatusEnum as SyncStatus }
