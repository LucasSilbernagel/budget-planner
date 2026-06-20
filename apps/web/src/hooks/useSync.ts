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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type {
  SyncState,
  SyncStatus,
  SyncResult,
  ProcessOperationFn,
} from '@budget-planner/core/sync'
import {
  SynchronizationService,
  createSynchronizationService,
  SyncStatus as SyncStatusEnum,
} from '@budget-planner/core/sync'
import { processSyncOperation } from '../server/functions/sync'

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
  
  /** Queue a create operation */
  queueCreate: (
    entityType: string,
    entityId: string | number,
    data: Record<string, unknown>
  ) => Promise<void>
  
  /** Queue an update operation */
  queueUpdate: (
    entityType: string,
    entityId: string | number,
    data: Record<string, unknown>,
    version?: number
  ) => Promise<void>
  
  /** Queue a delete operation */
  queueDelete: (entityType: string, entityId: string | number) => Promise<void>
  
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
  const { userId, autoSync = true, debounceDelay = 2000, syncConfig = {} } = options
  
  const store = getSyncStore()
  const syncServiceRef = useRef<SynchronizationService | null>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Initialize sync service on first render
  useEffect(() => {
    // Create the synchronization service with custom processOperation
    // that calls the server sync function
    syncServiceRef.current = createSynchronizationService(userId, {
      autoSync: false, // We'll handle auto-sync ourselves
      processOperation: processSyncOperation as ProcessOperationFn,
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
        lastError: state.lastError,
        isSyncing: false, // Will be set to true during sync
        retryCount: state.retryCount,
      })
    })

    // Cleanup on unmount
    return () => {
      unsubscribe()
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
      syncServiceRef.current?.destroy()
      syncServiceRef.current = null
    }
  }, [userId, syncConfig])

  // Sync state from store
  const {
    status,
    isOnline,
    pendingCount,
    failedCount,
    conflictCount,
    lastSyncTimestamp,
    lastError,
    isSyncing,
    retryCount,
  } = store(
    (state) => ({
      status: state.status,
      isOnline: state.isOnline,
      pendingCount: state.pendingCount,
      failedCount: state.failedCount,
      conflictCount: state.conflictCount,
      lastSyncTimestamp: state.lastSyncTimestamp,
      lastError: state.lastError,
      isSyncing: state.isSyncing,
      retryCount: state.retryCount,
    })
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

  // Queue operations
  const queueCreate = useCallback(
    async (
      entityType: string,
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
      entityType: string,
      entityId: string | number,
      data: Record<string, unknown>,
      version?: number
    ): Promise<void> => {
      if (!syncServiceRef.current) {
        throw new Error('Sync service not initialized')
      }
      
      await syncServiceRef.current.queueUpdate(entityType, entityId, data, userId, version)
      
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
    async (entityType: string, entityId: string | number): Promise<void> => {
      if (!syncServiceRef.current) {
        throw new Error('Sync service not initialized')
      }
      
      await syncServiceRef.current.queueDelete(entityType, entityId, userId)
      
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
      lastError,
      isSyncing,
      retryCount,
      hasPendingChanges,
      hasConflicts,
      hasFailures,
      sync,
      forceSync,
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
 * Sync status indicator labels
 */
export const SYNC_STATUS_LABELS: Record<SyncStatus, string> = {
  [SyncStatusEnum.PENDING]: 'Pending',
  [SyncStatusEnum.IN_PROGRESS]: 'Syncing...',
  [SyncStatusEnum.COMPLETED]: 'Synced',
  [SyncStatusEnum.FAILED]: 'Sync Failed',
  [SyncStatusEnum.CONFLICT]: 'Conflicts',
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
