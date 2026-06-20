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

import type { SyncOperation, SyncQueueStorage } from './types'
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
}

/**
 * Interface for IndexedDB storage (alternative to localStorage)
 * This provides more storage capacity for large sync queues
 */
export interface IndexedDBSyncQueueStorage extends SyncQueueStorage {}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: Required<OfflineQueueConfig> = {
  storage: new LocalStorageSyncQueueStorage(),
  maxRetries: 3,
  baseRetryDelay: 1000, // 1 second
  maxRetryDelay: 30000, // 30 seconds
  useExponentialBackoff: true,
  showNotifications: true,
  debug: false,
}

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

  constructor() {
    this.initialize()
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
  }

  async loadQueue(userId: string): Promise<SyncOperation[]> {
    try {
      if (!this.dbPromise) {
        return []
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
    } catch {
      // Fallback to localStorage if IndexedDB fails
      const storage = new LocalStorageSyncQueueStorage()
      return storage.loadQueue(userId)
    }
  }

  async saveQueue(userId: string, queue: SyncOperation[]): Promise<void> {
    try {
      if (!this.dbPromise) {
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
    } catch {
      // Fallback to localStorage if IndexedDB fails
      const storage = new LocalStorageSyncQueueStorage()
      await storage.saveQueue(userId, queue)
    }
  }

  async clearQueue(userId: string): Promise<void> {
    try {
      if (!this.dbPromise) {
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
    } catch {
      // Fallback to localStorage if IndexedDB fails
      const storage = new LocalStorageSyncQueueStorage()
      await storage.clearQueue(userId)
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
  private config: Required<OfflineQueueConfig>
  private isOffline: boolean
  private retryCount: number = 0
  private processing: boolean = false
  private retryTimeout: ReturnType<typeof setTimeout> | null = null
  
  private statusCallbacks: Set<OfflineStatusCallback> = new Set()
  private processingCallbacks: Set<QueueProcessingCallback> = new Set()
  private notificationCallbacks: Set<SyncNotificationCallback> = new Set()

  /**
   * Create a new OfflineQueueManager
   * @param userId - The user ID for this queue
   * @param config - Configuration options
   */
  constructor(userId: string, config: OfflineQueueConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.isOffline = typeof navigator !== 'undefined' ? !navigator.onLine : false
    this.queue = new SyncQueue(userId, this.config.storage)
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
      window.addEventListener('online', this.handleOnline.bind(this))
      window.addEventListener('offline', this.handleOffline.bind(this))
      
      // Check initial online status
      this.isOffline = !navigator.onLine
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
      window.removeEventListener('online', this.handleOnline.bind(this))
      window.removeEventListener('offline', this.handleOffline.bind(this))
    }

    this.statusCallbacks.clear()
    this.processingCallbacks.clear()
    this.notificationCallbacks.clear()
  }

  /**
   * Handle coming online
   */
  private handleOnline(): void {
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
   */
  async processQueue(): Promise<void> {
    if (this.isOffline || this.processing) {
      return
    }

    this.processing = true
    this.retryCount = 0
    this.notifyProcessingCallbacks()

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
          // Simulate API call
          await this.simulateSyncOperation(operation)
          
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
   * Simulate sync operation (placeholder for actual API call)
   * @param _operation - The sync operation (unused in simulation)
   */
  private async simulateSyncOperation(_operation: SyncOperation): Promise<void> {
    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 100))
    
    // Simulate random failures for testing retry logic
    if (Math.random() < 0.1) { // 10% failure rate for testing
      throw new Error('Simulated sync failure')
    }
  }

  /**
   * Schedule a retry with exponential backoff
   */
  private scheduleRetry(): void {
    if (this.retryCount >= this.config.maxRetries) {
      this.log('Max retries reached')
      this.notify('Max retry attempts reached. Please check your connection.', 'error')
      return
    }

    this.retryCount++
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
   */
  onStatusChange(callback: OfflineStatusCallback): () => void {
    this.statusCallbacks.add(callback)
    return () => this.statusCallbacks.delete(callback)
  }

  /**
   * Add a callback for queue processing status changes
   */
  onProcessingChange(callback: QueueProcessingCallback): () => void {
    this.processingCallbacks.add(callback)
    return () => this.processingCallbacks.delete(callback)
  }

  /**
   * Add a callback for sync notifications
   */
  onNotification(callback: SyncNotificationCallback): () => void {
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
 */
export function createOfflineQueueManager(
  userId: string,
  config?: OfflineQueueConfig
): OfflineQueueManager {
  return new OfflineQueueManager(userId, config)
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
