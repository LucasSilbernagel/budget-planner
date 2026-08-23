/**
 * Sync Module Index
 *
 * Exports all synchronization-related functionality for the budget planner.
 */

export {
  SynchronizationService,
  createSynchronizationService,
  SyncQueue,
  createSyncQueue,
  LocalStorageSyncQueueStorage,
  DEFAULT_CONFIG,
} from './synchronization'

export { SyncStatus } from './types'

export {
  OfflineQueueManager,
  createOfflineQueueManager,
  IndexedDBSyncQueueStorageImpl,
  isBrowserOffline,
} from './offline'

export type {
  SyncOperation,
  SyncOperationType,
  SyncEntityType,
  SyncState,
  SyncConfig,
  SyncResult,
  SyncQueueStorage,
  SyncStatusCallback,
  ConflictCallback,
  ConflictResult,
  ConflictType,
  ConflictResolutionStrategy,
  ServerChange,
  PullResult,
  FetchServerChangesFn,
  ChangesPulledCallback,
  // Exported from `./types` but omitted from this barrel, so the two consumers
  // that import them from `@budget-planner/core/sync` — `hooks/useSync.ts` and
  // `server/functions/sync.ts` — could not resolve them.
  ProcessOperationFn,
  ProcessOperationResult,
} from './types'

export type {
  OfflineQueueConfig,
  OfflineStatusCallback,
  QueueProcessingCallback,
  SyncNotificationCallback,
  IndexedDBSyncQueueStorage,
} from './offline'
