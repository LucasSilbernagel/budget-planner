import { z } from 'zod'
import { createSyncQueue, type SyncQueue, SyncQueueClosedError } from './queue'
import type {
	ChangesPulledCallback,
	ConflictCallback,
	ConflictResult,
	ConflictType,
	OperationsRejectedCallback,
	OperationsSyncedCallback,
	ProcessOperationResult,
	PullResult,
	RefusedServerChange,
	ServerChange,
	ServerChangesRefusedCallback,
	SyncConfig,
	SyncEntityType,
	SyncOperation,
	SyncResult,
	SyncState,
	SyncStatusCallback,
} from './types'
import {
	retirementPlanSyncSchema,
	SyncStatus,
	syncOperationDataSchema,
	validateServerRow,
} from './types'

export const DEFAULT_CONFIG: SyncConfig = {
	conflictResolutionStrategy: 'last-write-wins',
	maxRetries: 3,
	retryDelay: 5000,
	batchSize: 50,
	autoSync: true,
	autoSyncInterval: 30000,
	debug: false,
}

const MAX_CALLBACKS = 100

/** Capped, not drained by its reader: that callback fires inside `sync()`, so draining
 * would empty it before any caller of `sync()` could look. */
const MAX_RECORDED_REJECTIONS = 50

const CIRCUIT_BREAKER_CONFIG = {
	failureThreshold: 5,
	cooldownPeriod: 30000,
}

/** Allow-list on purpose: transient server failures arrive with no status, so classifying on
 * the absence of a signal would delete queued edits. Add only statuses emitted for invalid ops. */
const PERMANENT_REJECT_STATUS_CODES: ReadonlySet<number> = new Set([
	400, // malformed operation body
	404, // the route or target does not exist
	409, // a server-declared conflict, not the conflict-detection path
	422, // parsed but failed server-side validation
])

/** `userProfile` ops never match: their stamp is the active profile at queue time, which may
 * be the deleted one. For other types the stamp is exactly what the server checks. */
function isStrandedByDeletedProfile(
	operation: SyncOperation,
	deletedProfileIds: ReadonlySet<string>
): boolean {
	return (
		operation.entityType !== 'userProfile' &&
		// Account-scoped: the server never checks a plan op's profileId.
		operation.entityType !== 'retirementPlan' &&
		typeof operation.profileId === 'string' &&
		deletedProfileIds.has(operation.profileId)
	)
}

function operationKey(op: {
	type: SyncOperation['type']
	entityType: SyncOperation['entityType']
	entityId: string
}): string {
	return `${op.type}:${op.entityType}:${op.entityId}`
}

/** Accepted ops stay queued until after the batch loop, so the queue alone can't tell. */
function dependsOnStillPending(
	operation: SyncOperation,
	queued: readonly SyncOperation[],
	landed: readonly SyncOperation[]
): boolean {
	const target = operation.dependsOn
	if (!target) {
		return false
	}
	const key = operationKey(target)
	return (
		queued.some((op) => op.id !== operation.id && operationKey(op) === key) &&
		!landed.some((op) => operationKey(op) === key)
	)
}

function generateOperationId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return `sync-op-${crypto.randomUUID()}`
	}
	return `sync-op-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

function stableStringify(value: unknown): string {
	if (value === null || typeof value !== 'object') {
		return JSON.stringify(value)
	}
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableStringify(item)).join(',')}]`
	}
	const record = value as Record<string, unknown>
	const keys = Object.keys(record).sort()
	return `{${keys
		.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
		.join(',')}}`
}

function validateOperationData(
	data: Record<string, unknown>,
	entityType: SyncEntityType
): Record<string, unknown> {
	const parsed = syncOperationDataSchema.parse(data)
	const refinement = perEntityRefinements[entityType]
	if (refinement) {
		// A verdict, never a rewrite: the stripped `parsed` is what we return.
		refinement.parse(parsed)
	}
	return parsed
}

/** Bounds the one flat shared schema can't express. Refusing here costs one row; a DB rejection
 * stays queued, replays, and trips the breaker for the whole account. */
const perEntityRefinements: Partial<Record<SyncEntityType, z.ZodTypeAny>> = {
	savingsGoal: z
		.object({
			currentBalance: z.number().int().min(0).optional(),
		})
		// For intent only: zod strips unknown keys and this parse output is discarded anyway.
		.passthrough(),
	// A plan op must carry the whole plan; refusing before enqueue is the one refusal that
	// can't deadlock sync.
	retirementPlan: z.object({ plan: retirementPlanSyncSchema }).passthrough(),
}

const cachedDeviceIds: Map<string, string> = new Map()

function newDeviceId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return `device-${crypto.randomUUID()}`
	}
	return `device-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

function generateDeviceId(userId: string): string {
	const storageKey = `bp-device-id-${userId}`

	try {
		let deviceId = localStorage.getItem(storageKey)

		if (!deviceId) {
			deviceId = newDeviceId()
			try {
				localStorage.setItem(storageKey, deviceId)
			} catch {
				// Unpersisted is acceptable: the generated id still works this session.
			}
			// Read back: another tab may have written first.
			const actualDeviceId = localStorage.getItem(storageKey)
			if (actualDeviceId) {
				deviceId = actualDeviceId
			}
		}

		return deviceId
	} catch {
		try {
			let deviceId = sessionStorage.getItem(storageKey)

			if (!deviceId) {
				deviceId = newDeviceId()
				try {
					sessionStorage.setItem(storageKey, deviceId)
				} catch {
					// Unpersisted is acceptable: the generated id still works this session.
				}
				// Read back: another tab may have written first.
				const actualDeviceId = sessionStorage.getItem(storageKey)
				if (actualDeviceId) {
					deviceId = actualDeviceId
				}
			}

			return deviceId
		} catch {
			let deviceId = cachedDeviceIds.get(userId)
			if (!deviceId) {
				deviceId = newDeviceId()
				cachedDeviceIds.set(userId, deviceId)
			}
			return deviceId
		}
	}
}

export class SynchronizationService {
	private queue: SyncQueue
	private config: SyncConfig
	private state: SyncState
	private userId: string
	private deviceId: string
	private statusCallbacks: Set<SyncStatusCallback> = new Set()
	private conflictCallbacks: Set<ConflictCallback> = new Set()
	private changesPulledCallbacks: Set<ChangesPulledCallback> = new Set()
	private operationsRejectedCallbacks: Set<OperationsRejectedCallback> = new Set()
	private operationsSyncedCallbacks: Set<OperationsSyncedCallback> = new Set()
	private serverChangesRefusedCallbacks: Set<ServerChangesRefusedCallback> = new Set()
	private autoSyncTimer: ReturnType<typeof setInterval> | null = null
	private isProcessing = false
	// A trigger arriving mid-sync sets this so one more pass runs instead of being dropped.
	private pendingResync = false
	// Set first by `destroy()`, never reset; checked at every entry point and after every await.
	private destroyed = false
	// Bumped by `clearQueue()`. A sync that sees it moved stops reporting refusals and conflicts
	// for ops cleared under it.
	private queueClears = 0
	private retryTimeout: ReturnType<typeof setTimeout> | null = null
	// In memory only; pruned to the queued ids in `refreshEscalated()`.
	private failureCounts: Map<string, number> = new Map()
	// Start of each op's current failure run, for the time floor.
	private firstFailureAt: Map<string, number> = new Map()

	private circuitBroken = false
	private circuitBrokenUntil = 0
	private consecutiveFailures = 0

	private boundHandleOnline: (() => void) | null = null
	private boundHandleOffline: (() => void) | null = null
	private boundHandleVisibilityChange: (() => void) | null = null

	constructor(userId: string, config: Partial<SyncConfig> = {}) {
		if (!userId || typeof userId !== 'string' || userId.trim() === '') {
			throw new Error('Invalid userId: must be a non-empty string')
		}

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

	private createInitialState(): SyncState {
		return {
			status: SyncStatus.PENDING,
			lastSyncTimestamp: null,
			lastPullTimestamp: null,
			pendingOperations: [],
			failedOperations: [],
			escalatedOperations: [],
			conflictOperations: [],
			rejectedOperations: [],
			isOnline: typeof navigator !== 'undefined' ? navigator.onLine : false,
			retryCount: 0,
		}
	}

	private async checkRealConnectivity(): Promise<boolean> {
		if (typeof navigator === 'undefined') {
			return false
		}

		if (!navigator.onLine) {
			return false
		}

		// No unauthenticated health probe (avoids endpoint enumeration); captive portals may
		// therefore read as online.

		return true
	}

	async initialize(): Promise<void> {
		await this.queue.initialize()

		// A `destroy()` during the load removed no listener; registering now would leave a dead
		// service pushing the queue on every tab focus.
		if (this.destroyed) {
			return
		}

		this.state.pendingOperations = this.queue.getAll()

		if (typeof window !== 'undefined') {
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

			this.boundHandleVisibilityChange = () => {
				if (
					document.visibilityState === 'visible' &&
					this.state.isOnline &&
					this.queue.getCount() > 0
				) {
					this.sync().catch((error) => {
						this.log('Visibility sync error:', error)
					})
				}
			}

			window.addEventListener('online', this.boundHandleOnline)
			window.addEventListener('offline', this.boundHandleOffline)
			window.addEventListener('visibilitychange', this.boundHandleVisibilityChange)

			this.state.isOnline = await this.checkRealConnectivity()
		}

		// A `destroy()` during the await already removed the listeners.
		if (this.destroyed) {
			return
		}

		if (this.config.autoSync) {
			this.startAutoSync()
		}

		this.notifyStatusCallbacks()
	}

	startAutoSync(): void {
		// Public, so guarded here too: no interval may outlive `destroy()`.
		if (this.destroyed || this.autoSyncTimer) {
			return
		}

		this.autoSyncTimer = setInterval(() => {
			if (this.state.isOnline) {
				this.sync().catch((error) => {
					this.log('Auto-sync error:', error)
				})
			}
		}, this.config.autoSyncInterval)
	}

	stopAutoSync(): void {
		if (this.autoSyncTimer) {
			clearInterval(this.autoSyncTimer)
			this.autoSyncTimer = null
		}
	}

	/** Skips mutation rather than delivering later: in-flight results are discarded and the next
	 * session re-sends. `destroyed` stops sends and timers; `queue.close()` stops every write. */
	destroy(): void {
		this.destroyed = true
		this.queue.close()
		this.stopAutoSync()

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
			if (this.boundHandleVisibilityChange) {
				window.removeEventListener('visibilitychange', this.boundHandleVisibilityChange)
				this.boundHandleVisibilityChange = null
			}
		}

		this.statusCallbacks.clear()
		this.conflictCallbacks.clear()
		this.changesPulledCallbacks.clear()
		this.operationsRejectedCallbacks.clear()
		this.operationsSyncedCallbacks.clear()
		this.serverChangesRefusedCallbacks.clear()
	}

	private assertNotDestroyed(): void {
		if (this.destroyed) {
			throw new Error('Sync service destroyed: cannot queue an operation')
		}
	}

	/** Clears this instance, not a fresh queue: writes are whole-queue writes from memory, so a
	 * separate instance's clear would be written back. Keeps the pull cursor. */
	async clearQueue(): Promise<void> {
		if (this.destroyed) {
			throw new Error('Sync service destroyed: cannot clear its queue')
		}
		// Bumped before the await: a sync resuming after this call must treat its batch as cleared.
		this.queueClears++
		await this.queue.clear()
		if (this.destroyed) {
			return
		}
		// No retry timer to cancel: `runRetry` narrows to ops still queued.
		this.state.pendingOperations = []
		this.state.failedOperations = []
		this.state.conflictOperations = []
		this.state.rejectedOperations = []
		// Left alone while a sync runs: that sync sets its own outcome.
		this.state.lastError = undefined
		if (!this.isProcessing && this.state.status === SyncStatus.FAILED) {
			this.state.status = SyncStatus.COMPLETED
		}
		// Also prunes the failure counts to the (now empty) queue.
		this.refreshEscalated()
		this.notifyStatusCallbacks()
	}

	private destroyedSyncResult(startTime: number): SyncResult {
		return {
			success: false,
			synchronizedCount: 0,
			failedCount: 0,
			conflictCount: 0,
			state: { ...this.state },
			error: 'Sync service destroyed',
			duration: Date.now() - startTime,
		}
	}

	private destroyedPullResult(since: number | null): PullResult {
		return {
			success: false,
			changesPulledCount: 0,
			applied: [],
			conflicts: [],
			error: 'Sync service destroyed',
			lastPullTimestamp: since,
			refused: [],
			discardedForDeletedProfile: [],
			droppedDependents: [],
		}
	}

	private async handleOnline(): Promise<void> {
		const isReallyOnline = await this.checkRealConnectivity()

		if (!isReallyOnline) {
			this.log('Device reports online but connectivity check failed')
			return
		}

		this.state.isOnline = true
		this.log('Device is now online')

		if (this.queue.getCount() > 0) {
			if (this.isProcessing) {
				// The isProcessing guard would drop this trigger; run one more pass afterwards instead.
				this.pendingResync = true
			} else {
				this.sync().catch((error) => {
					this.log('Online sync error:', error)
				})
			}
		}

		this.notifyStatusCallbacks()
	}

	private handleOffline(): void {
		this.state.isOnline = false
		this.log('Device is now offline')
		this.notifyStatusCallbacks()
	}

	onStatusChange(callback: SyncStatusCallback): () => void {
		if (this.statusCallbacks.size >= MAX_CALLBACKS) {
			this.log(
				`WARNING: Maximum callbacks (${MAX_CALLBACKS}) reached. Possible memory leak - forgot to unsubscribe?`
			)
		}
		this.statusCallbacks.add(callback)
		return () => this.statusCallbacks.delete(callback)
	}

	onConflict(callback: ConflictCallback): () => void {
		if (this.conflictCallbacks.size >= MAX_CALLBACKS) {
			this.log(
				`WARNING: Maximum callbacks (${MAX_CALLBACKS}) reached. Possible memory leak - forgot to unsubscribe?`
			)
		}
		this.conflictCallbacks.add(callback)
		return () => this.conflictCallbacks.delete(callback)
	}

	onChangesPulled(callback: ChangesPulledCallback): () => void {
		if (this.changesPulledCallbacks.size >= MAX_CALLBACKS) {
			this.log(
				`WARNING: Maximum callbacks (${MAX_CALLBACKS}) reached. Possible memory leak - forgot to unsubscribe?`
			)
		}
		this.changesPulledCallbacks.add(callback)
		return () => this.changesPulledCallbacks.delete(callback)
	}

	onOperationsRejected(callback: OperationsRejectedCallback): () => void {
		if (this.operationsRejectedCallbacks.size >= MAX_CALLBACKS) {
			this.log(
				`WARNING: Maximum callbacks (${MAX_CALLBACKS}) reached. Possible memory leak - forgot to unsubscribe?`
			)
		}
		this.operationsRejectedCallbacks.add(callback)
		return () => this.operationsRejectedCallbacks.delete(callback)
	}

	private notifyOperationsRejectedCallbacks(operations: SyncOperation[]): void {
		for (const callback of this.operationsRejectedCallbacks) {
			try {
				callback([...operations])
			} catch (error) {
				this.log('Operations-rejected callback error:', error)
			}
		}
	}

	/** Fired after the teardown checks, so a destroyed service reports nothing. Ops accepted
	 * before a queue clear, or whose removal failed, are still reported: they landed. */
	onOperationsSynced(callback: OperationsSyncedCallback): () => void {
		if (this.operationsSyncedCallbacks.size >= MAX_CALLBACKS) {
			this.log(
				`WARNING: Maximum callbacks (${MAX_CALLBACKS}) reached. Possible memory leak - forgot to unsubscribe?`
			)
		}
		this.operationsSyncedCallbacks.add(callback)
		return () => this.operationsSyncedCallbacks.delete(callback)
	}

	private notifyOperationsSyncedCallbacks(operations: SyncOperation[]): void {
		for (const callback of this.operationsSyncedCallbacks) {
			try {
				callback([...operations])
			} catch (error) {
				this.log('Operations-synced callback error:', error)
			}
		}
	}

	onServerChangesRefused(callback: ServerChangesRefusedCallback): () => void {
		if (this.serverChangesRefusedCallbacks.size >= MAX_CALLBACKS) {
			this.log(
				`WARNING: Maximum callbacks (${MAX_CALLBACKS}) reached. Possible memory leak - forgot to unsubscribe?`
			)
		}
		this.serverChangesRefusedCallbacks.add(callback)
		return () => this.serverChangesRefusedCallbacks.delete(callback)
	}

	private notifyServerChangesRefusedCallbacks(refused: RefusedServerChange[]): void {
		for (const callback of this.serverChangesRefusedCallbacks) {
			try {
				callback([...refused])
			} catch (error) {
				this.log('Server-changes-refused callback error:', error)
			}
		}
	}

	private notifyChangesPulledCallbacks(changes: ServerChange[]): void {
		for (const callback of this.changesPulledCallbacks) {
			try {
				callback([...changes])
			} catch (error) {
				this.log('Changes-pulled callback error:', error)
			}
		}
	}

	private notifyStatusCallbacks(): void {
		for (const callback of this.statusCallbacks) {
			try {
				callback({ ...this.state })
			} catch (error) {
				this.log('Status callback error:', error)
			}
		}
	}

	private notifyConflictCallbacks(conflict: ConflictResult): void {
		for (const callback of this.conflictCallbacks) {
			try {
				callback({ ...conflict })
			} catch (error) {
				this.log('Conflict callback error:', error)
			}
		}
	}

	async queueCreate(
		entityType: SyncEntityType,
		entityId: string | number,
		data: Record<string, unknown>,
		userId: string
	): Promise<SyncOperation> {
		this.assertNotDestroyed()

		if (userId !== this.userId) {
			throw new Error(
				`Unauthorized: Operation userId mismatch. Expected: ${this.userId}, Got: ${userId}`
			)
		}

		const validatedData = validateOperationData(data, entityType)

		const operation = {
			id: generateOperationId(),
			type: 'create',
			entityType,
			entityId: String(entityId),
			data: validatedData,
			timestamp: Date.now(),
			deviceId: this.deviceId,
			userId,
			// The server requires a profileId on profile-scoped entities.
			profileId: this.config.profileId,
		} satisfies SyncOperation

		await this.queue.add(operation)
		this.state.pendingOperations = this.queue.getAll()
		this.notifyStatusCallbacks()

		if (this.state.isOnline && this.config.autoSync) {
			this.sync().catch((error) => {
				this.log('Create queue sync error:', error)
			})
		}

		return operation
	}

	async queueUpdate(
		entityType: SyncEntityType,
		entityId: string | number,
		data: Record<string, unknown>,
		userId: string,
		version?: number,
		baseVersion?: number,
		dependsOn?: SyncOperation['dependsOn']
	): Promise<SyncOperation> {
		this.assertNotDestroyed()

		if (userId !== this.userId) {
			throw new Error(
				`Unauthorized: Operation userId mismatch. Expected: ${this.userId}, Got: ${userId}`
			)
		}

		const validatedData = validateOperationData(data, entityType)

		const operation = {
			id: generateOperationId(),
			type: 'update',
			entityType,
			entityId: String(entityId),
			data: validatedData,
			timestamp: Date.now(),
			deviceId: this.deviceId,
			userId,
			version,
			// Server `updatedAt` this edit was based on, for causal pull LWW.
			baseVersion,
			profileId: this.config.profileId,
			// Only when set, so an op without a link serializes exactly as before.
			...(dependsOn ? { dependsOn } : {}),
		} satisfies SyncOperation

		await this.queue.add(operation)
		this.state.pendingOperations = this.queue.getAll()
		this.notifyStatusCallbacks()

		if (this.state.isOnline && this.config.autoSync) {
			this.sync().catch((error) => {
				this.log('Update queue sync error:', error)
			})
		}

		return operation
	}

	async queueDelete(
		entityType: SyncEntityType,
		entityId: string | number,
		userId: string,
		data: Record<string, unknown> = {},
		baseVersion?: number
	): Promise<SyncOperation> {
		this.assertNotDestroyed()

		if (userId !== this.userId) {
			throw new Error(
				`Unauthorized: Operation userId mismatch. Expected: ${this.userId}, Got: ${userId}`
			)
		}

		const validatedData = validateOperationData(data, entityType)

		const operation = {
			id: generateOperationId(),
			type: 'delete',
			entityType,
			entityId: String(entityId),
			data: validatedData,
			timestamp: Date.now(),
			deviceId: this.deviceId,
			userId,
			// Server `updatedAt` this delete was based on, for causal pull LWW.
			baseVersion,
			// The server requires a profileId on profile-scoped entities.
			profileId: this.config.profileId,
		} satisfies SyncOperation

		await this.queue.add(operation)
		this.state.pendingOperations = this.queue.getAll()
		this.notifyStatusCallbacks()

		if (this.state.isOnline && this.config.autoSync) {
			this.sync().catch((error) => {
				this.log('Delete queue sync error:', error)
			})
		}

		return operation
	}

	detectConflict(localOp: SyncOperation, serverOp: SyncOperation): ConflictResult {
		if (localOp.entityType !== serverOp.entityType || localOp.entityId !== serverOp.entityId) {
			return { hasConflict: false }
		}

		if (localOp.deviceId === serverOp.deviceId) {
			return { hasConflict: false }
		}

		if (localOp.id === serverOp.id) {
			return { hasConflict: false }
		}

		if (localOp.type === serverOp.type) {
			if (localOp.type === 'delete') {
				return { hasConflict: false }
			}

			// A one-sided version is also a mismatch; ignoring it would silently accept a stale
			// optimistic-concurrency write.
			if (
				localOp.type === 'update' &&
				(localOp.version !== undefined || serverOp.version !== undefined) &&
				localOp.version !== serverOp.version
			) {
				return {
					hasConflict: true,
					conflictType: 'version-mismatch',
					localOperation: localOp,
					serverOperation: serverOp,
				}
			}

			if (stableStringify(localOp.data) !== stableStringify(serverOp.data)) {
				return {
					hasConflict: true,
					conflictType: localOp.type === 'create' ? 'create-create' : 'version-mismatch',
					localOperation: localOp,
					serverOperation: serverOp,
				}
			}

			return { hasConflict: false }
		}

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

	resolveConflict(localOp: SyncOperation, serverOp: SyncOperation): SyncOperation {
		const conflictResult = this.detectConflict(localOp, serverOp)

		if (!conflictResult.hasConflict) {
			return localOp
		}

		switch (this.config.conflictResolutionStrategy) {
			case 'server-wins':
				return serverOp

			case 'client-wins':
				return localOp

			case 'manual':
				this.state.conflictOperations.push(localOp)
				this.notifyStatusCallbacks()
				this.notifyConflictCallbacks(conflictResult)
				return localOp

			case 'merge':
				if (localOp.type === 'update' && serverOp.type === 'update') {
					return {
						...localOp,
						data: { ...serverOp.data, ...localOp.data },
					}
				}

				if (localOp.type === 'create' && serverOp.type === 'create') {
					return {
						...localOp,
						data: { ...serverOp.data, ...localOp.data },
					}
				}

				if (localOp.type === 'create' && serverOp.type === 'delete') {
					return localOp
				}

				if (localOp.type === 'delete' && serverOp.type === 'create') {
					return serverOp
				}

				if (localOp.type === 'update' && serverOp.type === 'delete') {
					return localOp
				}

				if (localOp.type === 'delete' && serverOp.type === 'update') {
					return serverOp
				}

				if (localOp.timestamp > serverOp.timestamp) {
					return localOp
				}
				if (localOp.timestamp < serverOp.timestamp) {
					return serverOp
				}
				return localOp.deviceId > serverOp.deviceId ? localOp : serverOp

			default: {
				// Notify even when auto-resolved: an equal-timestamp tie discards one side's write.
				let winner: SyncOperation
				if (localOp.timestamp > serverOp.timestamp) {
					winner = localOp
				} else if (localOp.timestamp < serverOp.timestamp) {
					winner = serverOp
				} else {
					winner = localOp.deviceId > serverOp.deviceId ? localOp : serverOp
				}
				this.notifyConflictCallbacks({ ...conflictResult, resolution: winner })
				return winner
			}
		}
	}

	async sync(): Promise<SyncResult> {
		// Checked before the lock, so a dead service never holds it.
		if (this.destroyed) {
			return this.destroyedSyncResult(Date.now())
		}

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
		const queueClearsAtStart = this.queueClears

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
			const operations = this.queue.getReadyOperations(this.config.batchSize)

			if (operations.length === 0) {
				this.state.status = SyncStatus.COMPLETED
				this.state.lastSyncTimestamp = Date.now()
				// Reset, or a queue emptied by pull LWW leaves the retry budget spent.
				this.state.retryCount = 0
				this.state.failedOperations = []
				// The web layer can empty the queue directly (`discardBatch`), so refresh this too.
				this.state.pendingOperations = []
				this.refreshEscalated()
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

			// Remove ops only after the whole batch is processed, and count them as synced only once
			// removed, so a mid-batch failure loses nothing.
			let synchronizedCount = 0
			let failedCount = 0
			let conflictCount = 0
			const failedOperations: SyncOperation[] = []
			// An op leaves the queue only on positive evidence the server will never accept it.
			// 401: the op is valid, only the session isn't, so it stays queued.
			const authBlockedOperations: SyncOperation[] = []
			// 403: the account lost server sync. Re-auth can't fix it, so it must not open the circuit
			// every cycle; the data is kept in case the user re-subscribes.
			const tierBlockedOperations: SyncOperation[] = []
			const rejectedOperations: SyncOperation[] = []
			// `retryable: false` with no status: the server also produces this for transient errors
			// (timeouts, deadlocks), so it stays queued.
			const unclassifiedFailedOperations: SyncOperation[] = []
			const conflictOperations: SyncOperation[] = []
			const successfullyProcessed: SyncOperation[] = []

			for (const operation of operations) {
				if (this.destroyed) {
					break
				}
				// Cleared mid-batch: a cleared edit is never sent. Already-sent ops stand.
				if (this.queueClears !== queueClearsAtStart) {
					break
				}

				// Unsent ops stay queued and aren't charged against the retry budget.
				if (!this.state.isOnline) {
					this.log('Device went offline during sync; stopping batch early')
					break
				}

				// A dependent waits for its target: a promotion sent after a failed deletion lets the next
				// pull see the profile as newer and undo the deletion.
				if (dependsOnStillPending(operation, this.queue.getAll(), successfullyProcessed)) {
					this.log('Holding an operation until the one it depends on has landed')
					continue
				}

				try {
					const result = await this.processOperation(operation)

					if (result.success) {
						successfullyProcessed.push(operation)
					} else if (result.conflict) {
						conflictOperations.push(operation)
						conflictCount++
					} else if (result.retryable === false) {
						if (result.statusCode === 401) {
							authBlockedOperations.push(operation)
						} else if (result.statusCode === 403) {
							tierBlockedOperations.push(operation)
						} else if (
							result.statusCode !== undefined &&
							PERMANENT_REJECT_STATUS_CODES.has(result.statusCode)
						) {
							rejectedOperations.push(operation)
						} else {
							unclassifiedFailedOperations.push(operation)
						}
						failedCount++
						this.state.lastError = result.error ?? 'Non-retryable sync failure'
					} else {
						failedOperations.push(operation)
						failedCount++
					}
				} catch (error) {
					this.log('Operation processing error:', error, operation)
					failedOperations.push(operation)
					failedCount++
				}
			}

			// Torn down mid-push: discard what this sync learned; the next session re-sends.
			if (this.destroyed) {
				return this.destroyedSyncResult(startTime)
			}

			// Dropped before the sweeps below, which read the current queue: an op queued after the
			// clear must not be swept up with a cleared refused create.
			const dropOutcomesOfClearedBatch = (): void => {
				for (const bucket of [
					failedOperations,
					unclassifiedFailedOperations,
					conflictOperations,
					authBlockedOperations,
					tierBlockedOperations,
					rejectedOperations,
				]) {
					bucket.length = 0
				}
				failedCount = 0
				conflictCount = 0
				this.state.lastError = undefined
			}
			if (this.queueClears !== queueClearsAtStart) {
				dropOutcomesOfClearedBatch()
			}

			// A refused create takes its row's other queued ops with it: they can only fail and would
			// deadlock the queue. Not for refused updates, whose row exists server-side.
			const refusedCreates = new Set(
				rejectedOperations
					.filter((op) => op.type === 'create')
					.map((op) => `${op.entityType}:${op.entityId}`)
			)
			if (refusedCreates.size > 0) {
				const alreadyRefused = new Set(rejectedOperations.map((op) => op.id))
				const followUps = this.queue
					.getAll()
					.filter(
						(op) =>
							!alreadyRefused.has(op.id) && refusedCreates.has(`${op.entityType}:${op.entityId}`)
					)
				if (followUps.length > 0) {
					const followUpIds = new Set(followUps.map((op) => op.id))
					// Out of every bucket, so none is retried or recorded as a conflict.
					for (const bucket of [
						failedOperations,
						conflictOperations,
						unclassifiedFailedOperations,
					]) {
						for (let i = bucket.length - 1; i >= 0; i--) {
							const op = bucket[i]
							if (op && followUpIds.has(op.id)) bucket.splice(i, 1)
						}
					}
					rejectedOperations.push(...followUps)
				}
			}

			// A dependent leaves with a refused target; otherwise it would later push a change for a
			// deletion that never happened.
			const refusedTargets = new Set(rejectedOperations.map(operationKey))
			if (refusedTargets.size > 0) {
				const alreadyRefused = new Set(rejectedOperations.map((op) => op.id))
				rejectedOperations.push(
					...this.queue
						.getAll()
						.filter(
							(op) =>
								op.dependsOn !== undefined &&
								!alreadyRefused.has(op.id) &&
								refusedTargets.has(operationKey(op.dependsOn))
						)
				)
			}

			if (successfullyProcessed.length > 0) {
				const operationsToRemove = successfullyProcessed.map((op) => op.id)
				try {
					await this.queue.removeBatch(operationsToRemove)
					synchronizedCount = successfullyProcessed.length
				} catch (removeError) {
					this.log('Failed to remove operations from queue:', removeError)
					// Accepted by the server, so kept out of `failedOperations` (no fast retry); a later sync
					// re-sends them.
					failedCount += successfullyProcessed.length
					synchronizedCount = 0
				}
			}

			// Retryable failures stay in the persisted queue; the retry timer below is only the fast path.

			// `discardBatch`, not `removeBatch`: if storage refuses the write, the ops still leave this
			// session's queue instead of replaying every cycle.
			let recordableRejectedOps = rejectedOperations
			if (rejectedOperations.length > 0) {
				try {
					const { persisted } = await this.queue.discardBatch(rejectedOperations.map((op) => op.id))
					if (!persisted) {
						this.log(
							'Storage refused the write removing rejected operations; they are dropped for this session only.'
						)
					}
				} catch (removeError) {
					// `discardBatch` doesn't throw on storage failure, so this is unexpected. The ops may still
					// be queued, so don't announce them as dropped.
					this.log('Failed to discard rejected operations from queue:', removeError)
					recordableRejectedOps = []
				}
			}

			// Intentionally kept queued so they survive a transient server fault.
			if (unclassifiedFailedOperations.length > 0) {
				this.log(
					`Keeping ${unclassifiedFailedOperations.length} non-retryable operation(s) with no permanent-rejection status; they stay queued for the next sync.`,
					unclassifiedFailedOperations.map((op) => op.id)
				)
			}

			if (this.destroyed) {
				return this.destroyedSyncResult(startTime)
			}

			// `recordableRejectedOps` aliases `rejectedOperations` (or is already `[]`), so emptying
			// the bucket empties it too.
			if (this.queueClears !== queueClearsAtStart) {
				dropOutcomesOfClearedBatch()
			}

			this.state.lastSyncTimestamp = Date.now()
			this.state.pendingOperations = this.queue.getAll()
			// A view, not a carrier: still-queued retryable failures, a subset of `pendingOperations`.
			this.state.failedOperations = this.retryableStillQueued(failedOperations)
			// Counted past every destroyed check and after the refused-create sweep, so neither a
			// torn-down sync nor swept follow-ups count as failures.
			this.recordAttemptOutcomes(
				[...failedOperations, ...unclassifiedFailedOperations],
				[
					...successfullyProcessed,
					...conflictOperations,
					...authBlockedOperations,
					...tierBlockedOperations,
					...rejectedOperations,
				]
			)
			this.refreshEscalated()
			this.state.conflictOperations = [...this.state.conflictOperations, ...conflictOperations]
			this.state.rejectedOperations = [
				...this.state.rejectedOperations,
				...recordableRejectedOps,
			].slice(-MAX_RECORDED_REJECTIONS)

			if (failedCount > 0 || conflictCount > 0) {
				this.state.status = SyncStatus.FAILED
				// Any failed sync counts, so a server returning { success: false } forever still trips it.
				this.consecutiveFailures++
				if (this.consecutiveFailures >= CIRCUIT_BREAKER_CONFIG.failureThreshold) {
					this.openCircuit()
				}
			} else {
				this.state.status = SyncStatus.COMPLETED
				this.consecutiveFailures = 0
				this.state.retryCount = 0
			}

			this.notifyStatusCallbacks()

			// Not narrowed by the removal's outcome: these landed.
			if (successfullyProcessed.length > 0) {
				this.notifyOperationsSyncedCallbacks(successfullyProcessed)
			}

			if (recordableRejectedOps.length > 0) {
				this.notifyOperationsRejectedCallbacks(recordableRejectedOps)
			}

			// Not an `else if` with the retry below: the two decisions are independent. 403 is absent
			// on purpose: re-auth can't clear it, so re-opening the circuit every sync buys nothing.
			if (authBlockedOperations.length > 0) {
				this.openCircuit()
			}
			if (tierBlockedOperations.length > 0) {
				this.state.lastError =
					'Server sync is not included in your current plan. Your changes are saved on this device and will sync if you resubscribe.'
			}
			if (
				this.state.failedOperations.length > 0 &&
				this.state.retryCount < this.config.maxRetries
			) {
				this.scheduleRetry()
			} else if (
				// Drain the backlog: more than batchSize ops may remain.
				this.state.isOnline &&
				failedCount === 0 &&
				conflictCount === 0 &&
				this.queue.getCount() > 0
			) {
				setTimeout(() => {
					this.sync().catch((error) => this.log('Drain sync error:', error))
				}, 0)
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
			if (this.destroyed) {
				return this.destroyedSyncResult(startTime)
			}
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

			if (
				!this.destroyed &&
				this.pendingResync &&
				this.state.isOnline &&
				this.queue.getCount() > 0
			) {
				this.pendingResync = false
				setTimeout(() => {
					this.sync().catch((error) => this.log('Pending resync error:', error))
				}, 0)
			} else {
				this.pendingResync = false
			}
		}
	}

	private async processOperation(operation: SyncOperation): Promise<ProcessOperationResult> {
		if (this.config.processOperation) {
			return this.config.processOperation(operation)
		}

		// Throw rather than return success: success would delete the unsent op from the queue.
		throw new Error(
			'No processOperation configured: refusing to mark operations as synced ' +
				'to avoid silent data loss. Provide config.processOperation.'
		)
	}

	private scheduleRetry(): void {
		if (this.destroyed) {
			return
		}

		if (this.retryTimeout) {
			clearTimeout(this.retryTimeout)
		}

		const now = Date.now()
		if (this.circuitBroken) {
			if (now < this.circuitBrokenUntil) {
				// Defer to just after the cooldown rather than drop: this is the fast path, and the web
				// app has no periodic push.
				const delay = this.circuitBrokenUntil - now + this.config.retryDelay
				this.log(
					`Circuit breaker: Open until ${new Date(
						this.circuitBrokenUntil
					).toISOString()}. Retry deferred by ${delay}ms.`
				)
				this.retryTimeout = setTimeout(() => {
					if (this.destroyed) {
						return
					}
					// Re-check: `openCircuit()` may have extended the deadline after this timer was armed.
					if (Date.now() < this.circuitBrokenUntil) {
						this.scheduleRetry()
						return
					}
					// Re-check the budget: `runRetry` increments `retryCount` before its own empty-check.
					if (this.state.retryCount >= this.config.maxRetries) {
						this.log('Circuit cooldown elapsed but the retry budget is exhausted; not draining.')
						return
					}
					this.circuitBroken = false
					this.consecutiveFailures = 0
					void this.runRetry()
				}, delay)
				return
			}
			this.circuitBroken = false
			this.consecutiveFailures = 0
			this.log('Circuit breaker: Cooldown complete. Resuming retries.')
		}

		this.retryTimeout = setTimeout(() => {
			void this.runRetry()
		}, this.config.retryDelay)
	}

	/** Failed ops never left the queue, so re-adding one would duplicate its id. Checked before
	 * counting the attempt: a timer can outlive the failure that armed it. */
	private async runRetry(): Promise<void> {
		if (this.destroyed) {
			return
		}
		this.state.failedOperations = this.retryableStillQueued(this.state.failedOperations)
		// This early return notifies nobody, so notify when the view moved.
		if (
			this.refreshEscalated() &&
			(this.state.failedOperations.length === 0 || !this.state.isOnline)
		) {
			this.notifyStatusCallbacks()
		}
		if (this.state.failedOperations.length === 0 || !this.state.isOnline) {
			return
		}

		this.state.retryCount++
		this.log(`Retry attempt ${this.state.retryCount}`)

		try {
			await this.sync()
		} catch (error) {
			this.log('Retry sync error:', error)
			this.consecutiveFailures++
			if (this.consecutiveFailures >= CIRCUIT_BREAKER_CONFIG.failureThreshold) {
				this.openCircuit()
			}
		}
	}

	private retryableStillQueued(operations: SyncOperation[]): SyncOperation[] {
		const queuedIds = new Set(this.queue.getAll().map((op) => op.id))
		return operations.filter((op) => queuedIds.has(op.id))
	}

	/** The attempt at which the fast retry path gives up. Unclassified failures arm no timer,
	 * so only external syncs count toward it. */
	private escalationThreshold(): number {
		return this.config.maxRetries + 1
	}

	/** Escalate only once a failure run has lasted as long as the fast retry path, so a few
	 * quick edits during a short blip don't escalate in seconds. */
	private escalationFloorMs(): number {
		return this.config.maxRetries * this.config.retryDelay
	}

	/** Ops not attempted keep their count. Counted per unique id: the queue doesn't dedupe, and
	 * a landed copy resets its duplicates. */
	private recordAttemptOutcomes(failed: SyncOperation[], reset: SyncOperation[]): void {
		const resetIds = new Set(reset.map((op) => op.id))
		for (const id of resetIds) {
			this.failureCounts.delete(id)
			this.firstFailureAt.delete(id)
		}
		const now = Date.now()
		for (const id of new Set(failed.map((op) => op.id))) {
			if (resetIds.has(id)) {
				continue
			}
			const count = (this.failureCounts.get(id) ?? 0) + 1
			this.failureCounts.set(id, count)
			if (count === 1) {
				this.firstFailureAt.set(id, now)
			}
		}
	}

	/** Runs on every `failedOperations` refresh and every pull, so the view never names an op
	 * that left the queue. Returns whether the view changed. */
	private refreshEscalated(): boolean {
		const queued = this.queue.getAll()
		const queuedIds = new Set(queued.map((op) => op.id))
		for (const id of this.failureCounts.keys()) {
			if (!queuedIds.has(id)) {
				this.failureCounts.delete(id)
				this.firstFailureAt.delete(id)
			}
		}
		const threshold = this.escalationThreshold()
		const floor = this.escalationFloorMs()
		const now = Date.now()
		const next = queued.filter(
			(op) =>
				(this.failureCounts.get(op.id) ?? 0) >= threshold &&
				now - (this.firstFailureAt.get(op.id) ?? now) >= floor
		)
		const previous = this.state.escalatedOperations
		const changed =
			next.length !== previous.length || next.some((op, i) => op.id !== previous[i]?.id)
		this.state.escalatedOperations = next
		return changed
	}

	private openCircuit(): void {
		this.circuitBroken = true
		this.circuitBrokenUntil = Date.now() + CIRCUIT_BREAKER_CONFIG.cooldownPeriod
		this.log(
			`Circuit breaker: OPENED. Too many consecutive failures (${this.consecutiveFailures}). Retries paused for ${CIRCUIT_BREAKER_CONFIG.cooldownPeriod}ms.`
		)
	}

	async forceSync(): Promise<SyncResult> {
		return this.sync()
	}

	/** State-based LWW (pulled rows carry no op ids): a tie goes to the queued local edit; a newer
	 * server row drops its queued ops. A row about to be applied is validated, and refused if bad. */
	async pull(): Promise<PullResult> {
		if (this.destroyed) {
			return this.destroyedPullResult(this.state.lastPullTimestamp)
		}

		if (!this.config.fetchServerChanges) {
			// Fail loud: never present a missing transport as "no changes".
			throw new Error(
				'No fetchServerChanges configured: refusing to pull. Provide config.fetchServerChanges.'
			)
		}

		const since = this.state.lastPullTimestamp

		let changes: ServerChange[]
		try {
			changes = await this.config.fetchServerChanges(since)
		} catch (error) {
			if (this.destroyed) {
				return this.destroyedPullResult(since)
			}
			const message = error instanceof Error ? error.message : String(error)
			this.state.lastError = message
			this.log('Pull transport error:', error)
			this.notifyStatusCallbacks()
			return {
				success: false,
				changesPulledCount: 0,
				applied: [],
				conflicts: [],
				error: message,
				lastPullTimestamp: since,
				refused: [],
				discardedForDeletedProfile: [],
				droppedDependents: [],
			}
		}

		// The LWW drop below would write the queue for an ended session; the next session's first
		// pull makes the same decisions again.
		if (this.destroyed) {
			return this.destroyedPullResult(since)
		}

		const applied: ServerChange[] = []
		const conflicts: ServerChange[] = []
		const refused: RefusedServerChange[] = []
		const droppedLocalOps: SyncOperation[] = []
		// A delete dropped against a tombstone did happen, so what depends on it must stay.
		const lostToLiveRow = new Set<string>()

		// Compare against the newest op per entity, but when the server wins drop every queued op
		// for it, or an older one would re-push stale data.
		const queuedByEntity = new Map<string, SyncOperation>()
		const allOpsByEntity = new Map<string, SyncOperation[]>()
		for (const op of this.queue.getAll()) {
			const key = `${op.entityType}:${op.entityId}`
			const existing = queuedByEntity.get(key)
			if (!existing || op.timestamp > existing.timestamp) {
				queuedByEntity.set(key, op)
			}
			const list = allOpsByEntity.get(key)
			if (list) {
				list.push(op)
			} else {
				allOpsByEntity.set(key, [op])
			}
		}

		for (const change of changes) {
			const key = `${change.entityType}:${change.entityId}`
			const localOp = queuedByEntity.get(key)

			// Causal when the op has a baseVersion: local wins iff the change is no newer than its base.
			// Otherwise fall back to the wall-clock timestamp.
			const localWins =
				localOp !== undefined &&
				(localOp.baseVersion !== undefined
					? change.updatedAt <= localOp.baseVersion
					: localOp.timestamp >= change.updatedAt)

			if (localOp && localWins) {
				conflicts.push(change)
				this.notifyConflictCallbacks({
					hasConflict: true,
					conflictType: 'update-update',
					localOperation: localOp,
					resolution: localOp,
				})
				continue
			}

			// Validate before the drop: a refused row must neither apply nor displace a queued op.
			// Tombstones skip validation, or deletes would stop propagating.
			if (!change.isDeleted) {
				const verdict = validateServerRow(change)
				if (!verdict.ok) {
					refused.push({
						entityType: change.entityType,
						entityId: change.entityId,
						fields: verdict.fields,
					})
					continue
				}
			}

			if (localOp) {
				for (const op of allOpsByEntity.get(key) ?? [localOp]) {
					droppedLocalOps.push(op)
					if (!change.isDeleted) {
						lostToLiveRow.add(`${op.type}:${op.entityType}:${op.entityId}`)
					}
				}
				this.notifyConflictCallbacks({
					hasConflict: true,
					conflictType: 'update-update',
					localOperation: localOp,
				})
			}

			applied.push(change)
		}

		// A refused change still advances the cursor, or it would be re-fetched forever. The cursor
		// stops below the earliest change suppressed by a queued op, until that op pushes.
		const earliestSuppressed =
			conflicts.length > 0 ? Math.min(...conflicts.map((c) => c.updatedAt)) : null
		let newCursor = since
		for (const change of changes) {
			if (earliestSuppressed !== null && change.updatedAt >= earliestSuppressed) {
				continue
			}
			if (newCursor === null || change.updatedAt > newCursor) {
				newCursor = change.updatedAt
			}
		}

		// Also dropped, not as conflicts: ops for a profile whose tombstone this pull applied, and
		// dependents of an op dropped for a live server row.
		const alreadyDropped = new Set(droppedLocalOps.map((op) => op.id))
		const deletedProfileIds = new Set(
			applied
				.filter((change) => change.entityType === 'userProfile' && change.isDeleted)
				.map((change) => change.entityId)
		)
		const discardedForDeletedProfile =
			deletedProfileIds.size > 0
				? this.queue
						.getAll()
						.filter(
							(op) =>
								!alreadyDropped.has(op.id) && isStrandedByDeletedProfile(op, deletedProfileIds)
						)
				: []
		const droppedDependents = this.queue.getAll().filter((op) => {
			const target = op.dependsOn
			return (
				target !== undefined &&
				!alreadyDropped.has(op.id) &&
				lostToLiveRow.has(`${target.type}:${target.entityType}:${target.entityId}`)
			)
		})
		// Can't overlap: dependents are `userProfile` ops, which `isStrandedByDeletedProfile` never matches.
		const toDiscard = [...droppedLocalOps, ...discardedForDeletedProfile, ...droppedDependents]
		if (discardedForDeletedProfile.length > 0 || droppedDependents.length > 0) {
			// Counts and ids only: an op's data can carry financial values.
			console.info('[sync] pull let go of queued ops', {
				deletedProfileIds: [...deletedProfileIds],
				forDeletedProfile: discardedForDeletedProfile.length,
				dependents: droppedDependents.length,
			})
		}

		if (toDiscard.length > 0) {
			// `discardBatch`, not `removeBatch`: the pull just applied the newer server value, so a
			// stale op left queued by a failed write would push over it.
			try {
				const { persisted } = await this.queue.discardBatch(toDiscard.map((op) => op.id))
				if (!persisted) {
					this.log('Stale local ops dropped from memory only; storage refused the write')
				}
				this.state.pendingOperations = this.queue.getAll()
				this.state.failedOperations = this.retryableStillQueued(this.state.failedOperations)
				this.refreshEscalated()
			} catch (error) {
				// `discardBatch` doesn't throw for a storage failure; this is a bug path.
				this.log('Failed to remove stale local ops after pull:', error)
			}
			if (droppedLocalOps.length > 0) {
				this.state.conflictOperations = [...this.state.conflictOperations, ...droppedLocalOps]
			}
		}

		if (this.destroyed) {
			return this.destroyedPullResult(since)
		}

		this.state.lastPullTimestamp = newCursor
		this.state.lastError = undefined

		if (applied.length > 0) {
			this.notifyChangesPulledCallbacks(applied)
		}
		if (refused.length > 0) {
			this.notifyServerChangesRefusedCallbacks(refused)
		}
		// Every pull re-derives this, so an op held back only by the time floor surfaces at the next poll.
		this.refreshEscalated()
		this.notifyStatusCallbacks()

		return {
			success: true,
			changesPulledCount: applied.length,
			applied,
			conflicts,
			refused,
			discardedForDeletedProfile,
			droppedDependents,
			lastPullTimestamp: newCursor,
		}
	}

	/** For when the server permanently refused the profile's create: its children's queued ops
	 * would otherwise fail forever. */
	async discardOperationsForDeletedProfile(profileId: string): Promise<SyncOperation[]> {
		if (!profileId || this.destroyed) {
			return []
		}
		const ids = new Set([profileId])
		const stranded = this.queue.getAll().filter((op) => isStrandedByDeletedProfile(op, ids))
		if (stranded.length === 0) {
			return []
		}
		let persisted: boolean
		try {
			;({ persisted } = await this.queue.discardBatch(stranded.map((op) => op.id)))
		} catch (error) {
			// The closed queue refused it; nothing dropped is the intended outcome.
			if (error instanceof SyncQueueClosedError) {
				return []
			}
			throw error
		}
		if (!persisted) {
			this.log('Ops of a deleted profile dropped from memory only; storage refused the write')
		}
		if (this.destroyed) {
			return stranded
		}
		this.state.pendingOperations = this.queue.getAll()
		this.state.failedOperations = this.retryableStillQueued(this.state.failedOperations)
		this.refreshEscalated()
		this.notifyStatusCallbacks()
		return stranded
	}

	async forcePull(): Promise<PullResult> {
		return this.pull()
	}

	/** The pull cursor is global but the delta is profile-scoped, so a profile switch needs a
	 * full re-pull. */
	resetPullCursor(): void {
		this.state.lastPullTimestamp = null
		this.notifyStatusCallbacks()
	}

	getState(): SyncState {
		return { ...this.state }
	}

	getQueue(): SyncQueue {
		return this.queue
	}

	getDeviceId(): string {
		return this.deviceId
	}

	getConfig(): SyncConfig {
		return { ...this.config }
	}

	updateConfig(updates: Partial<SyncConfig>): void {
		this.config = { ...this.config, ...updates }
		// The escalation threshold and time floor derive from these, so re-derive the view.
		if (
			!this.destroyed &&
			('maxRetries' in updates || 'retryDelay' in updates) &&
			this.refreshEscalated()
		) {
			this.notifyStatusCallbacks()
		}
	}

	isDestroyed(): boolean {
		return this.destroyed
	}

	isSyncing(): boolean {
		return this.isProcessing
	}

	private log(message: string, ...args: unknown[]): void {
		if (this.config.debug) {
			console.log(`[SyncService] ${message}`, ...args)
		}
	}
}

export function createSynchronizationService(
	userId: string,
	config?: Partial<SyncConfig>
): SynchronizationService {
	return new SynchronizationService(userId, config)
}
