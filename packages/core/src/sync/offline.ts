import { LocalStorageSyncQueueStorage, SyncQueue } from './queue'
import type { ProcessOperationFn, SyncOperation, SyncQueueStorage } from './types'

export type OfflineStatusCallback = (isOffline: boolean) => void

export type QueueProcessingCallback = (processing: boolean) => void

export type SyncNotificationCallback = (
	message: string,
	type: 'info' | 'success' | 'warning' | 'error'
) => void

export interface OfflineQueueConfig {
	storage?: SyncQueueStorage

	maxRetries?: number

	baseRetryDelay?: number

	maxRetryDelay?: number

	useExponentialBackoff?: boolean

	showNotifications?: boolean

	debug?: boolean

	processOperation?: ProcessOperationFn
}

export interface IndexedDBSyncQueueStorage extends SyncQueueStorage {}

type RequiredOfflineQueueConfig = Required<Omit<OfflineQueueConfig, 'processOperation'>>

const DEFAULT_CONFIG: RequiredOfflineQueueConfig = {
	storage: new LocalStorageSyncQueueStorage(),
	maxRetries: 3,
	baseRetryDelay: 1000,
	maxRetryDelay: 30000,
	useExponentialBackoff: true,
	showNotifications: true,
	debug: false,
}

const MAX_CALLBACKS = 100

export class IndexedDBSyncQueueStorageImpl implements SyncQueueStorage {
	private readonly dbName = 'BudgetPlannerSyncDB'
	private readonly storeName = 'syncQueue'
	private dbPromise: Promise<IDBDatabase> | null = null
	private initPromise: Promise<void> | null = null

	constructor() {
		this.initPromise = this.initialize()
	}

	private async initialize(): Promise<void> {
		if (typeof indexedDB === 'undefined') {
			return
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

		await this.dbPromise?.catch(() => {})
	}

	async loadQueue(userId: string): Promise<SyncOperation[]> {
		try {
			await this.initPromise

			if (!this.dbPromise) {
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
			try {
				const storage = new LocalStorageSyncQueueStorage()
				return storage.loadQueue(userId)
			} catch (localStorageError) {
				// Both storages failed: throw rather than silently lose queued data.
				throw new Error(
					`Failed to load sync queue from both IndexedDB and localStorage: ${error}, ${localStorageError}`
				)
			}
		}
	}

	async saveQueue(userId: string, queue: SyncOperation[]): Promise<void> {
		try {
			await this.initPromise

			if (!this.dbPromise) {
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
			try {
				const storage = new LocalStorageSyncQueueStorage()
				await storage.saveQueue(userId, queue)
			} catch (localStorageError) {
				// Both storages failed: throw rather than silently lose queued data.
				throw new Error(
					`Failed to save sync queue to both IndexedDB and localStorage: ${error}, ${localStorageError}`
				)
			}
		}
	}

	async clearQueue(userId: string): Promise<void> {
		try {
			// Await init first, or an early clear would fall back to localStorage and orphan the
			// IndexedDB data.
			await this.initPromise

			if (!this.dbPromise) {
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
			try {
				const storage = new LocalStorageSyncQueueStorage()
				await storage.clearQueue(userId)
			} catch (localStorageError) {
				// Don't throw: clearing is less critical than saving.
				console.error(
					`Failed to clear sync queue from both IndexedDB and localStorage: ${error}, ${localStorageError}`
				)
			}
		}
	}
}

export class OfflineQueueManager {
	private queue: SyncQueue
	private config: RequiredOfflineQueueConfig & { processOperation?: ProcessOperationFn }
	private isOffline: boolean
	private retryCount = 0
	private processing = false
	private retryTimeout: ReturnType<typeof setTimeout> | null = null

	private statusCallbacks: Set<OfflineStatusCallback> = new Set()
	private processingCallbacks: Set<QueueProcessingCallback> = new Set()
	private notificationCallbacks: Set<SyncNotificationCallback> = new Set()

	private boundHandleOnline: (() => void) | null = null
	private boundHandleOffline: (() => void) | null = null

	private processOperationFn: ProcessOperationFn | null = null

	private checkRealConnectivity(): boolean {
		if (typeof navigator === 'undefined') {
			return false
		}

		if (!navigator.onLine) {
			return false
		}

		// No fetch-based probe, to avoid exposing an endpoint for enumeration.
		return true
	}

	constructor(userId: string, config: OfflineQueueConfig = {}, externalQueue?: SyncQueue) {
		this.config = { ...DEFAULT_CONFIG, ...config }
		this.isOffline = !this.checkRealConnectivity()
		this.queue = externalQueue ?? new SyncQueue(userId, this.config.storage)
		this.processOperationFn = config.processOperation ?? null
	}

	async initialize(): Promise<void> {
		await this.queue.initialize()

		if (typeof window !== 'undefined') {
			this.boundHandleOnline = this.handleOnline.bind(this)
			this.boundHandleOffline = this.handleOffline.bind(this)

			window.addEventListener('online', this.boundHandleOnline)
			window.addEventListener('offline', this.boundHandleOffline)

			this.isOffline = !this.checkRealConnectivity()
		}

		this.notifyStatusCallbacks()
		this.notifyProcessingCallbacks()
	}

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

	private handleOnline(): void {
		const isReallyOnline = this.checkRealConnectivity()

		if (!isReallyOnline) {
			this.log('Device reports online but connectivity check failed')
			return
		}

		this.isOffline = false
		this.log('Device is now online')
		this.notifyStatusCallbacks()
		this.notify('Device is online. Processing queued changes...', 'success')

		this.processQueue().catch((error) => {
			this.log('Queue processing error:', error)
		})
	}

	private handleOffline(): void {
		this.isOffline = true
		this.log('Device is now offline')
		this.notifyStatusCallbacks()
		this.notify('Device is offline. Changes will be queued.', 'warning')
	}

	async processQueue(): Promise<void> {
		if (this.isOffline || this.processing) {
			return
		}

		// Set before any await so a concurrent call sees it.
		this.processing = true
		// retryCount is managed by scheduleRetry, not reset here.
		this.notifyProcessingCallbacks()

		// Re-check: the device may have gone offline since the first check.
		if (this.isOffline) {
			this.processing = false
			return
		}

		try {
			const operations = this.queue.getReadyOperations()

			if (operations.length === 0) {
				this.log('No operations to process')
				return
			}

			this.log(`Processing ${operations.length} queued operations`)
			this.notify(`Processing ${operations.length} queued changes...`, 'info')

			let successCount = 0
			let failedCount = 0

			for (const operation of operations) {
				try {
					await this.processSyncOperation(operation)

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

	private async processSyncOperation(operation: SyncOperation): Promise<void> {
		if (this.processOperationFn) {
			const result = await this.processOperationFn(operation)

			if (!result.success && !result.conflict) {
				throw new Error(result.error || 'Operation processing failed')
			}

			// A conflict counts as processed; it is resolved separately.
			return
		}

		// No processor configured: simulate a network delay.
		await new Promise((resolve) => setTimeout(resolve, 100))
	}

	private scheduleRetry(): void {
		this.retryCount++

		if (this.retryCount > this.config.maxRetries) {
			this.retryCount = this.config.maxRetries
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

	private calculateRetryDelay(): number {
		if (!this.config.useExponentialBackoff) {
			return this.config.baseRetryDelay
		}

		const exponentialDelay = this.config.baseRetryDelay * 2 ** (this.retryCount - 1)
		const jitter = exponentialDelay * 0.2 * Math.random()
		const delay = exponentialDelay + jitter

		return Math.min(delay, this.config.maxRetryDelay)
	}

	getIsOffline(): boolean {
		return this.isOffline
	}

	getIsProcessing(): boolean {
		return this.processing
	}

	getQueue(): SyncQueue {
		return this.queue
	}

	getRetryCount(): number {
		return this.retryCount
	}

	async queueOperation(operation: SyncOperation): Promise<void> {
		await this.queue.add(operation)

		if (!this.isOffline && !this.processing) {
			this.processQueue().catch((error) => {
				this.log('Queue processing after add error:', error)
			})
		} else if (this.isOffline) {
			this.notify('Change queued. Will sync when back online.', 'info')
		}
	}

	onStatusChange(callback: OfflineStatusCallback): () => void {
		if (this.statusCallbacks.size >= MAX_CALLBACKS) {
			this.log(
				`WARNING: Maximum callbacks (${MAX_CALLBACKS}) reached. Possible memory leak - forgot to unsubscribe?`
			)
		}
		this.statusCallbacks.add(callback)
		return () => this.statusCallbacks.delete(callback)
	}

	onProcessingChange(callback: QueueProcessingCallback): () => void {
		if (this.processingCallbacks.size >= MAX_CALLBACKS) {
			this.log(
				`WARNING: Maximum callbacks (${MAX_CALLBACKS}) reached. Possible memory leak - forgot to unsubscribe?`
			)
		}
		this.processingCallbacks.add(callback)
		return () => this.processingCallbacks.delete(callback)
	}

	onNotification(callback: SyncNotificationCallback): () => void {
		if (this.notificationCallbacks.size >= MAX_CALLBACKS) {
			this.log(
				`WARNING: Maximum callbacks (${MAX_CALLBACKS}) reached. Possible memory leak - forgot to unsubscribe?`
			)
		}
		this.notificationCallbacks.add(callback)
		return () => this.notificationCallbacks.delete(callback)
	}

	private notifyStatusCallbacks(): void {
		for (const callback of this.statusCallbacks) {
			try {
				callback(this.isOffline)
			} catch (error) {
				this.log('Status callback error:', error)
			}
		}
	}

	private notifyProcessingCallbacks(): void {
		for (const callback of this.processingCallbacks) {
			try {
				callback(this.processing)
			} catch (error) {
				this.log('Processing callback error:', error)
			}
		}
	}

	private notify(message: string, type: 'info' | 'success' | 'warning' | 'error'): void {
		if (!this.config.showNotifications) {
			return
		}

		for (const callback of this.notificationCallbacks) {
			try {
				callback(message, type)
			} catch (error) {
				this.log('Notification callback error:', error)
			}
		}
	}

	private log(message: string, ...args: unknown[]): void {
		if (this.config.debug) {
			console.log(`[OfflineQueue] ${message}`, ...args)
		}
	}
}

export function createOfflineQueueManager(
	userId: string,
	config?: OfflineQueueConfig,
	externalQueue?: SyncQueue
): OfflineQueueManager {
	return new OfflineQueueManager(userId, config, externalQueue)
}

export function isBrowserOffline(): boolean {
	if (typeof navigator === 'undefined') {
		return false
	}
	return !navigator.onLine
}
