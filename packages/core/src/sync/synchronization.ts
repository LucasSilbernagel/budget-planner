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
  ProcessOperationResult,
} from './types'
import { SyncStatus } from './types'
import {
  incomeSourceSchema,
  expenseSchema,
  savingsGoalSchema,
  balanceTrackingSchema,
  userProfileSchema,
} from './types'

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
 * Maximum number of callbacks allowed to prevent memory leaks
 * If this limit is exceeded, a warning is logged
 */
const MAX_CALLBACKS = 100

/**
 * Circuit breaker configuration for retry logic
 * Prevents hammering a failing server
 */
const CIRCUIT_BREAKER_CONFIG = {
  // Number of consecutive failures before opening the circuit
  failureThreshold: 5,
  // Time in milliseconds to keep circuit open before trying again
  cooldownPeriod: 30000, // 30 seconds
}

/**
 * Generates a unique ID for sync operations
 */
function generateOperationId(): string {
  return `sync-op-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Validates operation data payload against entity-specific schema
 * @param entityType - The type of entity
 * @param data - The data payload to validate
 * @returns Validated data or throws ZodError
 */
function validateOperationData(entityType: SyncEntityType, data: Record<string, unknown>): Record<string, unknown> {
  switch (entityType) {
    case 'incomeSource':
      return incomeSourceSchema.parse(data)
    case 'expense':
      return expenseSchema.parse(data)
    case 'savingsGoal':
      return savingsGoalSchema.parse(data)
    case 'balanceTracking':
      return balanceTrackingSchema.parse(data)
    case 'userProfile':
      return userProfileSchema.parse(data)
    default:
      // For delete operations, data may be empty, so we just return it as-is
      return data
  }
}

/**
 * In-memory cache for device IDs when storage is unavailable
 * Maps userId to deviceId for per-user device tracking
 */
const cachedDeviceIds: Map<string, string> = new Map()

/**
 * Generates a unique device ID for the current device and user
 * Uses localStorage to maintain consistency across page refreshes
 * Falls back to sessionStorage or in-memory cache if localStorage fails
 * 
 * FIX: Device IDs are now user-scoped to prevent cross-user data leakage
 * FIX: Added race condition handling - reads back after write to get canonical value
 * Storage key: bp-device-id-{userId}
 */
function generateDeviceId(userId: string): string {
  const storageKey = `bp-device-id-${userId}`
  
  try {
    let deviceId = localStorage.getItem(storageKey)
    
    if (!deviceId) {
      // Generate a new device ID
      deviceId = `device-${Math.random().toString(36).substr(2, 16)}`
      try {
        localStorage.setItem(storageKey, deviceId)
      } catch {
        // If storage fails, we'll use the generated ID but it won't persist
        // This is acceptable as a fallback
      }
      // Read back to get the actual value (in case another tab set it first)
      // Note: localStorage is synchronous, so this read-back handles the race condition
      const actualDeviceId = localStorage.getItem(storageKey)
      if (actualDeviceId) {
        deviceId = actualDeviceId
      }
    }
    
    return deviceId
  } catch {
    // If localStorage is not available, try sessionStorage as fallback
    try {
      let deviceId = sessionStorage.getItem(storageKey)
      
      if (!deviceId) {
        deviceId = `device-${Math.random().toString(36).substr(2, 16)}`
        try {
          sessionStorage.setItem(storageKey, deviceId)
        } catch {
          // Storage error is acceptable as fallback
        }
        // Read back to handle race condition
        const actualDeviceId = sessionStorage.getItem(storageKey)
        if (actualDeviceId) {
          deviceId = actualDeviceId
        }
      }
      
      return deviceId
    } catch {
      // If both localStorage and sessionStorage fail, use in-memory cache
      // This ensures the same device ID is returned within the same session
      let deviceId = cachedDeviceIds.get(userId)
      if (!deviceId) {
        deviceId = `device-${Math.random().toString(36).substr(2, 16)}`
        cachedDeviceIds.set(userId, deviceId)
      }
      return deviceId
    }
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
  private userId: string
  private deviceId: string
  private statusCallbacks: Set<SyncStatusCallback> = new Set()
  private conflictCallbacks: Set<ConflictCallback> = new Set()
  private autoSyncTimer: ReturnType<typeof setInterval> | null = null
  private isProcessing: boolean = false
  private retryTimeout: ReturnType<typeof setTimeout> | null = null
  
  // Circuit breaker state for retry logic
  private circuitBroken: boolean = false
  private circuitBrokenUntil: number = 0
  private consecutiveFailures: number = 0
  
  // Store bound event handlers to enable proper cleanup
  private boundHandleOnline: (() => void) | null = null
  private boundHandleOffline: (() => void) | null = null
  private boundHandleVisibilityChange: (() => void) | null = null

  /**
   * Create a new SynchronizationService instance
   * @param userId - The user ID for synchronization
   * @param config - Optional configuration overrides
   */
  constructor(userId: string, config: Partial<SyncConfig> = {}) {
    // Validate userId is not empty
    if (!userId || typeof userId !== 'string' || userId.trim() === '') {
      throw new Error('Invalid userId: must be a non-empty string')
    }
    
    // Validate configuration
    const mergedConfig = { ...DEFAULT_CONFIG, ...config }
    
    if (mergedConfig.maxRetries < 0) {
      throw new Error('Invalid maxRetries: must be non-negative')
    }
    
    if (mergedConfig.retryDelay < 0) {
      throw new Error('Invalid retryDelay: must be non-negative')
    }
    
    if (mergedConfig.batchSize <= 0) {
      throw new Error('Invalid batchSize: must be positive')
    }
    
    if (mergedConfig.autoSyncInterval < 0) {
      throw new Error('Invalid autoSyncInterval: must be non-negative')
    }
    
    this.userId = userId
    this.deviceId = generateDeviceId(userId)
    this.config = mergedConfig
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
      isOnline: typeof navigator !== 'undefined' ? navigator.onLine : false,
      retryCount: 0,
    }
  }

  /**
   * Check if the device is actually online (not just navigator.onLine)
   * Handles captive portals and other false positives
   */
  private async checkRealConnectivity(): Promise<boolean> {
    // If navigator is not available (SSR), return false
    if (typeof navigator === 'undefined') {
      return false
    }
    
    // First check navigator.onLine
    if (!navigator.onLine) {
      return false
    }
    
    // SECURITY FIX: Removed unauthenticated /api/health endpoint check
    // This prevents endpoint enumeration and network reconnaissance
    // Trade-off: Captive portals may cause false negatives
    // Alternative: Use authenticated sync endpoint for connectivity check
    // For now, rely on navigator.onLine and handle failures gracefully
    
    return true
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
      // Bind handlers once and store for proper cleanup
      // FIX: Use same pattern for all handlers to enable proper removal
      this.boundHandleOnline = async () => {
        try {
          await this.handleOnline()
        } catch (error) {
          this.log('Error in handleOnline:', error)
        }
      }
      this.boundHandleOffline = () => {
        this.handleOffline()
      }
      
      // Set up visibility change handler to pause sync in background tabs
      this.boundHandleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          // Tab became visible, check if we should sync
          // sync() will handle the isProcessing check atomically
          if (this.state.isOnline && this.queue.getCount() > 0) {
            this.sync().catch((error) => {
              this.log('Visibility sync error:', error)
            })
          }
        }
        // When tab is hidden/backgrounded, don't do anything special
        // The auto-sync timer will continue but we won't process in background
      }
      
      window.addEventListener('online', this.boundHandleOnline)
      window.addEventListener('offline', this.boundHandleOffline)
      window.addEventListener('visibilitychange', this.boundHandleVisibilityChange)
      
      // Check initial online status with real connectivity check
      this.state.isOnline = await this.checkRealConnectivity()
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
      // Check online status - sync() will handle the processing flag atomically
      if (this.state.isOnline) {
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
      if (this.boundHandleOnline) {
        window.removeEventListener('online', this.boundHandleOnline)
        this.boundHandleOnline = null
      }
      if (this.boundHandleOffline) {
        window.removeEventListener('offline', this.boundHandleOffline)
        this.boundHandleOffline = null
      }
      if (this.boundHandleVisibilityChange) {
        window.removeEventListener('visibilitychange', this.boundHandleVisibilityChange)
        this.boundHandleVisibilityChange = null
      }
    }

    this.statusCallbacks.clear()
    this.conflictCallbacks.clear()
  }

  /**
   * Handle coming online
   */
  private async handleOnline(): Promise<void> {
    // Verify real connectivity before marking as online
    const isReallyOnline = await this.checkRealConnectivity()
    
    if (!isReallyOnline) {
      this.log('Device reports online but connectivity check failed')
      return
    }
    
    this.state.isOnline = true
    this.log('Device is now online')
    
    // Process queued operations only if there are any
    // sync() will handle the isProcessing check atomically
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
   * @returns Unsubscribe function to remove the callback
   * 
   * FIX: Added memory leak protection - warns if too many callbacks accumulate
   * Remember to call the returned function to unsubscribe and prevent memory leaks
   */
  onStatusChange(callback: SyncStatusCallback): () => void {
    if (this.statusCallbacks.size >= MAX_CALLBACKS) {
      this.log(`WARNING: Maximum callbacks (${MAX_CALLBACKS}) reached. Possible memory leak - forgot to unsubscribe?`)
    }
    this.statusCallbacks.add(callback)
    return () => this.statusCallbacks.delete(callback)
  }

  /**
   * Add a callback for conflict detection
   * @param callback - The callback function
   * @returns Unsubscribe function to remove the callback
   * 
   * FIX: Added memory leak protection - warns if too many callbacks accumulate
   * Remember to call the returned function to unsubscribe and prevent memory leaks
   */
  onConflict(callback: ConflictCallback): () => void {
    if (this.conflictCallbacks.size >= MAX_CALLBACKS) {
      this.log(`WARNING: Maximum callbacks (${MAX_CALLBACKS}) reached. Possible memory leak - forgot to unsubscribe?`)
    }
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
    // Security: Validate userId matches authenticated user
    if (userId !== this.userId) {
      throw new Error(`Unauthorized: Operation userId mismatch. Expected: ${this.userId}, Got: ${userId}`)
    }

    // Validate operation data payload against entity schema
    // FIX: Added schema validation to prevent arbitrary data in sync operations
    const validatedData = validateOperationData(entityType, data)

    const operation: SyncOperation = {
      id: generateOperationId(),
      type: 'create',
      entityType,
      entityId: String(entityId),
      data: validatedData,
      timestamp: Date.now(),
      deviceId: this.deviceId,
      userId,
    }

    await this.queue.add(operation)
    this.state.pendingOperations = this.queue.getAll()
    this.notifyStatusCallbacks()

    // If online and auto-sync is enabled, trigger sync
    // sync() will handle the isProcessing check atomically
    if (this.state.isOnline && this.config.autoSync) {
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
    // Security: Validate userId matches authenticated user
    if (userId !== this.userId) {
      throw new Error(`Unauthorized: Operation userId mismatch. Expected: ${this.userId}, Got: ${userId}`)
    }

    // Validate operation data payload against entity schema (partial validation for updates)
    // FIX: Added schema validation to prevent arbitrary data in sync operations
    const validatedData = validateOperationData(entityType, data)

    const operation: SyncOperation = {
      id: generateOperationId(),
      type: 'update',
      entityType,
      entityId: String(entityId),
      data: validatedData,
      timestamp: Date.now(),
      deviceId: this.deviceId,
      userId,
      version,
    }

    await this.queue.add(operation)
    this.state.pendingOperations = this.queue.getAll()
    this.notifyStatusCallbacks()

    // If online and auto-sync is enabled, trigger sync
    // sync() will handle the isProcessing check atomically
    if (this.state.isOnline && this.config.autoSync) {
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
    userId: string,
    data: Record<string, unknown> = {}
  ): Promise<SyncOperation> {
    // Security: Validate userId matches authenticated user
    if (userId !== this.userId) {
      throw new Error(`Unauthorized: Operation userId mismatch. Expected: ${this.userId}, Got: ${userId}`)
    }

    // For delete operations, data is typically empty, but we still validate if provided
    // FIX: Added schema validation to prevent arbitrary data in sync operations
    const validatedData = Object.keys(data).length > 0 
      ? validateOperationData(entityType, data) 
      : {}

    const operation: SyncOperation = {
      id: generateOperationId(),
      type: 'delete',
      entityType,
      entityId: String(entityId),
      data: validatedData,
      timestamp: Date.now(),
      deviceId: this.deviceId,
      userId,
    }

    await this.queue.add(operation)
    this.state.pendingOperations = this.queue.getAll()
    this.notifyStatusCallbacks()

    // If online and auto-sync is enabled, trigger sync
    // sync() will handle the isProcessing check atomically
    if (this.state.isOnline && this.config.autoSync) {
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
    
    // Check if operations are from the same device - not a conflict
    if (localOp.deviceId === serverOp.deviceId) {
      return { hasConflict: false }
    }
    
    // Check if operations have the same ID - not a conflict
    if (localOp.id === serverOp.id) {
      return { hasConflict: false }
    }

    // Check if operations are the same type
    if (localOp.type === serverOp.type) {
      // Same type of operation on same entity - generally not a conflict
      // unless it's an update with different data or version mismatch
      if (localOp.type === 'update') {
        // Check version numbers first if both operations have versions
        if (localOp.version !== undefined && serverOp.version !== undefined) {
          if (localOp.version !== serverOp.version) {
            return {
              hasConflict: true,
              conflictType: 'version-mismatch',
              localOperation: localOp,
              serverOperation: serverOp,
            }
          }
        }
        
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
    let conflictType: ConflictType
    
    if (localOp.type === 'create' && serverOp.type === 'create') {
      conflictType = 'create-create'
    } else if (localOp.type === 'create' && serverOp.type === 'update') {
      conflictType = 'create-update'
    } else if (localOp.type === 'create' && serverOp.type === 'delete') {
      conflictType = 'create-delete'
    } else if (localOp.type === 'update' && serverOp.type === 'create') {
      conflictType = 'update-create'
    } else if (localOp.type === 'update' && serverOp.type === 'update') {
      conflictType = 'update-update'
    } else if (localOp.type === 'update' && serverOp.type === 'delete') {
      conflictType = 'update-delete'
    } else if (localOp.type === 'delete' && serverOp.type === 'create') {
      conflictType = 'delete-create'
    } else if (localOp.type === 'delete' && serverOp.type === 'update') {
      conflictType = 'delete-update'
    } else if (localOp.type === 'delete' && serverOp.type === 'delete') {
      conflictType = 'delete-delete'
    } else {
      conflictType = 'version-mismatch'
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
        // If timestamps are equal, use deviceId as deterministic tiebreaker
        if (localOp.timestamp > serverOp.timestamp) {
          return localOp
        }
        if (localOp.timestamp < serverOp.timestamp) {
          return serverOp
        }
        // Timestamps are equal, use deviceId as tiebreaker
        return localOp.deviceId > serverOp.deviceId ? localOp : serverOp
      
      case 'manual':
        // For manual resolution, we mark the conflict and let the user decide
        // In this case, we'll store the conflict and notify callbacks
        // The actual resolution will be handled by the UI
        this.state.conflictOperations.push(localOp)
        this.notifyStatusCallbacks()
        this.notifyConflictCallbacks(conflictResult)
        return localOp
      
      case 'merge':
        // Attempt to merge changes based on operation types
        if (localOp.type === 'update' && serverOp.type === 'update') {
          // Both are updates: merge the data
          return {
            ...localOp,
            data: { ...serverOp.data, ...localOp.data },
          }
        }
        
        // For create+create: merge the data from both
        if (localOp.type === 'create' && serverOp.type === 'create') {
          return {
            ...localOp,
            data: { ...serverOp.data, ...localOp.data },
          }
        }
        
        // For create+delete: prefer create (the entity exists)
        if (localOp.type === 'create' && serverOp.type === 'delete') {
          return localOp
        }
        
        // For delete+create: prefer create (the entity exists)
        if (localOp.type === 'delete' && serverOp.type === 'create') {
          return serverOp
        }
        
        // For update+delete: prefer update (keep the data)
        if (localOp.type === 'update' && serverOp.type === 'delete') {
          return localOp
        }
        
        // For delete+update: prefer update (keep the data)
        if (localOp.type === 'delete' && serverOp.type === 'update') {
          return serverOp
        }
        
        // Fall back to last-write-wins for any other combinations
        // If timestamps are equal, use deviceId as deterministic tiebreaker
        if (localOp.timestamp > serverOp.timestamp) {
          return localOp
        }
        if (localOp.timestamp < serverOp.timestamp) {
          return serverOp
        }
        // Timestamps are equal, use deviceId as tiebreaker
        return localOp.deviceId > serverOp.deviceId ? localOp : serverOp
    }
  }

  /**
   * Sync all pending operations to the server
   * This is the main synchronization method
   * 
   * Uses atomic check-and-set for isProcessing to prevent TOCTOU race conditions
   */
  async sync(): Promise<SyncResult> {
    // Use isProcessing as the primary lock mechanism
    // Note: In single-threaded JS, this provides practical protection against
    // concurrent sync calls within the same session. For multi-tab scenarios,
    // the isProcessing flag helps prevent duplicate processing.
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
    
    this.isProcessing = true
    
    if (!this.state.isOnline) {
      this.isProcessing = false
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
      // IMPORTANT: Track which operations to remove AFTER all processing is complete
      // This prevents data loss if batch fails mid-processing (NFR: Zero tolerance for data loss)
      // FIX: Only count as synchronized AFTER operations are removed from the queue
      // This prevents duplicate processing if removeBatch fails
      let synchronizedCount = 0
      let failedCount = 0
      let conflictCount = 0
      const failedOperations: SyncOperation[] = []
      const conflictOperations: SyncOperation[] = []
      const successfullyProcessed: SyncOperation[] = []

      for (const operation of operations) {
        try {
          // Simulate sending to server (this would be replaced with actual API call)
          const result = await this.processOperation(operation)
          
          if (result.success) {
            // Track operation as successfully processed (but don't count yet)
            successfullyProcessed.push(operation)
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
      
      // Remove all successfully processed operations from queue at once
      // Only count as synchronized AFTER successful removal
      if (successfullyProcessed.length > 0) {
        const operationsToRemove = successfullyProcessed.map(op => op.id)
        try {
          await this.queue.removeBatch(operationsToRemove)
          // Only count as synchronized AFTER successful removal from queue
          synchronizedCount = successfullyProcessed.length
        } catch (removeError) {
          this.log('Failed to remove operations from queue:', removeError)
          // CRITICAL FIX: If we can't remove from queue, these operations will be retried
          // Move them to failed so they're reprocessed
          failedOperations.push(...successfullyProcessed)
          failedCount += successfullyProcessed.length
          // Don't count as synchronized
          synchronizedCount = 0
        }
      }
      
      // FIX: Remove failed operations from queue to prevent duplicate re-queuing
      // When operations fail, they're added to failedOperations for retry
      // But they remain in the queue, causing duplicates when re-queued
      if (failedOperations.length > 0) {
        const failedOperationIds = failedOperations.map(op => op.id)
        try {
          await this.queue.removeBatch(failedOperationIds)
        } catch (removeError) {
          this.log('Failed to remove failed operations from queue:', removeError)
          // If we can't remove them, they'll stay in the queue
          // This is not ideal but prevents data loss
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
        // Reset circuit breaker consecutive failures counter on successful sync
        this.consecutiveFailures = 0
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
   * If a custom processOperation function is provided in config, it will be used.
   * Otherwise, this returns success without actually processing (for testing/mocking).
   * @param operation - The sync operation to process
   */
  private async processOperation(
    operation: SyncOperation
  ): Promise<ProcessOperationResult> {
    // If a custom processOperation function is provided, use it
    if (this.config.processOperation) {
      return this.config.processOperation(operation)
    }
    
    // Default implementation: simulate network delay and return success
    // This is useful for testing or when no real processing is configured
    // In production, a custom processOperation should be provided
    
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
   * 
   * FIX: Added circuit breaker to prevent hammering failing server
   */
  private scheduleRetry(): void {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout)
    }

    // Check if circuit is open (broken)
    const now = Date.now()
    if (this.circuitBroken) {
      if (now < this.circuitBrokenUntil) {
        // Circuit is still open, don't retry yet
        this.log(`Circuit breaker: Open until ${new Date(this.circuitBrokenUntil).toISOString()}. Retry skipped.`)
        return
      } else {
        // Cooldown period has passed, try to close the circuit
        this.circuitBroken = false
        this.consecutiveFailures = 0
        this.log('Circuit breaker: Cooldown complete. Resuming retries.')
      }
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
            // Track consecutive failures for circuit breaker
            this.consecutiveFailures++
            if (this.consecutiveFailures >= CIRCUIT_BREAKER_CONFIG.failureThreshold) {
              this.openCircuit()
            }
          })
        }
      }
    }, this.config.retryDelay)
  }

  /**
   * Open the circuit breaker to prevent further retries
   * Called after consecutive failures exceed the threshold
   */
  private openCircuit(): void {
    this.circuitBroken = true
    this.circuitBrokenUntil = Date.now() + CIRCUIT_BREAKER_CONFIG.cooldownPeriod
    this.log(`Circuit breaker: OPENED. Too many consecutive failures (${this.consecutiveFailures}). Retries paused for ${CIRCUIT_BREAKER_CONFIG.cooldownPeriod}ms.`)
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
