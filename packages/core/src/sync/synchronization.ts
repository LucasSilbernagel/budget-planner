/**
 * Synchronization Service
 * 
 * Core synchronization service for multi-device data synchronization in the paid tier.
 * Implements offline-first strategy with conflict resolution.
 * 
 * Key Features:
 * - Automatic sync when online
 * - Queue persistence for offline changes
 * - Last-write-wins conflict resolution
 * - Status tracking and error handling
 * - Retry logic for failed operations
 */

import { SyncQueue, createSyncQueue, LocalStorageSyncQueueStorage } from './queue'
import type {
  SyncOperation,
  SyncOperationType,
  SyncEntityType,
  SyncState,
  SyncConfig,
  SyncResult,
  SyncStatusCallback,
  ConflictCallback,
  ConflictResult,
  ConflictType,
  ConflictResolutionStrategy,
} from './types'
import { SyncStatus } from './types'

/**
 * Default configuration for the synchronization service
 */
const DEFAULT_CONFIG: SyncConfig = {
  conflictResolutionStrategy: 'last-write-wins',
  maxRetries: 3,
  retryDelay: 5000, // 5 seconds
  batchSize: 50,
  autoSync: true,
  autoSyncInterval: 30000, // 30 seconds
  debug: false,
}

/**
 * Generates a unique ID for sync operations
 */
function generateOperationId(): string {
  return `sync-op-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Generates a device ID for the current device
 * Uses localStorage to maintain consistency across page refreshes
 */
function generateDeviceId(): string {
  const storageKey = 'bp-device-id'
  
  try {
    let deviceId = localStorage.getItem(storageKey)
    if (!deviceId) {
      deviceId = `device-${Math.random().toString(36).substr(2, 16)}`
      localStorage.setItem(storageKey, deviceId)
    }
    return deviceId
  } catch {
    // If localStorage is not available, generate a non-persistent ID
    return `device-${Math.random().toString(36).substr(2, 16)}`
  }
}

/**
 * Synchronization Service
 * 
 * Main service class for managing data synchronization between devices.
 * Implements offline-first strategy with automatic retry and conflict resolution.
 */
export class SynchronizationService {
  private queue: SyncQueue
  private config: SyncConfig
  private state: SyncState
  private deviceId: string
  private statusCallbacks: Set<SyncStatusCallback> = new Set()
  private conflictCallbacks: Set<ConflictCallback> = new Set()
  private autoSyncTimer: ReturnType<typeof setInterval> | null = null
  private isProcessing: boolean = false
  private retryTimeout: ReturnType<typeof setTimeout> | null = null

  /**
   * Create a new SynchronizationService instance
   * @param userId - The user ID for synchronization
   * @param config - Optional configuration overrides
   */
  constructor(userId: string, config: Partial<SyncConfig> = {}) {
    this.deviceId = generateDeviceId()
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.queue = createSyncQueue(userId)
    this.state = this.createInitialState()
  }

  /**
   * Create the initial sync state
   */
  private createInitialState(): SyncState {
    return {
      status: SyncStatus.PENDING,
      lastSyncTimestamp: null,
      pendingOperations: [],
      failedOperations: [],
      conflictOperations: [],
      isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
      retryCount: 0,
    }
  }

  /**
   * Initialize the synchronization service
   * Loads the queue from storage and sets up event listeners
   */
  async initialize(): Promise<void> {
    // Load the queue from storage
    await this.queue.initialize()
    
    // Update state with pending operations
    this.state.pendingOperations = this.queue.getAll()
    
    // Set up online/offline event listeners if in browser
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline.bind(this))
      window.addEventListener('offline', this.handleOffline.bind(this))
      
      // Check initial online status
      this.state.isOnline = navigator.onLine
    }

    // Start auto-sync if enabled
    if (this.config.autoSync) {
      this.startAutoSync()
    }

    // Notify callbacks of initial state
    this.notifyStatusCallbacks()
  }

  /**
   * Start automatic synchronization
   */
  startAutoSync(): void {
    if (this.autoSyncTimer) {
      return // Already running
    }

    this.autoSyncTimer = setInterval(() => {
      if (this.state.isOnline && !this.isProcessing) {
        this.sync().catch((error) => {
          this.log('Auto-sync error:', error)
        })
      }
    }, this.config.autoSyncInterval)
  }

  /**
   * Stop automatic synchronization
   */
  stopAutoSync(): void {
    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer)
      this.autoSyncTimer = null
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.stopAutoSync()
    
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout)
      this.retryTimeout = null
    }

    // Remove event listeners if in browser
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline.bind(this))
      window.removeEventListener('offline', this.handleOffline.bind(this))
    }

    this.statusCallbacks.clear()
    this.conflictCallbacks.clear()
  }

  /**
   * Handle coming online
   */
  private handleOnline(): void {
    this.state.isOnline = true
    this.log('Device is now online')
    
    // Process queued operations
    if (this.queue.getCount() > 0) {
      this.sync().catch((error) => {
        this.log('Online sync error:', error)
      })
    }

    this.notifyStatusCallbacks()
  }

  /**
   * Handle going offline
   */
  private handleOffline(): void {
    this.state.isOnline = false
    this.log('Device is now offline')
    this.notifyStatusCallbacks()
  }

  /**
   * Add a callback for sync status changes
   * @param callback - The callback function
   */
  onStatusChange(callback: SyncStatusCallback): () => void {
    this.statusCallbacks.add(callback)
    return () => this.statusCallbacks.delete(callback)
  }

  /**
   * Add a callback for conflict detection
   * @param callback - The callback function
   */
  onConflict(callback: ConflictCallback): () => void {
    this.conflictCallbacks.add(callback)
    return () => this.conflictCallbacks.delete(callback)
  }

  /**
   * Notify all status callbacks
   */
  private notifyStatusCallbacks(): void {
    this.statusCallbacks.forEach((callback) => {
      try {
        callback({ ...this.state })
      } catch (error) {
        this.log('Status callback error:', error)
      }
    })
  }

  /**
   * Notify all conflict callbacks
   * @param conflict - The conflict result
   */
  private notifyConflictCallbacks(conflict: ConflictResult): void {
    this.conflictCallbacks.forEach((callback) => {
      try {
        callback({ ...conflict })
      } catch (error) {
        this.log('Conflict callback error:', error)
      }
    })
  }

  /**
   * Queue a create operation
   * @param entityType - The type of entity
   * @param entityId - The ID of the entity
   * @param data - The entity data
   * @param userId - The user ID
   */
  async queueCreate(
    entityType: SyncEntityType,
    entityId: string | number,
    data: Record<string, unknown>,
    userId: string
  ): Promise<SyncOperation> {
    const operation: SyncOperation = {
      id: generateOperationId(),
      type: 'create',
      entityType,
      entityId,
      data,
      timestamp: Date.now(),
      deviceId: this.deviceId,
      userId,
    }

    await this.queue.add(operation)
    this.state.pendingOperations = this.queue.getAll()
    this.notifyStatusCallbacks()

    // If online and auto-sync is enabled, trigger sync
    if (this.state.isOnline && this.config.autoSync && !this.isProcessing) {
      this.sync().catch((error) => {
        this.log('Create queue sync error:', error)
      })
    }

    return operation
  }

  /**
   * Queue an update operation
   * @param entityType - The type of entity
   * @param entityId - The ID of the entity
   * @param data - The updated entity data
   * @param userId - The user ID
   * @param version - Optional version number
   */
  async queueUpdate(
    entityType: SyncEntityType,
    entityId: string | number,
    data: Record<string, unknown>,
    userId: string,
    version?: number
  ): Promise<SyncOperation> {
    const operation: SyncOperation = {
      id: generateOperationId(),
      type: 'update',
      entityType,
      entityId,
      data,
      timestamp: Date.now(),
      deviceId: this.deviceId,
      userId,
      version,
    }

    await this.queue.add(operation)
    this.state.pendingOperations = this.queue.getAll()
    this.notifyStatusCallbacks()

    // If online and auto-sync is enabled, trigger sync
    if (this.state.isOnline && this.config.autoSync && !this.isProcessing) {
      this.sync().catch((error) => {
        this.log('Update queue sync error:', error)
      })
    }

    return operation
  }

  /**
   * Queue a delete operation
   * @param entityType - The type of entity
   * @param entityId - The ID of the entity
   * @param userId - The user ID
   */
  async queueDelete(
    entityType: SyncEntityType,
    entityId: string | number,
    userId: string
  ): Promise<SyncOperation> {
    const operation: SyncOperation = {
      id: generateOperationId(),
      type: 'delete',
      entityType,
      entityId,
      data: {},
      timestamp: Date.now(),
      deviceId: this.deviceId,
      userId,
    }

    await this.queue.add(operation)
    this.state.pendingOperations = this.queue.getAll()
    this.notifyStatusCallbacks()

    // If online and auto-sync is enabled, trigger sync
    if (this.state.isOnline && this.config.autoSync && !this.isProcessing) {
      this.sync().catch((error) => {
        this.log('Delete queue sync error:', error)
      })
    }

    return operation
  }

  /**
   * Detect if there's a conflict between two operations
   * @param localOp - The local operation
   * @param serverOp - The server operation
   */
  detectConflict(localOp: SyncOperation, serverOp: SyncOperation): ConflictResult {
    // Check if operations are on the same entity
    if (localOp.entityType !== serverOp.entityType || localOp.entityId !== serverOp.entityId) {
      return { hasConflict: false }
    }

    // Check if operations are the same type
    if (localOp.type === serverOp.type) {
      // Same type of operation on same entity - generally not a conflict
      // unless it's an update with different data
      if (localOp.type === 'update') {
        // Check if the data is different
        const localDataStr = JSON.stringify(localOp.data)
        const serverDataStr = JSON.stringify(serverOp.data)
        
        if (localDataStr !== serverDataStr) {
          return {
            hasConflict: true,
            conflictType: 'version-mismatch',
            localOperation: localOp,
            serverOperation: serverOp,
          }
        }
      }
      
      return { hasConflict: false }
    }

    // Different operation types on same entity - this is a conflict
    let conflictType: ConflictType = 'version-mismatch'
    
    if (localOp.type === 'create' && serverOp.type === 'create') {
      conflictType = 'create-create'
    } else if (localOp.type === 'update' && serverOp.type === 'delete') {
      conflictType = 'update-delete'
    } else if (localOp.type === 'delete' && serverOp.type === 'update') {
      conflictType = 'delete-update'
    } else if (localOp.type === 'create' && serverOp.type === 'update') {
      conflictType = 'create-create' // Local created, server updated
    } else if (localOp.type === 'update' && serverOp.type === 'create') {
      conflictType = 'create-create' // Local updated, server created
    } else if (localOp.type === 'create' && serverOp.type === 'delete') {
      conflictType = 'update-delete' // Local created, server deleted
    } else if (localOp.type === 'delete' && serverOp.type === 'create') {
      conflictType = 'delete-update' // Local deleted, server created
    }

    return {
      hasConflict: true,
      conflictType,
      localOperation: localOp,
      serverOperation: serverOp,
    }
  }

  /**
   * Resolve a conflict between two operations
   * @param localOp - The local operation
   * @param serverOp - The server operation
   */
  resolveConflict(localOp: SyncOperation, serverOp: SyncOperation): SyncOperation {
    const conflictResult = this.detectConflict(localOp, serverOp)
    
    if (!conflictResult.hasConflict) {
      // No conflict, return the local operation
      return localOp
    }

    // Apply the configured conflict resolution strategy
    switch (this.config.conflictResolutionStrategy) {
      case 'server-wins':
        return serverOp
      
      case 'client-wins':
        return localOp
      
      case 'last-write-wins':
      default:
        // Last write wins based on timestamp
        // If timestamps are equal, prefer local operation
        return localOp.timestamp >= serverOp.timestamp ? localOp : serverOp
      
      case 'manual':
        // For manual resolution, we mark the conflict and let the user decide
        // In this case, we'll store the conflict and notify callbacks
        // The actual resolution will be handled by the UI
        this.state.conflictOperations.push(localOp)
        this.notifyStatusCallbacks()
        this.notifyConflictCallbacks(conflictResult)
        return localOp
      
      case 'merge':
        // Attempt to merge changes (only works for updates)
        if (localOp.type === 'update' && serverOp.type === 'update') {
          return {
            ...localOp,
            data: { ...serverOp.data, ...localOp.data },
          }
        }
        // Fall back to last-write-wins for non-mergeable conflicts
        return localOp.timestamp >= serverOp.timestamp ? localOp : serverOp
    }
  }

  /**
   * Sync all pending operations to the server
   * This is the main synchronization method
   */
  async sync(): Promise<SyncResult> {
    if (this.isProcessing) {
      return {
        success: false,
        synchronizedCount: 0,
        failedCount: 0,
        conflictCount: 0,
        state: { ...this.state },
        error: 'Sync already in progress',
        duration: 0,
      }
    }

    if (!this.state.isOnline) {
      return {
        success: false,
        synchronizedCount: 0,
        failedCount: 0,
        conflictCount: 0,
        state: { ...this.state },
        error: 'Device is offline',
        duration: 0,
      }
    }

    this.isProcessing = true
    this.state.status = SyncStatus.IN_PROGRESS
    this.state.lastError = undefined
    this.notifyStatusCallbacks()

    const startTime = Date.now()

    try {
      // Get operations to process (sorted by timestamp)
      const operations = this.queue.getReadyOperations(this.config.batchSize)
      
      if (operations.length === 0) {
        this.state.status = SyncStatus.COMPLETED
        this.state.lastSyncTimestamp = Date.now()
        this.notifyStatusCallbacks()
        
        return {
          success: true,
          synchronizedCount: 0,
          failedCount: 0,
          conflictCount: 0,
          state: { ...this.state },
          duration: Date.now() - startTime,
        }
      }

      // Process operations in batches
      let synchronizedCount = 0
      let failedCount = 0
      let conflictCount = 0
      const failedOperations: SyncOperation[] = []
      const conflictOperations: SyncOperation[] = []

      for (const operation of operations) {
        try {
          // Simulate sending to server (this would be replaced with actual API call)
          const result = await this.processOperation(operation)
          
          if (result.success) {
            // Remove from queue
            await this.queue.remove(operation.id)
            synchronizedCount++
          } else if (result.conflict) {
            // Conflict detected
            conflictOperations.push(operation)
            conflictCount++
          } else {
            // Failed
            failedOperations.push(operation)
            failedCount++
          }
        } catch (error) {
          this.log('Operation processing error:', error, operation)
          failedOperations.push(operation)
          failedCount++
        }
      }

      // Update state
      this.state.lastSyncTimestamp = Date.now()
      this.state.pendingOperations = this.queue.getAll()
      this.state.failedOperations = [...this.state.failedOperations, ...failedOperations]
      this.state.conflictOperations = [...this.state.conflictOperations, ...conflictOperations]
      
      // Determine final status
      if (failedCount > 0 || conflictCount > 0) {
        this.state.status = SyncStatus.FAILED
      } else {
        this.state.status = SyncStatus.COMPLETED
      }

      this.notifyStatusCallbacks()

      // Schedule retry for failed operations if retries remain
      if (failedCount > 0 && this.state.retryCount < this.config.maxRetries) {
        this.scheduleRetry()
      }

      return {
        success: failedCount === 0 && conflictCount === 0,
        synchronizedCount,
        failedCount,
        conflictCount,
        state: { ...this.state },
        duration: Date.now() - startTime,
      }
    } catch (error) {
      this.state.status = SyncStatus.FAILED
      this.state.lastError = error instanceof Error ? error.message : String(error)
      this.state.lastSyncTimestamp = Date.now()
      this.notifyStatusCallbacks()
      
      return {
        success: false,
        synchronizedCount: 0,
        failedCount: this.state.pendingOperations.length,
        conflictCount: 0,
        state: { ...this.state },
        error: this.state.lastError,
        duration: Date.now() - startTime,
      }
    } finally {
      this.isProcessing = false
    }
  }

  /**
   * Process a single operation
   * This is a placeholder that would be replaced with actual API calls
   * @param operation - The sync operation to process
   */
  private async processOperation(
    _operation: SyncOperation
  ): Promise<{ success: boolean; conflict?: boolean }> {
    // In a real implementation, this would make an API call to the server
    // For now, we'll simulate the behavior
    
    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 100))
    
    // For testing purposes, we'll assume success
    // In a real implementation, this would:
    // 1. Send the operation to the server
    // 2. Check for conflicts
    // 3. Apply conflict resolution if needed
    // 4. Return the result
    
    return { success: true }
  }

  /**
   * Schedule a retry for failed operations
   */
  private scheduleRetry(): void {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout)
    }

    this.retryTimeout = setTimeout(() => {
      this.state.retryCount++
      this.log(`Retry attempt ${this.state.retryCount}`)
      
      // Re-queue failed operations
      if (this.state.failedOperations.length > 0) {
        const failedOps = [...this.state.failedOperations]
        this.state.failedOperations = []
        
        failedOps.forEach((op) => {
          this.queue.add(op).catch((error) => {
            this.log('Failed to re-queue operation:', error)
          })
        })
        
        this.state.pendingOperations = this.queue.getAll()
        this.notifyStatusCallbacks()
        
        // Trigger sync
        if (this.state.isOnline) {
          this.sync().catch((error) => {
            this.log('Retry sync error:', error)
          })
        }
      }
    }, this.config.retryDelay)
  }

  /**
   * Manual sync trigger
   * Forces a sync regardless of auto-sync settings
   */
  async forceSync(): Promise<SyncResult> {
    return this.sync()
  }

  /**
   * Get the current sync state
   */
  getState(): SyncState {
    return { ...this.state }
  }

  /**
   * Get the sync queue
   */
  getQueue(): SyncQueue {
    return this.queue
  }

  /**
   * Get the device ID
   */
  getDeviceId(): string {
    return this.deviceId
  }

  /**
   * Get the current configuration
   */
  getConfig(): SyncConfig {
    return { ...this.config }
  }

  /**
   * Update the configuration
   * @param updates - Partial configuration updates
   */
  updateConfig(updates: Partial<SyncConfig>): void {
    this.config = { ...this.config, ...updates }
  }

  /**
   * Check if currently processing a sync
   */
  isSyncing(): boolean {
    return this.isProcessing
  }

  /**
   * Log a message (only in debug mode)
   */
  private log(message: string, ...args: unknown[]): void {
    if (this.config.debug) {
      console.log(`[SyncService] ${message}`, ...args)
    }
  }
}

/**
 * Create a synchronization service with default configuration
 * @param userId - The user ID for synchronization
 */
export function createSynchronizationService(
  userId: string,
  config?: Partial<SyncConfig>
): SynchronizationService {
  return new SynchronizationService(userId, config)
}

export type {
  SyncOperation,
  SyncOperationType,
  SyncEntityType,
  SyncState,
  SyncConfig,
  SyncResult,
  SyncStatusCallback,
  ConflictCallback,
  ConflictResult,
  ConflictType,
  ConflictResolutionStrategy,
}

export { SyncQueue, createSyncQueue, LocalStorageSyncQueueStorage, DEFAULT_CONFIG }
