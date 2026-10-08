import type { SyncOperation, SyncQueueStorage } from './types'

const MAX_QUEUE_SIZE = 10000

export class SyncQueueClosedError extends Error {
  constructor() {
    super('SyncQueue is closed: its sync service was destroyed, so it no longer writes')
    this.name = 'SyncQueueClosedError'
  }
}

class LocalStorageSyncQueueStorage implements SyncQueueStorage {
  private readonly storageKeyPrefix = 'bp-sync-queue'

  async loadQueue(userId: string): Promise<SyncOperation[]> {
    try {
      const key = `${this.storageKeyPrefix}-${userId}`
      const data = localStorage.getItem(key)
      if (!data) {
        return []
      }
      return JSON.parse(data) as SyncOperation[]
    } catch {
      return []
    }
  }

  async saveQueue(userId: string, queue: SyncOperation[]): Promise<void> {
    const key = `${this.storageKeyPrefix}-${userId}`
    try {
      localStorage.setItem(key, JSON.stringify(queue))
    } catch (error) {
      // Throw, never swallow: a failed save must not silently lose queued operations.
      throw new Error(
        `Failed to save sync queue to localStorage for user ${userId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  async clearQueue(userId: string): Promise<void> {
    const key = `${this.storageKeyPrefix}-${userId}`
    try {
      localStorage.removeItem(key)
    } catch (error) {
      console.error(`Failed to clear sync queue from localStorage for user ${userId}:`, error)
    }
  }
}

export class SyncQueue {
  private queue: SyncOperation[] = []
  private readonly userId: string
  private readonly storage: SyncQueueStorage

  // Every read → await storage → reassign of `this.queue` must go through `serialize()`:
  // callers often don't await, and interleaved mutators clobber each other's writes.
  private mutations: Promise<unknown> = Promise.resolve()

  private closed = false

  constructor(userId: string, storage?: SyncQueueStorage) {
    this.userId = userId
    this.storage = storage ?? new LocalStorageSyncQueueStorage()
  }

  /** A rejection doesn't poison the chain. Not re-entrant (a nested serialized call deadlocks),
   * and a storage write that never settles blocks every later mutation. */
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.mutations.then(work, work)
    this.mutations = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  /** A new service for the same user writes the same storage key, so a torn-down queue must
   * never write again. A plain flag flip, not serialized: `serialize` isn't re-entrant. */
  close(): void {
    this.closed = true
  }

  isClosed(): boolean {
    return this.closed
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new SyncQueueClosedError()
    }
  }

  /** A closed queue resolves without loading: rejecting would make `useSync` log a failure for
   * a normal remount. */
  async initialize(): Promise<void> {
    return this.serialize(async () => {
      if (this.closed) {
        return
      }
      this.queue = await this.storage.loadQueue(this.userId)
    })
  }

  async add(operation: SyncOperation): Promise<void> {
    return this.serialize(async () => {
      this.assertOpen()
      if (this.queue.length >= MAX_QUEUE_SIZE) {
        throw new Error(
          `Queue size limit (${MAX_QUEUE_SIZE}) exceeded. Please sync existing operations before adding more.`
        )
      }

      // Persist before mutating memory so a storage failure can't leave the two diverged.
      const newQueue = [...this.queue, operation]
      await this.storage.saveQueue(this.userId, newQueue)
      this.queue = newQueue
    })
  }

  async addBatch(operations: SyncOperation[]): Promise<void> {
    return this.serialize(async () => {
      this.assertOpen()
      if (this.queue.length + operations.length > MAX_QUEUE_SIZE) {
        throw new Error(
          `Queue size limit (${MAX_QUEUE_SIZE}) would be exceeded. Current: ${this.queue.length}, Adding: ${operations.length}. Please sync existing operations before adding more.`
        )
      }

      const newQueue = [...this.queue, ...operations]
      await this.storage.saveQueue(this.userId, newQueue)
      this.queue = newQueue
    })
  }

  getAll(): SyncOperation[] {
    return [...this.queue]
  }

  getByEntityType(entityType: string): SyncOperation[] {
    return this.queue.filter((op) => op.entityType === entityType)
  }

  getByEntityId(entityId: string | number): SyncOperation[] {
    const normalizedEntityId = String(entityId)
    return this.queue.filter((op) => op.entityId === normalizedEntityId)
  }

  async remove(operationId: string): Promise<boolean> {
    return this.serialize(async () => {
      this.assertOpen()
      const filtered = this.queue.filter((op) => op.id !== operationId)

      if (filtered.length < this.queue.length) {
        await this.storage.saveQueue(this.userId, filtered)
        this.queue = filtered
        return true
      }

      return false
    })
  }

  async removeBatch(operationIds: string[]): Promise<number> {
    return this.serialize(async () => {
      this.assertOpen()
      const idsSet = new Set(operationIds)
      const filtered = this.queue.filter((op) => !idsSet.has(op.id))

      const removedCount = this.queue.length - filtered.length

      if (removedCount > 0) {
        await this.storage.saveQueue(this.userId, filtered)
        this.queue = filtered
      }

      return removedCount
    })
  }

  /** The one exception to persist-first: memory drops the ops even if the save fails, so a
   * permanently refused op stops replaying. Use only for ops that can never be accepted. */
  async discardBatch(operationIds: string[]): Promise<{ removed: number; persisted: boolean }> {
    return this.serialize(async () => {
      this.assertOpen()
      const idsSet = new Set(operationIds)
      const filtered = this.queue.filter((op) => !idsSet.has(op.id))
      const removed = this.queue.length - filtered.length

      if (removed === 0) {
        return { removed, persisted: true }
      }

      let persisted = true
      try {
        await this.storage.saveQueue(this.userId, filtered)
      } catch (error) {
        persisted = false
        console.error(
          'Failed to persist discarding sync operations; they are dropped from memory only:',
          error
        )
      }
      this.queue = filtered

      return { removed, persisted }
    })
  }

  async removeByEntity(entityType: string, entityId: string | number): Promise<number> {
    return this.serialize(async () => {
      this.assertOpen()
      const normalizedEntityId = String(entityId)
      const filtered = this.queue.filter(
        (op) => !(op.entityType === entityType && op.entityId === normalizedEntityId)
      )

      const removedCount = this.queue.length - filtered.length

      if (removedCount > 0) {
        await this.storage.saveQueue(this.userId, filtered)
        this.queue = filtered
      }

      return removedCount
    })
  }

  /** On a fresh instance while a live service runs, this empties storage only and the live
   * queue writes its ops back. Clear through the live service when one exists. */
  async clear(): Promise<void> {
    return this.serialize(async () => {
      this.assertOpen()
      await this.storage.clearQueue(this.userId)
      this.queue = []
    })
  }

  getCount(): number {
    return this.queue.length
  }

  isEmpty(): boolean {
    return this.queue.length === 0
  }

  peek(): SyncOperation | undefined {
    return this.queue[0]
  }

  async dequeue(): Promise<SyncOperation | undefined> {
    return this.serialize(async () => {
      this.assertOpen()
      if (this.queue.length === 0) {
        return undefined
      }

      const operation = this.queue[0]
      const remaining = this.queue.slice(1)
      await this.storage.saveQueue(this.userId, remaining)
      this.queue = remaining

      return operation
    })
  }

  getReadyOperations(limit?: number): SyncOperation[] {
    // Profile creates go first: dependents need the profile to exist server-side, and a
    // profile can be enqueued after them.
    const rank = (op: SyncOperation) =>
      op.entityType === 'userProfile' && op.type === 'create' ? 0 : 1
    const sorted = [...this.queue].sort((a, b) => rank(a) - rank(b) || a.timestamp - b.timestamp)

    // `limit === 0` must return an empty batch, not the whole queue.
    if (limit !== undefined) {
      return sorted.slice(0, Math.max(0, limit))
    }

    return sorted
  }

  getByUser(userId: string): SyncOperation[] {
    return this.queue.filter((op) => op.userId === userId)
  }

  hasPendingOperations(entityType: string, entityId: string | number): boolean {
    const normalizedEntityId = String(entityId)
    return this.queue.some(
      (op) => op.entityType === entityType && op.entityId === normalizedEntityId
    )
  }
}

export function createSyncQueue(userId: string): SyncQueue {
  return new SyncQueue(userId, undefined)
}

export { LocalStorageSyncQueueStorage }
