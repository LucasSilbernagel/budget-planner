/**
 * Clears the live service's in-memory queue (a storage-only clear is undone by its next write).
 * Registered when the service is created, earlier than the sync bridge.
 */

export interface SyncPurgeHandle {
  userId: string
  clearQueue: () => Promise<void>
}

let current: SyncPurgeHandle | null = null

/** Removes only this handle: an older cleanup running after a newer registration must not remove it. */
export function registerSyncPurgeHandle(handle: SyncPurgeHandle): () => void {
  current = handle
  return () => {
    if (current === handle) {
      current = null
    }
  }
}

export function getSyncPurgeHandle(userId: string): SyncPurgeHandle | null {
  return current !== null && current.userId === userId ? current : null
}
