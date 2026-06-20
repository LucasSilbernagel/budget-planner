/**
 * Sync Queue Module
 * 
 * Manages the offline-first queue for synchronization operations.
 * Operations are queued when offline and processed when back online.
 */

import type {
  SyncOperation,
  SyncQueueStorage,
} from './types'

/**
 * Default storage implementation using localStorage
 * This provides persistence across page refreshes
 */
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
      // If localStorage fails (e.g., in SSR or private mode), return empty array
      return []
    }
  }

  async saveQueue(userId: string, queue: SyncOperation[]): Promise<void> {
    try {
      const key = `${this.storageKeyPrefix}-${userId}`
      localStorage.setItem(key, JSON.stringify(queue))
    } catch {
      // Silently fail if localStorage is not available
    }
  }

  async clearQueue(userId: string): Promise<void> {
    try {
      const key = `${this.storageKeyPrefix}-${userId}`
      localStorage.removeItem(key)
    } catch {
      // Silently fail if localStorage is not available
    }
  }
}

/**
 * SyncQueue class manages the offline-first queue for sync operations
 */
export class SyncQueue {
  private queue: SyncOperation[] = []
  private readonly userId: string
  private readonly storage: SyncQueueStorage
  private readonly maxQueueSize: number

  /**
   * Create a new SyncQueue instance
   * @param userId - The user ID for this queue
   * @param storage - Optional persistent storage for the queue
   * @param maxQueueSize - Maximum number of operations to keep in queue (default: 1000)
   */
  constructor(
    userId: string,
    storage?: SyncQueueStorage,
    maxQueueSize: number = 1000
  ) {
    this.userId = userId
    this.storage = storage ?? new LocalStorageSyncQueueStorage()
    this.maxQueueSize = maxQueueSize
  }

  /**
   * Initialize the queue by loading from storage
   */
  async initialize(): Promise<void> {
    this.queue = await this.storage.loadQueue(this.userId)
  }

  /**
   * Add an operation to the queue
   * @param operation - The sync operation to add
   */
  async add(operation: SyncOperation): Promise<void> {
    // Add to in-memory queue
    this.queue.push(operation)

    // Enforce max queue size
    if (this.queue.length > this.maxQueueSize) {
      this.queue = this.queue.slice(-this.maxQueueSize)
    }

    // Persist to storage
    await this.storage.saveQueue(this.userId, this.queue)
  }

  /**
   * Add multiple operations to the queue
   * @param operations - Array of sync operations to add
   */
  async addBatch(operations: SyncOperation[]): Promise<void> {
    this.queue.push(...operations)

    // Enforce max queue size
    if (this.queue.length > this.maxQueueSize) {
      this.queue = this.queue.slice(-this.maxQueueSize)
    }

    // Persist to storage
    await this.storage.saveQueue(this.userId, this.queue)
  }

  /**
   * Get all operations in the queue
   */
  getAll(): SyncOperation[] {
    return [...this.queue]
  }

  /**
   * Get operations by entity type
   * @param entityType - The entity type to filter by
   */
  getByEntityType(entityType: string): SyncOperation[] {
    return this.queue.filter((op) => op.entityType === entityType)
  }

  /**
   * Get operations by entity ID
   * @param entityId - The entity ID to filter by
   */
  getByEntityId(entityId: string | number): SyncOperation[] {
    return this.queue.filter((op) => op.entityId === entityId)
  }

  /**
   * Remove an operation from the queue by ID
   * @param operationId - The ID of the operation to remove
   */
  async remove(operationId: string): Promise<boolean> {
    const initialLength = this.queue.length
    this.queue = this.queue.filter((op) => op.id !== operationId)
    
    if (this.queue.length < initialLength) {
      await this.storage.saveQueue(this.userId, this.queue)
      return true
    }
    
    return false
  }

  /**
   * Remove multiple operations from the queue
   * @param operationIds - Array of operation IDs to remove
   */
  async removeBatch(operationIds: string[]): Promise<number> {
    const idsSet = new Set(operationIds)
    const initialLength = this.queue.length
    this.queue = this.queue.filter((op) => !idsSet.has(op.id))
    
    const removedCount = initialLength - this.queue.length
    
    if (removedCount > 0) {
      await this.storage.saveQueue(this.userId, this.queue)
    }
    
    return removedCount
  }

  /**
   * Remove operations by entity type and ID
   * @param entityType - The entity type
   * @param entityId - The entity ID
   */
  async removeByEntity(
    entityType: string,
    entityId: string | number
  ): Promise<number> {
    const initialLength = this.queue.length
    this.queue = this.queue.filter(
      (op) => !(op.entityType === entityType && op.entityId === entityId)
    )
    
    const removedCount = initialLength - this.queue.length
    
    if (removedCount > 0) {
      await this.storage.saveQueue(this.userId, this.queue)
    }
    
    return removedCount
  }

  /**
   * Clear all operations from the queue
   */
  async clear(): Promise<void> {
    this.queue = []
    await this.storage.clearQueue(this.userId)
  }

  /**
   * Get the count of operations in the queue
   */
  getCount(): number {
    return this.queue.length
  }

  /**
   * Check if the queue is empty
   */
  isEmpty(): boolean {
    return this.queue.length === 0
  }

  /**
   * Get the next operation in the queue (FIFO)
   */
  peek(): SyncOperation | undefined {
    return this.queue[0]
  }

  /**
   * Remove and return the next operation in the queue (FIFO)
   */
  async dequeue(): Promise<SyncOperation | undefined> {
    const operation = this.queue.shift()
    
    if (operation) {
      await this.storage.saveQueue(this.userId, this.queue)
    }
    
    return operation
  }

  /**
   * Get operations that are ready to be processed (sorted by timestamp)
   * @param limit - Maximum number of operations to return
   */
  getReadyOperations(limit?: number): SyncOperation[] {
    // Sort by timestamp (oldest first)
    const sorted = [...this.queue].sort((a, b) => a.timestamp - b.timestamp)
    
    if (limit) {
      return sorted.slice(0, limit)
    }
    
    return sorted
  }

  /**
   * Filter operations by user ID
   * @param userId - The user ID to filter by
   */
  getByUser(userId: string): SyncOperation[] {
    return this.queue.filter((op) => op.userId === userId)
  }

  /**
   * Check if an entity has pending operations
   * @param entityType - The entity type
   * @param entityId - The entity ID
   */
  hasPendingOperations(
    entityType: string,
    entityId: string | number
  ): boolean {
    return this.queue.some(
      (op) => op.entityType === entityType && op.entityId === entityId
    )
  }
}

/**
 * Create a sync queue with localStorage persistence
 * @param userId - The user ID for this queue
 * @param maxQueueSize - Maximum number of operations to keep in queue
 */
export function createSyncQueue(
  userId: string,
  maxQueueSize?: number
): SyncQueue {
  return new SyncQueue(userId, undefined, maxQueueSize)
}

export { LocalStorageSyncQueueStorage }
