/**
 * The live sync service's "clear my queue" handle (story 86.1, FR139).
 *
 * `purgeLocalFinancialData` ("Clear local data", account deletion) must clear the
 * queue the RUNNING sync service writes, not just its storage key: the service
 * keeps the queue in memory, and every queue write is a whole-queue write, so a
 * storage-only clear is undone by the service's next write.
 *
 * WHY NOT `syncBridge`: the bridge is registered only once the active profile is
 * reconciled (`ActiveSync`), but the service loads its persisted queue as soon as
 * it is created. A purge in between would find no bridge while a live queue
 * exists. This handle is registered by `useSync` the moment it creates the
 * service, and removed in the same cleanup that destroys it.
 *
 * Like the bridge, it imports nothing: `lib/account` → here is one-way, and this
 * module never reaches a store (see the import-cycle note in `syncBridge.ts`).
 */

export interface SyncPurgeHandle {
  /** The user whose queue the live service writes. */
  userId: string
  /** Empty that queue in memory and storage (`SynchronizationService.clearQueue`). */
  clearQueue: () => Promise<void>
}

let current: SyncPurgeHandle | null = null

/**
 * Register the live service's handle. Returns its unregister function, which
 * removes THIS handle only: an older cleanup that runs after a newer service has
 * registered (a re-render, an account switch) must not unregister the newer one.
 */
export function registerSyncPurgeHandle(handle: SyncPurgeHandle): () => void {
  current = handle
  return () => {
    if (current === handle) {
      current = null
    }
  }
}

/** The live handle for `userId`, or `null` when none is registered for that user. */
export function getSyncPurgeHandle(userId: string): SyncPurgeHandle | null {
  return current !== null && current.userId === userId ? current : null
}
