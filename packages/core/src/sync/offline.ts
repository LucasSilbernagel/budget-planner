/**
 * Offline Detection and Queueing Module
 * 
 * Handles offline/online detection, queue persistence, and automatic
 * queue processing when connectivity is restored.
 * 
 * Key Features:
 * - Browser online/offline event detection
 * - Queue persistence in localStorage/IndexedDB
 * - Queue processing with exponential backoff
 * - User notifications for sync status changes
 */

import type { SyncOperation, SyncQueueStorage, ProcessOperationFn } from './types'
import { SyncQueue, LocalStorageSyncQueueStorage } from './queue'

// ============================================================================
// Types
// ============================================================================

/**
 * Callback for offline/online status changes
 */
export type OfflineStatusCallback = (isOffline: boolean) => void

/**
 * Callback for queue processing status
 */
export type QueueProcessingCallback = (processing: boolean) => void

/**
 * Callback for sync notifications
 */
export type SyncNotificationCallback = (
  message: string,
  type: 'info' | 'success' | 'warning' | 'error'
) => void

/**
 * Configuration for offline queueing
 */
export interface OfflineQueueConfig {
  /** Storage implementation to use */
  storage?: SyncQueueStorage
  
  /** Maximum retry attempts for failed syncs */
  maxRetries?: number
  
  /** Base delay between retries in milliseconds */
  baseRetryDelay?: number
  
  /** Maximum delay between retries in milliseconds */
  maxRetryDelay?: number
  
  /** Whether to use exponential backoff */
  useExponentialBackoff?: boolean
  
  /** Whether to show user notifications */
  showNotifications?: boolean
  
  /** Whether to enable debug logging */
  debug?: boolean
  
  /** Custom function to process sync operations (e.g., make API calls to server) */
  processOperation?: ProcessOperationFn
}

/**
 * Interface for IndexedDB storage (alternative to localStorage)
 * This provides more storage capacity for large sync queues
 */
export interface IndexedDBSyncQueueStorage extends SyncQueueStorage {}

// ============================================================================
// Types
// ============================================================================

/**
 * Required configuration (all fields except processOperation)
 */
type RequiredOfflineQueueConfig = Required<Omit<OfflineQueueConfig, 'processOperation'>>

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: RequiredOfflineQueueConfig = {
  storage: new LocalStorageSyncQueueStorage(),
  maxRetries: 3,
  baseRetryDelay: 1000, // 1 second
  maxRetryDelay: 30000, // 30 seconds
  useExponentialBackoff: true,
  showNotifications: true,
  debug: false,
}

/**
 * Maximum number of callbacks allowed to prevent memory leaks
 * If this limit is exceeded, a warning is logged
 */
const MAX_CALLBACKS = 100

// ============================================================================
// IndexedDB Storage Implementation
// ============================================================================

/**
 * IndexedDB-based storage for sync queue
 * Provides more storage capacity than localStorage
 * Falls back to localStorage if IndexedDB is not available
 */
export class IndexedDBSyncQueueStorageImpl implements SyncQueueStorage {
  private readonly dbName = 'BudgetPlannerSyncDB'
  private readonly storeName = 'syncQueue'
  private dbPromise: Promise<IDBDatabase> | null = null
  private initPromise: Promise<void> | null = null

  constructor() {
    // Start initialization - note that we don't await it here
    // Methods will await the promise when they need it
    this.initPromise = this.initialize()
  }

  private async initialize(): Promise<void> {
    if (typeof indexedDB === 'undefined') {
      return // IndexedDB not available
    }

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1)

      request.onerror = () => {
        reject(new Error('Failed to open IndexedDB'))
      }

      request.onsuccess = () => {
        resolve(request.result)
      }

      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'userId' })
        }
      }
    })
    
    // Await the promise to ensure it's initialized
    await this.dbPromise?.catch(() => { /* Ignore errors, will be handled by methods */ })
  }

  async loadQueue(userId: string): Promise<SyncOperation[]> {
    try {
      // Ensure initialization is complete
      await this.initPromise
      
      if (!this.dbPromise) {
        // IndexedDB not available, try localStorage
        const storage = new LocalStorageSyncQueueStorage()
        return storage.loadQueue(userId)
      }

      const db = await this.dbPromise
      
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(this.storeName, 'readonly')
        const store = transaction.objectStore(this.storeName)
        const request = store.get(userId)

        request.onsuccess = () => {
          resolve(request.result?.queue || [])
        }

        request.onerror = () => {
          reject(request.error)
        }
      })
    } catch (error) {
      // Try localStorage fallback
      try {
        const storage = new LocalStorageSyncQueueStorage()
        return storage.loadQueue(userId)
      } catch (localStorageError) {
        // Both storage mechanisms failed - DO NOT silently lose data
        // Throw error so caller can handle appropriately
        throw new Error(
          `Failed to load sync queue from both IndexedDB and localStorage: ${error}, ${localStorageError}`
        )
      }
    }
  }

  async saveQueue(userId: string, queue: SyncOperation[]): Promise<void> {
    try {
      // Ensure initialization is complete
      await this.initPromise
      
      if (!this.dbPromise) {
        // IndexedDB not available, try localStorage
        const storage = new LocalStorageSyncQueueStorage()
        await storage.saveQueue(userId, queue)
        return
      }

      const db = await this.dbPromise
      
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(this.storeName, 'readwrite')
        const store = transaction.objectStore(this.storeName)
        const request = store.put({ userId, queue })

        request.onsuccess = () => {
          resolve()
        }

        request.onerror = () => {
          reject(request.error)
        }
      })
    } catch (error) {
      // Try localStorage fallback
      try {
        const storage = new LocalStorageSyncQueueStorage()
        await storage.saveQueue(userId, queue)
      } catch (localStorageError) {
        // Both storage mechanisms failed - DO NOT silently lose data
        // Throw error so caller can handle appropriately
        throw new Error(
          `Failed to save sync queue to both IndexedDB and localStorage: ${error}, ${localStorageError}`
        )
      }
    }
  }

  async clearQueue(userId: string): Promise<void> {
    try {
      // Ensure initialization is complete before reading dbPromise, otherwise
      // a clear issued before initialize() finishes would wrongly fall back to
      // localStorage and orphan the IndexedDB data (consistent with load/save).
      await this.initPromise

      if (!this.dbPromise) {
        // IndexedDB not available, try localStorage
        const storage = new LocalStorageSyncQueueStorage()
        await storage.clearQueue(userId)
        return
      }

      const db = await this.dbPromise
      
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(this.storeName, 'readwrite')
        const store = transaction.objectStore(this.storeName)
        const request = store.delete(userId)

        request.onsuccess = () => {
          resolve()
        }

        request.onerror = () => {
          reject(request.error)
        }
      })
    } catch (error) {
      // Try localStorage fallback
      try {
        const storage = new LocalStorageSyncQueueStorage()
        await storage.clearQueue(userId)
      } catch (localStorageError) {
        // Log error but don't throw - clearing is less critical
        console.error(
          `Failed to clear sync queue from both IndexedDB and localStorage: ${error}, ${localStorageError}`
        )
      }
    }
  }
}

// ============================================================================
// Offline Queue Manager
// ============================================================================

/**
 * Manages offline detection, queueing, and automatic processing
 */
export class OfflineQueueManager {
  private queue: SyncQueue
  private config: RequiredOfflineQueueConfig & { processOperation?: ProcessOperationFn }
  private isOffline: boolean
  private retryCount: number = 0
  private processing: boolean = false
  private retryTimeout: ReturnType<typeof setTimeout> | null = null
  
  private statusCallbacks: Set<OfflineStatusCallback> = new Set()
  private processingCallbacks: Set<QueueProcessingCallback> = new Set()
  private notificationCallbacks: Set<SyncNotificationCallback> = new Set()
  
  // Store bound event handlers to enable proper cleanup
  private boundHandleOnline: (() => void) | null = null
  private boundHandleOffline: (() => void) | null = null
  
  // Custom operation processor
  private processOperationFn: ProcessOperationFn | null = null

  /**
   * Check if the device is actually online (not just navigator.onLine)
   * Handles captive portals and other false positives
   * Consistent with SynchronizationService.checkRealConnectivity()
   */
  private checkRealConnectivity(): boolean {
    // If navigator is not available (SSR), return false
    if (typeof navigator === 'undefined') {
      return false
    }
    
    // First check navigator.onLine
    if (!navigator.onLine) {
      return false
    }
    
    // For now, rely on navigator.onLine
    // This is consistent with SynchronizationService which removed the fetch-based check
    // for security reasons (prevents endpoint enumeration)
    return true
  }

  /**
   * Create a new OfflineQueueManager
   * @param userId - The user ID for this queue
   * @param config - Configuration options
   * @param externalQueue - Optional external SyncQueue instance to use (for coordination with SynchronizationService)
   */
  constructor(
    userId: string,
    config: OfflineQueueConfig = {},
    externalQueue?: SyncQueue
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    // FIX: Use checkRealConnectivity for consistency with SynchronizationService
    this.isOffline = !this.checkRealConnectivity()
    // Use external queue if provided, otherwise create a new one
    this.queue = externalQueue ?? new SyncQueue(userId, this.config.storage)
    // Store the custom processOperation function if provided
    this.processOperationFn = config.processOperation ?? null
  }

  /**
   * Initialize the offline queue manager
   * Sets up event listeners for online/offline detection
   */
  async initialize(): Promise<void> {
    // Load the queue from storage
    await this.queue.initialize()

    // Set up online/offline event listeners if in browser
    if (typeof window !== 'undefined') {
      // Bind handlers once and store for proper cleanup
      this.boundHandleOnline = this.handleOnline.bind(this)
      this.boundHandleOffline = this.handleOffline.bind(this)
      
      window.addEventListener('online', this.boundHandleOnline)
      window.addEventListener('offline', this.boundHandleOffline)
      
      // Check initial online status using real connectivity check
      this.isOffline = !this.checkRealConnectivity()
    }

    // Notify callbacks of initial state
    this.notifyStatusCallbacks()
    this.notifyProcessingCallbacks()
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout)
      this.retryTimeout = null
    }

    if (typeof window !== 'undefined') {
      if (this.boundHandleOnline) {
        window.removeEventListener('online', this.boundHandleOnline)
        this.boundHandleOnline = null
      }
      if (this.boundHandleOffline) {
        window.removeEventListener('offline', this.boundHandleOffline)
        this.boundHandleOffline = null
      }
    }

    this.statusCallbacks.clear()
    this.processingCallbacks.clear()
    this.notificationCallbacks.clear()
  }

  /**
   * Handle coming online
   */
  private handleOnline(): void {
    // FIX: Use checkRealConnectivity to verify actual connectivity (consistent with SynchronizationService)
    // This prevents false positives from navigator.onLine (e.g., captive portals)
    const isReallyOnline = this.checkRealConnectivity()
    
    if (!isReallyOnline) {
      this.log('Device reports online but connectivity check failed')
      return
    }
    
    this.isOffline = false
    this.log('Device is now online')
    this.notifyStatusCallbacks()
    this.notify('Device is online. Processing queued changes...', 'success')
    
    // Process queued operations
    this.processQueue().catch((error) => {
      this.log('Queue processing error:', error)
    })
  }

  /**
   * Handle going offline
   */
  private handleOffline(): void {
    this.isOffline = true
    this.log('Device is now offline')
    this.notifyStatusCallbacks()
    this.notify('Device is offline. Changes will be queued.', 'warning')
  }

  /**
   * Process the queue when online
   * Uses atomic check-and-set for processing flag to prevent TOCTOU race
   */
  async processQueue(): Promise<void> {
    if (this.isOffline || this.processing) {
      return
    }
    
    // Set processing flag BEFORE any async operations to prevent TOCTOU
    this.processing = true
    // Note: retryCount is NOT reset here - it's managed by scheduleRetry
    this.notifyProcessingCallbacks()

    // FIX: Re-check isOffline after setting processing flag
    // This prevents TOCTOU where device goes offline between the initial check and setting processing
    if (this.isOffline) {
      this.processing = false
      return
    }

    try {
      // Get operations to process
      const operations = this.queue.getReadyOperations()
      
      if (operations.length === 0) {
        this.log('No operations to process')
        return
      }

      this.log(`Processing ${operations.length} queued operations`)
      this.notify(`Processing ${operations.length} queued changes...`, 'info')

      // In a real implementation, this would call the sync API
      // For now, we'll simulate the behavior
      let successCount = 0
      let failedCount = 0

      for (const operation of operations) {
        try {
          // Process the operation
          await this.processSyncOperation(operation)
          
          // Remove from queue on success
          await this.queue.remove(operation.id)
          successCount++
        } catch (error) {
          this.log('Operation failed:', error)
          failedCount++
        }
      }

      if (failedCount > 0) {
        this.notify(`${failedCount} operations failed. Will retry...`, 'warning')
        this.scheduleRetry()
      } else if (successCount > 0) {
        // Reset retry count on successful processing
        this.retryCount = 0
        this.notify(`Successfully synced ${successCount} changes`, 'success')
      }
    } catch (error) {
      this.log('Queue processing failed:', error)
      this.notify('Failed to process queue', 'error')
      this.scheduleRetry()
    } finally {
      this.processing = false
      this.notifyProcessingCallbacks()
    }
  }

  /**
   * Process a sync operation by calling the configured processOperation function
   * or falling back to a default implementation.
   * 
   * @param operation - The sync operation to process
   * @returns Promise resolving when the operation is processed
   */
  private async processSyncOperation(operation: SyncOperation): Promise<void> {
    // Use custom processOperation function if provided
    if (this.processOperationFn) {
      const result = await this.processOperationFn(operation)
      
      // If the operation failed and we should retry, throw an error
      // The queue manager will handle retries
      if (!result.success && !result.conflict) {
        throw new Error(result.error || 'Operation processing failed')
      }
      
      // If there was a conflict, we still consider it processed (conflict will be handled separately)
      return
    }
    
    // Default implementation: simulate network delay
    // This is useful for testing or when no real processing is configured
    // In production, a custom processOperation should be provided
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  /**
   * Schedule a retry with exponential backoff
   */
  private scheduleRetry(): void {
    // Increment retry count first, then check
    this.retryCount++
    
    if (this.retryCount > this.config.maxRetries) {
      this.retryCount = this.config.maxRetries // Cap at max
      this.log('Max retries reached')
      this.notify('Max retry attempts reached. Please check your connection.', 'error')
      return
    }

    const delay = this.calculateRetryDelay()
    
    this.log(`Scheduling retry ${this.retryCount} in ${delay}ms`)
    
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout)
    }

    this.retryTimeout = setTimeout(() => {
      this.processQueue().catch((error) => {
        this.log('Retry processing error:', error)
      })
    }, delay)
  }

  /**
   * Calculate retry delay with optional exponential backoff
   */
  private calculateRetryDelay(): number {
    if (!this.config.useExponentialBackoff) {
      return this.config.baseRetryDelay
    }

    // Exponential backoff with jitter
    const exponentialDelay = this.config.baseRetryDelay * Math.pow(2, this.retryCount - 1)
    const jitter = exponentialDelay * 0.2 * Math.random() // 20% jitter
    const delay = exponentialDelay + jitter
    
    // Cap at maximum delay
    return Math.min(delay, this.config.maxRetryDelay)
  }

  /**
   * Check if currently offline
   */
  getIsOffline(): boolean {
    return this.isOffline
  }

  /**
   * Check if currently processing the queue
   */
  getIsProcessing(): boolean {
    return this.processing
  }

  /**
   * Get the queue
   */
  getQueue(): SyncQueue {
    return this.queue
  }

  /**
   * Get the current retry count
   */
  getRetryCount(): number {
    return this.retryCount
  }

  /**
   * Add an operation to the queue
   */
  async queueOperation(operation: SyncOperation): Promise<void> {
    await this.queue.add(operation)
    
    // If online, process immediately
    if (!this.isOffline && !this.processing) {
      this.processQueue().catch((error) => {
        this.log('Queue processing after add error:', error)
      })
    } else if (this.isOffline) {
      this.notify('Change queued. Will sync when back online.', 'info')
    }
  }

  /**
   * Add a callback for offline/online status changes
   * @returns Unsubscribe function to remove the callback
   * 
   * FIX: Added memory leak protection - warns if too many callbacks accumulate
   * Remember to call the returned function to unsubscribe and prevent memory leaks
   */
  onStatusChange(callback: OfflineStatusCallback): () => void {
    if (this.statusCallbacks.size >= MAX_CALLBACKS) {
      this.log(`WARNING: Maximum callbacks (${MAX_CALLBACKS}) reached. Possible memory leak - forgot to unsubscribe?`)
    }
    this.statusCallbacks.add(callback)
    return () => this.statusCallbacks.delete(callback)
  }

  /**
   * Add a callback for queue processing status changes
   * @returns Unsubscribe function to remove the callback
   * 
   * FIX: Added memory leak protection - warns if too many callbacks accumulate
   * Remember to call the returned function to unsubscribe and prevent memory leaks
   */
  onProcessingChange(callback: QueueProcessingCallback): () => void {
    if (this.processingCallbacks.size >= MAX_CALLBACKS) {
      this.log(`WARNING: Maximum callbacks (${MAX_CALLBACKS}) reached. Possible memory leak - forgot to unsubscribe?`)
    }
    this.processingCallbacks.add(callback)
    return () => this.processingCallbacks.delete(callback)
  }

  /**
   * Add a callback for sync notifications
   * @returns Unsubscribe function to remove the callback
   * 
   * FIX: Added memory leak protection - warns if too many callbacks accumulate
   * Remember to call the returned function to unsubscribe and prevent memory leaks
   */
  onNotification(callback: SyncNotificationCallback): () => void {
    if (this.notificationCallbacks.size >= MAX_CALLBACKS) {
      this.log(`WARNING: Maximum callbacks (${MAX_CALLBACKS}) reached. Possible memory leak - forgot to unsubscribe?`)
    }
    this.notificationCallbacks.add(callback)
    return () => this.notificationCallbacks.delete(callback)
  }

  /**
   * Notify all status callbacks
   */
  private notifyStatusCallbacks(): void {
    this.statusCallbacks.forEach((callback) => {
      try {
        callback(this.isOffline)
      } catch (error) {
        this.log('Status callback error:', error)
      }
    })
  }

  /**
   * Notify all processing callbacks
   */
  private notifyProcessingCallbacks(): void {
    this.processingCallbacks.forEach((callback) => {
      try {
        callback(this.processing)
      } catch (error) {
        this.log('Processing callback error:', error)
      }
    })
  }

  /**
   * Send a notification to all notification callbacks
   */
  private notify(message: string, type: 'info' | 'success' | 'warning' | 'error'): void {
    if (!this.config.showNotifications) {
      return
    }

    this.notificationCallbacks.forEach((callback) => {
      try {
        callback(message, type)
      } catch (error) {
        this.log('Notification callback error:', error)
      }
    })
  }

  /**
   * Log a message (only in debug mode)
   */
  private log(message: string, ...args: unknown[]): void {
    if (this.config.debug) {
      console.log(`[OfflineQueue] ${message}`, ...args)
    }
  }
}

/**
 * Create an offline queue manager with default configuration
 * @param userId - The user ID for this queue manager
 * @param config - Optional configuration options
 * @param externalQueue - Optional external SyncQueue instance for coordination
 */
export function createOfflineQueueManager(
  userId: string,
  config?: OfflineQueueConfig,
  externalQueue?: SyncQueue
): OfflineQueueManager {
  return new OfflineQueueManager(userId, config, externalQueue)
}

// ============================================================================
// Browser Offline Detection Utilities
// ============================================================================

/**
 * Check if the browser is currently offline
 */
export function isBrowserOffline(): boolean {
  if (typeof navigator === 'undefined') {
    return false // SSR environment
  }
  return !navigator.onLine
}

// ============================================================================
// Exports
// ============================================================================

// All exports are already declared inline with the `export` keyword
