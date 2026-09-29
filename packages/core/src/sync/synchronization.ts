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

import { z } from 'zod'
import {
  LocalStorageSyncQueueStorage,
  SyncQueue,
  SyncQueueClosedError,
  createSyncQueue,
} from './queue'
import type {
  ChangesPulledCallback,
  ConflictCallback,
  ConflictResolutionStrategy,
  ConflictResult,
  ConflictType,
  OperationsRejectedCallback,
  ProcessOperationResult,
  PullResult,
  RefusedServerChange,
  ServerChange,
  ServerChangesRefusedCallback,
  SyncConfig,
  SyncEntityType,
  SyncOperation,
  SyncOperationType,
  SyncResult,
  SyncState,
  SyncStatusCallback,
} from './types'
import { SyncStatus } from './types'
import { syncOperationDataSchema, validateServerRow } from './types'

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
 * How many refused operations `state.rejectedOperations` keeps (story 75.2).
 *
 * The array used to grow for the life of the service, because nothing ever
 * emptied it. It is not how refusals reach the user — `onOperationsRejected`
 * is — so it only needs to hold enough recent history to debug with. It is
 * CAPPED rather than drained by its reader: the reader is a callback that fires
 * inside `sync()`, so draining there would empty the array before any caller
 * of `sync()` could look at it.
 */
const MAX_RECORDED_REJECTIONS = 50

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
 * HTTP statuses that are POSITIVE evidence the server will never accept an
 * operation, so it may be removed from the queue.
 *
 * ⚠️ This is an ALLOW-LIST on purpose, and inverting it is a data-loss bug.
 * The earlier shape — "not 401/403 therefore permanent" — classified on the
 * ABSENCE of a signal, and the dominant failure path carries no signal at all:
 * `features/api/client.ts` maps any 200 envelope with `failedCount > 0` to
 * `retryable: false` WITHOUT a `statusCode`, and the server reaches that
 * envelope for transient causes because `applyOperation` and `createEntity`
 * wrap their whole bodies in a blanket `catch` that turns a dropped connection,
 * a statement timeout, a deadlock or a unique-constraint race into
 * `{ success: false }`. Under the old rule a single DB blip deleted the user's
 * queued edit from persisted storage forever. Contrast `synchronization.ts`'s
 * own standing requirement a few lines above the batch loop: "NFR: Zero
 * tolerance for data loss".
 *
 * 401 and 403 are excluded deliberately — they have their own buckets and both
 * stay queued. 429 and 5xx never arrive here at all (`client.ts` marks them
 * retryable). 408/425/413 are absent because they are transient or
 * payload-shaped, not operation-shaped: a smaller batch or a later attempt can
 * still succeed.
 *
 * Before ADDING a status here, confirm the server only ever emits it for an
 * operation that is invalid on its own terms.
 */
const PERMANENT_REJECT_STATUS_CODES: ReadonlySet<number> = new Set([
  400, // malformed operation body
  404, // the route or target does not exist
  409, // a genuine, server-declared conflict (not the conflict-detection path)
  422, // the operation parsed but failed server-side validation
])

/**
 * Whether `operation` belongs to a profile that has been DELETED on the server
 * (story 76.2), given the ids of the deleted profiles.
 *
 * ⚠️⚠️ `op.profileId` is the ACTIVE-profile stamp at queue time
 * (`config.profileId`), not the row's owner, and on a `userProfile` op it means
 * nothing at all: the server's `userProfiles` table has no `profileId` column.
 * It is also STALE in the one case that matters most. The host updates the stamp
 * after a profile switch has rendered, so deleting the ACTIVE default queues the
 * survivor's promotion carrying the DELETED profile's id, and a profile created
 * while P was active carries P too. So `userProfile` ops are never matched here:
 * dropping them would lose the user's chosen successor or a whole new profile.
 * A deleted profile's OWN op needs no arm here: its tombstone is applied only
 * when the server won last-writer-wins, which has already dropped every queued
 * op for that profile.
 *
 * For every other entity type the stamp is exactly what the server checks
 * (`profileBelongsToUser(operation.profileId)` in `server/api/sync.ts`), so an op
 * matched here can never CHANGE anything: a create fails `Profile not found` and
 * an update of a cascade-tombstoned row is an `update-delete` conflict, both for
 * ever. A delete of a cascade-tombstoned row would be acknowledged as a no-op
 * (story 76.1, `isAlreadyDeleted`), so dropping it is harmless too.
 *
 * Strict equality: an op with no stamp never matches (story 66.3's rule for a
 * destructive predicate).
 */
function isStrandedByDeletedProfile(
  operation: SyncOperation,
  deletedProfileIds: ReadonlySet<string>
): boolean {
  return (
    operation.entityType !== 'userProfile' &&
    typeof operation.profileId === 'string' &&
    deletedProfileIds.has(operation.profileId)
  )
}

/** `type:entityType:entityId` — how a `dependsOn` reference names an op. */
function operationKey(op: {
  type: SyncOperation['type']
  entityType: SyncOperation['entityType']
  entityId: string
}): string {
  return `${op.type}:${op.entityType}:${op.entityId}`
}

/**
 * Whether `operation` names a `dependsOn` target that is still queued and has
 * not landed in this sync (story 76.2, code review). `landed` holds the ops this
 * sync has already had accepted: they stay in the queue until the batch is
 * removed after the loop, so the queue alone cannot tell.
 */
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

/**
 * Generates a unique ID for sync operations.
 *
 * Uses `crypto.randomUUID()` when available to guarantee uniqueness — the
 * previous `Date.now()` + `Math.random()` scheme could collide under coarse or
 * frozen clocks (e.g. fake timers, rapid same-tick calls), and operation-id
 * collisions corrupt dedup/conflict detection and batch removal.
 */
function generateOperationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `sync-op-${crypto.randomUUID()}`
  }
  // Fallback for environments without crypto.randomUUID
  return `sync-op-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

/**
 * Deterministically serializes an object with sorted keys so that two payloads
 * with the same content but different key insertion order compare as equal.
 * Used for conflict detection to avoid false positives from `JSON.stringify`
 * being sensitive to key order.
 */
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

/**
 * Validates an operation's data payload before it enters the sync queue.
 *
 * Uses a permissive schema in which every entity field is optional: partial
 * payloads (e.g. an update that touches a single field, or an empty delete
 * payload) are valid, and the owning userId travels on the SyncOperation
 * itself rather than inside the data payload. Known fields are type-checked
 * and unknown keys are stripped, which prevents arbitrary/malformed data from
 * being persisted while still supporting create, update, and delete operations.
 *
 * @param data - The data payload to validate
 * @param entityType - Selects the per-entity refinement below, for bounds the one
 *   shared schema cannot express (story 66.5)
 * @returns The validated (and sanitized) data
 * @throws ZodError if a known field has the wrong type, or if it breaks its
 *   entity's own bound
 */
function validateOperationData(
  data: Record<string, unknown>,
  entityType: SyncEntityType
): Record<string, unknown> {
  const parsed = syncOperationDataSchema.parse(data)
  const refinement = perEntityRefinements[entityType]
  if (refinement) {
    // Throws a ZodError exactly as the schema above does, so the caller's
    // handling is unchanged. The stripped `parsed` is what we return — the
    // refinement supplies a verdict, never a rewrite.
    refinement.parse(parsed)
  }
  return parsed
}

/**
 * Per-entity bounds that `syncOperationDataSchema` structurally cannot express
 * (Story 66.5, decision D1).
 *
 * ⚠️⚠️ WHY THIS EXISTS AT ALL. `syncOperationDataSchema` is ONE FLAT SCHEMA shared
 * by every entity type, so a field two entities both carry gets ONE bound — the
 * loosest of the two. `currentBalance` is that field: `savingsGoals` must be
 * `>= 0`, but `balanceTracking` stores DEBT balances and must stay
 * negative-capable, so the shared declaration is `.min(PG_INT32_MIN)` and the
 * savings bound had nowhere to live. Narrowing the shared field would have
 * rejected every debt row in the product.
 *
 * ⚠️⚠️ WHY IT MATTERS MORE THAN AN ORDINARY BOUND. Story 66.5 made
 * `savingsGoals_currentBalance_non_negative` a REAL database constraint. In this
 * product a constraint violation on the push path is not a clean rejection: the
 * server catches the PG error and returns a 200 envelope with `failedCount > 0`
 * and NO status code, the client marks it `retryable: false` with no
 * `statusCode`, and this file's own `unclassifiedFailedOperations` handling
 * DELIBERATELY KEEPS IT QUEUED (removal requires positive proof of permanence).
 * The operation then replays every cycle until the circuit breaker opens and ALL
 * sync for that account stops. Refusing here instead costs one un-synced row and
 * a console error; letting it through costs the account's whole sync.
 *
 * Bounds that are already right in the shared schema do NOT belong here — this map
 * is for invariants the shared schema cannot state, not a second copy of the ones it
 * can. For the record, the five SYNCED constraints and where each is already gated
 * (the two `users` checks are not synced, so they are not in this list):
 *   - `incomeSources.amount > 0`      → `amount.positive()`
 *   - `expenses.amount > 0`           → `amount.positive()`
 *   - `savingsGoals.targetAmount`     → `targetAmount.positive().nullable()`
 *   - `savingsGoals.monthlyAllocation`→ `monthlyAllocation.min(0).nullable()`
 *   - `balanceTracking.monthlyContribution` → `monthlyContribution.min(0)`
 * `savingsGoals.currentBalance` is the sixth and the only one the shared schema
 * cannot express, which is why this map exists at all.
 *
 * ⚠️ An earlier version of this list omitted `targetAmount` and read as though the
 * inventory were complete. Code review caught it.
 */
const perEntityRefinements: Partial<Record<SyncEntityType, z.ZodTypeAny>> = {
  savingsGoal: z
    .object({
      // `.optional()` because an operation payload is partial — an update that
      // does not touch the balance must not be rejected for omitting it.
      currentBalance: z.number().int().min(0).optional(),
    })
    // ⚠️ `.passthrough()` is here for INTENT, not for behaviour, and code review was
    // right that the original comment implied otherwise. A zod object STRIPS unknown
    // keys by default rather than rejecting them, and this refinement's parse OUTPUT
    // is discarded anyway (`validateOperationData` returns the shared schema's
    // `parsed`), so removing it would change nothing today. It stays because it says
    // what this object is: a judgement on ONE declared field, not a second schema.
    .passthrough(),
}

/**
 * In-memory cache for device IDs when storage is unavailable
 * Maps userId to deviceId for per-user device tracking
 */
const cachedDeviceIds: Map<string, string> = new Map()

/**
 * Generate a fresh, collision-resistant device identifier.
 *
 * Uses `crypto.randomUUID()` when available (122 bits of CSPRNG entropy) rather
 * than `Math.random()`, which is non-cryptographic and can collide. A device ID
 * keys per-user device tracking, so a predictable/colliding value is a security
 * concern, not just a correctness one. The non-crypto fallback only runs in
 * environments without Web Crypto.
 */
function newDeviceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `device-${crypto.randomUUID()}`
  }
  // Fallback for environments without crypto.randomUUID
  return `device-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

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
      deviceId = newDeviceId()
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
        deviceId = newDeviceId()
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
        deviceId = newDeviceId()
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
  private changesPulledCallbacks: Set<ChangesPulledCallback> = new Set()
  private operationsRejectedCallbacks: Set<OperationsRejectedCallback> = new Set()
  private serverChangesRefusedCallbacks: Set<ServerChangesRefusedCallback> = new Set()
  private autoSyncTimer: ReturnType<typeof setInterval> | null = null
  private isProcessing = false
  // Set when a sync trigger (e.g. coming back online) arrives while a sync is
  // already in progress, so we run one more pass after the current one finishes
  // instead of dropping the trigger.
  private pendingResync = false
  // Set FIRST by `destroy()` and never reset (story 79.1). Every entry point and
  // every point after an `await` checks it: a torn-down service sends nothing,
  // arms no timer, writes no state and touches no queue. See `destroy()`.
  private destroyed = false
  private retryTimeout: ReturnType<typeof setTimeout> | null = null
  // Consecutive failed attempts per queued op id (story 79.2). In memory only:
  // the count never travels with the op, so no queue or server shape changes.
  // Pruned to the queued ids in `refreshEscalated()`, so it cannot outgrow the queue.
  private failureCounts: Map<string, number> = new Map()
  // When each op's current run of failures began (story 79.2 code review, the
  // TIME FLOOR). Set on the first failure of a run, cleared with its count.
  private firstFailureAt: Map<string, number> = new Map()

  // Circuit breaker state for retry logic
  private circuitBroken = false
  private circuitBrokenUntil = 0
  private consecutiveFailures = 0

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

    // ⚠️ A `destroy()` that landed during the load removed no listener, because
    // none was registered yet. Registering them now would leave a dead service
    // pushing the queue on every tab focus, for good (story 79.1).
    if (this.destroyed) {
      return
    }

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

    // A second await above: a `destroy()` that landed during it has already
    // removed the listeners, so only the timer and the notify are left to skip.
    if (this.destroyed) {
      return
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
    // Public, so it is guarded here too: no interval may outlive `destroy()`.
    if (this.destroyed || this.autoSyncTimer) {
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
   * Clean up resources, and stop this service from ever touching the queue again
   * (story 79.1, FR129).
   *
   * `useSync` destroys the service on sign-out, account switch or any effect
   * re-run, while a sync or pull may still be in flight. Before 79.1 that sync
   * ran on: it removed refused ops after `destroy()` had cleared every listener
   * (no revert, no notice), wrote its stale in-memory queue over the storage key
   * a NEW instance for the same user was already using, and could still arm a
   * retry.
   *
   * DECISION: SKIP MUTATION, not deliver later. The destroyed service leaves the
   * queue exactly as persisted and discards what its in-flight sync learned. The
   * next session re-sends those ops and learns every outcome again: a refused op
   * is refused again, now with a listener; an accepted create or delete is
   * acknowledged by the server as already applied (`processBatchSync`'s
   * `create-create` arm, 76.1's `alreadyApplied`); an accepted update re-applies.
   *
   * ⚠️ The cost of that last case (code review 79.1, accepted by Lucas): the
   * server's update path does not compare `baseVersion`, so if ANOTHER device
   * edits the same row before this user's next session, the re-sent update
   * overwrites that newer edit. It needs a sign-out during a push plus a
   * concurrent edit elsewhere. It is the same residual as any lost push response
   * (triage 2026-09-29, M4), and its fix is server-side (`deferred-work.md`).
   * Delivering the outcome to the next session instead would need refusal state
   * that outlives this instance, keyed by user and cleared on account switch —
   * the kind of cross-account state 75.2's review had to remove.
   *
   * Two layers: `destroyed` stops sends, timers, state writes and notifications
   * here; `queue.close()` stops every WRITE, including the web layer's, which
   * reaches the raw queue through `getQueue()`.
   */
  destroy(): void {
    this.destroyed = true
    this.queue.close()
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
    this.changesPulledCallbacks.clear()
    this.operationsRejectedCallbacks.clear()
    this.serverChangesRefusedCallbacks.clear()
  }

  /**
   * Refuse to queue on a destroyed service (story 79.1). Its queue is closed, so
   * the add would fail anyway; this names the reason.
   */
  private assertNotDestroyed(): void {
    if (this.destroyed) {
      throw new Error('Sync service destroyed: cannot queue an operation')
    }
  }

  /** What `sync()` returns once the service is destroyed (story 79.1). */
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

  /** What `pull()` returns once the service is destroyed (story 79.1). */
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
    if (this.queue.getCount() > 0) {
      if (this.isProcessing) {
        // A sync is already running; the isProcessing guard would make this
        // call a no-op and the reconnect trigger would be lost. Mark that a
        // follow-up sync is needed once the current one finishes.
        this.pendingResync = true
      } else {
        this.sync().catch((error) => {
          this.log('Online sync error:', error)
        })
      }
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
      this.log(
        `WARNING: Maximum callbacks (${MAX_CALLBACKS}) reached. Possible memory leak - forgot to unsubscribe?`
      )
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
      this.log(
        `WARNING: Maximum callbacks (${MAX_CALLBACKS}) reached. Possible memory leak - forgot to unsubscribe?`
      )
    }
    this.conflictCallbacks.add(callback)
    return () => this.conflictCallbacks.delete(callback)
  }

  /**
   * Add a callback for server changes applied during a pull (Story 4-18).
   * The host app (web layer) subscribes to write applied changes into its UI
   * stores; the core never imports the stores.
   * @param callback - The callback function
   * @returns Unsubscribe function to remove the callback
   */
  onChangesPulled(callback: ChangesPulledCallback): () => void {
    if (this.changesPulledCallbacks.size >= MAX_CALLBACKS) {
      this.log(
        `WARNING: Maximum callbacks (${MAX_CALLBACKS}) reached. Possible memory leak - forgot to unsubscribe?`
      )
    }
    this.changesPulledCallbacks.add(callback)
    return () => this.changesPulledCallbacks.delete(callback)
  }

  /**
   * Subscribe to the operations a sync permanently refused (story 75.2, FR119).
   * Fired once per sync, after the refused ops have left the queue, with that
   * sync's refusals only. The web layer names each refused entry to the user and
   * reverts it locally.
   * @param callback - The callback function
   * @returns Unsubscribe function to remove the callback
   */
  onOperationsRejected(callback: OperationsRejectedCallback): () => void {
    if (this.operationsRejectedCallbacks.size >= MAX_CALLBACKS) {
      this.log(
        `WARNING: Maximum callbacks (${MAX_CALLBACKS}) reached. Possible memory leak - forgot to unsubscribe?`
      )
    }
    this.operationsRejectedCallbacks.add(callback)
    return () => this.operationsRejectedCallbacks.delete(callback)
  }

  /**
   * Notify all operations-rejected callbacks. Each gets its own copy, and one
   * throwing callback cannot stop the others or the sync.
   */
  private notifyOperationsRejectedCallbacks(operations: SyncOperation[]): void {
    for (const callback of this.operationsRejectedCallbacks) {
      try {
        callback([...operations])
      } catch (error) {
        this.log('Operations-rejected callback error:', error)
      }
    }
  }

  /**
   * Subscribe to the server rows a pull REFUSED (story 75.4, FR123). Fired once
   * per pull, after the cursor is set, with that pull's refusals only, and not at
   * all when nothing was refused. The web layer reports them (developer channel).
   * @param callback - The callback function
   * @returns Unsubscribe function to remove the callback
   */
  onServerChangesRefused(callback: ServerChangesRefusedCallback): () => void {
    if (this.serverChangesRefusedCallbacks.size >= MAX_CALLBACKS) {
      this.log(
        `WARNING: Maximum callbacks (${MAX_CALLBACKS}) reached. Possible memory leak - forgot to unsubscribe?`
      )
    }
    this.serverChangesRefusedCallbacks.add(callback)
    return () => this.serverChangesRefusedCallbacks.delete(callback)
  }

  /**
   * Notify all server-changes-refused callbacks. Each gets its own copy, and one
   * throwing callback cannot stop the others or the pull.
   */
  private notifyServerChangesRefusedCallbacks(refused: RefusedServerChange[]): void {
    for (const callback of this.serverChangesRefusedCallbacks) {
      try {
        callback([...refused])
      } catch (error) {
        this.log('Server-changes-refused callback error:', error)
      }
    }
  }

  /**
   * Notify all changes-pulled callbacks with the applied server changes.
   */
  private notifyChangesPulledCallbacks(changes: ServerChange[]): void {
    for (const callback of this.changesPulledCallbacks) {
      try {
        callback([...changes])
      } catch (error) {
        this.log('Changes-pulled callback error:', error)
      }
    }
  }

  /**
   * Notify all status callbacks
   */
  private notifyStatusCallbacks(): void {
    for (const callback of this.statusCallbacks) {
      try {
        callback({ ...this.state })
      } catch (error) {
        this.log('Status callback error:', error)
      }
    }
  }

  /**
   * Notify all conflict callbacks
   * @param conflict - The conflict result
   */
  private notifyConflictCallbacks(conflict: ConflictResult): void {
    for (const callback of this.conflictCallbacks) {
      try {
        callback({ ...conflict })
      } catch (error) {
        this.log('Conflict callback error:', error)
      }
    }
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
    this.assertNotDestroyed()

    // Security: Validate userId matches authenticated user
    if (userId !== this.userId) {
      throw new Error(
        `Unauthorized: Operation userId mismatch. Expected: ${this.userId}, Got: ${userId}`
      )
    }

    // Validate operation data payload against the sync operation schema
    // FIX: Added schema validation to prevent arbitrary data in sync operations
    const validatedData = validateOperationData(data, entityType)

    const operation: SyncOperation = {
      id: generateOperationId(),
      type: 'create',
      entityType,
      entityId: String(entityId),
      data: validatedData,
      timestamp: Date.now(),
      deviceId: this.deviceId,
      userId,
      // Stamp the active profile so profile-scoped entities satisfy the
      // server's `profileId NOT NULL` requirement (DN2: service-level config).
      profileId: this.config.profileId,
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
    version?: number,
    baseVersion?: number,
    dependsOn?: SyncOperation['dependsOn']
  ): Promise<SyncOperation> {
    this.assertNotDestroyed()

    // Security: Validate userId matches authenticated user
    if (userId !== this.userId) {
      throw new Error(
        `Unauthorized: Operation userId mismatch. Expected: ${this.userId}, Got: ${userId}`
      )
    }

    // Validate operation data payload against the sync operation schema
    // FIX: Added schema validation to prevent arbitrary data in sync operations
    const validatedData = validateOperationData(data, entityType)

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
      // Server `updatedAt` this edit was based on, for causal pull LWW (D1).
      baseVersion,
      // Stamp the active profile (DN2: service-level config).
      profileId: this.config.profileId,
      // Only when set, so an op without a link serializes exactly as before.
      ...(dependsOn ? { dependsOn } : {}),
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
    data: Record<string, unknown> = {},
    baseVersion?: number
  ): Promise<SyncOperation> {
    this.assertNotDestroyed()

    // Security: Validate userId matches authenticated user
    if (userId !== this.userId) {
      throw new Error(
        `Unauthorized: Operation userId mismatch. Expected: ${this.userId}, Got: ${userId}`
      )
    }

    // For delete operations, data is typically empty; the permissive schema
    // accepts an empty payload and still rejects malformed data when provided.
    // FIX: Added schema validation to prevent arbitrary data in sync operations
    const validatedData = validateOperationData(data, entityType)

    const operation: SyncOperation = {
      id: generateOperationId(),
      type: 'delete',
      entityType,
      entityId: String(entityId),
      data: validatedData,
      timestamp: Date.now(),
      deviceId: this.deviceId,
      userId,
      // Server `updatedAt` this delete was based on, for causal pull LWW (D1).
      baseVersion,
      // Stamp the active profile so profile-scoped entities satisfy the
      // server's `profileId NOT NULL` requirement (DN2: service-level config).
      profileId: this.config.profileId,
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

    // Same operation type on the same entity.
    // (Same device and same operation id were already excluded above.)
    if (localOp.type === serverOp.type) {
      // Two deletes of the same entity are idempotent - not a conflict.
      if (localOp.type === 'delete') {
        return { hasConflict: false }
      }

      // For updates, a version mismatch is a conflict regardless of payload.
      // A one-sided version (one op carries a version, the other does not) is
      // also a mismatch — treating it as "no conflict" would silently accept a
      // stale optimistic-concurrency write.
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

      // For create+create and update+update, differing payloads are a conflict.
      // Use a key-order-independent comparison to avoid false positives from
      // JSON.stringify being sensitive to property insertion order.
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

      default: {
        // Last write wins based on timestamp.
        // If timestamps are equal, use deviceId as deterministic tiebreaker.
        // Notify conflict callbacks so an auto-resolved conflict (which may
        // discard one side's write — e.g. an equal-timestamp tie) is observable
        // rather than silently losing data.
        let winner: SyncOperation
        if (localOp.timestamp > serverOp.timestamp) {
          winner = localOp
        } else if (localOp.timestamp < serverOp.timestamp) {
          winner = serverOp
        } else {
          // Timestamps are equal, use deviceId as tiebreaker
          winner = localOp.deviceId > serverOp.deviceId ? localOp : serverOp
        }
        this.notifyConflictCallbacks({ ...conflictResult, resolution: winner })
        return winner
      }
    }
  }

  /**
   * Sync all pending operations to the server
   * This is the main synchronization method
   *
   * Uses atomic check-and-set for isProcessing to prevent TOCTOU race conditions
   */
  async sync(): Promise<SyncResult> {
    // A destroyed service sends nothing (story 79.1). Checked before the lock, so
    // a dead service never holds it either.
    if (this.destroyed) {
      return this.destroyedSyncResult(Date.now())
    }

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
        // An empty queue is a clean state (story 75.3). Without this reset, a queue
        // emptied by pull LWW left the budget spent, and the next genuine failure
        // got no fast retry. Nothing is failing, so the view is empty too.
        this.state.retryCount = 0
        this.state.failedOperations = []
        // The queue can be emptied outside the service (the web layer's refused-
        // create sweep calls `discardBatch` directly), so refresh this too.
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

      // Process operations in batches
      // IMPORTANT: Track which operations to remove AFTER all processing is complete
      // This prevents data loss if batch fails mid-processing (NFR: Zero tolerance for data loss)
      // FIX: Only count as synchronized AFTER operations are removed from the queue
      // This prevents duplicate processing if removeBatch fails
      let synchronizedCount = 0
      let failedCount = 0
      let conflictCount = 0
      // Retryable (transient/5xx) failures. They stay queued and are retried (story 75.3).
      const failedOperations: SyncOperation[] = []
      // Non-retryable failures split by WHY the server said no. Conflating them
      // was a defect: a permanently-rejected op that stays queued is replayed
      // every cycle, pins the status at FAILED and re-opens the circuit breaker,
      // which suppresses retries for every OTHER entity.
      //
      // ⚠️ The split is deliberately ASYMMETRIC: an op only leaves the queue on
      // POSITIVE evidence that the server will never accept it. Classifying on
      // the ABSENCE of a status code was a data-loss bug — see
      // `PERMANENT_REJECT_STATUS_CODES` for the full reasoning.
      //
      // Auth-blocked (401): the op is VALID and only the SESSION is not, so it
      // stays queued and syncs after re-authentication. Removing it = data loss.
      const authBlockedOperations: SyncOperation[] = []
      // Tier-blocked (403): the op is VALID and so is the session — the account
      // simply no longer carries server sync (`routes/api/sync/batch.ts` returns
      // 403 when `!hasPaidAccess(subscriptionStatus)` — web's
      // `lib/premium/access-statuses.ts`). Re-auth
      // cannot clear it, so unlike 401 this must NOT open the circuit every
      // cycle; the data is kept for a user who may re-subscribe.
      const tierBlockedOperations: SyncOperation[] = []
      // Rejected (a status code that names a permanent rejection): the server has
      // told us it will never accept this operation, so it leaves the queue.
      const rejectedOperations: SyncOperation[] = []
      // Non-retryable but UNCLASSIFIED — `retryable: false` with no status code
      // that proves permanence. Stays queued. This is the 200-envelope class
      // (`features/api/client.ts` maps any `failedCount > 0` to `retryable:false`
      // WITHOUT a status code), which the server produces for transient causes:
      // `applyOperation`/`createEntity` collapse every thrown error — dropped
      // connection, statement timeout, deadlock, constraint race — into it.
      // Removing these deleted the user's edit permanently on the first blip.
      const unclassifiedFailedOperations: SyncOperation[] = []
      const conflictOperations: SyncOperation[] = []
      const successfullyProcessed: SyncOperation[] = []

      for (const operation of operations) {
        // Torn down mid-batch (story 79.1): send nothing more. Checked first, so a
        // dead service never sends the rest of a batch it can no longer dequeue.
        if (this.destroyed) {
          break
        }

        // Re-check connectivity before each operation: if the device went
        // offline mid-batch, stop sending. Remaining operations stay in the
        // queue (they are only removed after success) and are not wrongly
        // marked failed or charged against the retry budget.
        if (!this.state.isOnline) {
          this.log('Device went offline during sync; stopping batch early')
          break
        }

        // ⚠️ A dependent waits for the op it `dependsOn` (story 76.2, code review,
        // decision (a)). Sending a promotion while its deletion had failed let the
        // server demote the deleted profile — bumping its `updatedAt` — so the
        // next pull saw it live and newer than the deletion, and dropped the
        // deletion: the device undid its own user's delete. The dependent stays
        // queued, unsent and uncounted, until the target leaves the queue.
        if (dependsOnStillPending(operation, this.queue.getAll(), successfullyProcessed)) {
          this.log('Holding an operation until the one it depends on has landed')
          continue
        }

        try {
          const result = await this.processOperation(operation)

          if (result.success) {
            // Track operation as successfully processed (but don't count yet)
            successfullyProcessed.push(operation)
          } else if (result.conflict) {
            // Conflict detected
            conflictOperations.push(operation)
            conflictCount++
          } else if (result.retryable === false) {
            // Non-retryable. Classify by status. Removal requires POSITIVE proof
            // of permanence; anything else stays queued (see the bucket comments).
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
            // Retryable failure
            failedOperations.push(operation)
            failedCount++
          }
        } catch (error) {
          this.log('Operation processing error:', error, operation)
          failedOperations.push(operation)
          failedCount++
        }
      }

      // ⚠️ Torn down while a push was in flight (story 79.1): throw away what this
      // sync learned. Every queue write, state write, notification and timer below
      // would act for a session that has ended — and the queue is closed anyway.
      // The next session re-sends these ops and learns each outcome again (see
      // `destroy()`).
      if (this.destroyed) {
        return this.destroyedSyncResult(startTime)
      }

      // A permanently refused CREATE takes its row's other queued ops with it
      // (story 75.1 code review, decision D1 — Lucas, 2026-09-28).
      //
      // The row then exists locally but never on the server, so every later op
      // for it can only fail: an update or delete is answered `update-delete` /
      // `Entity not found` — a conflict (never removed) or an unclassified failure
      // (kept queued) — and the account-wide deadlock returns one op later. They
      // are refused WITH the create and recorded alongside it.
      //
      // ⚠️ Keyed on entityType AND entityId, and ONLY for a refused CREATE: a
      // refused update leaves a row that exists server-side, so its siblings can
      // still succeed. ⚠️ This covers ops ALREADY queued. Story 75.2 decided the
      // rest (revert): the web layer drops any op for the row queued after this
      // sweep and removes the row from the device (`lib/sync/refusedEdits.ts`). ⚠️ A refused PROFILE
      // create does not reach its children here (different entityType): the web
      // layer drops them through `discardOperationsForDeletedProfile` (story 76.2).
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
          // Out of every bucket this batch already filed them in, so none is
          // retried as a retryable failure and no conflict is recorded for one.
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

      // A dependent leaves WITH a permanently refused target (story 76.2, code
      // review): a promotion whose deletion the server will never accept would
      // otherwise push later and move the default because of a deletion that did
      // not happen. It was held above, so it sits in no bucket; it is reported
      // with the refusal, and the web layer reverts it like any refused update.
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

      // Remove all successfully processed operations from queue at once
      // Only count as synchronized AFTER successful removal
      if (successfullyProcessed.length > 0) {
        const operationsToRemove = successfullyProcessed.map((op) => op.id)
        try {
          await this.queue.removeBatch(operationsToRemove)
          // Only count as synchronized AFTER successful removal from queue
          synchronizedCount = successfullyProcessed.length
        } catch (removeError) {
          this.log('Failed to remove operations from queue:', removeError)
          // They stay queued and are re-sent by a later sync. They count as
          // failed but are deliberately kept OUT of `failedOperations`: the
          // server ACCEPTED them, so the retryable view (and its fast retry
          // timer) must not claim them. Fast-retrying ops the server already
          // applied only hastens the re-send (story 75.3 code review, P4).
          failedCount += successfullyProcessed.length
          // Don't count as synchronized
          synchronizedCount = 0
        }
      }

      // Retryable failures STAY in the persisted queue (story 75.3, FR120).
      //
      // They used to be removed here and parked in `state.failedOperations`, in
      // memory only, for `runRetry` to re-add. A reload before the retry timer
      // fired lost them, and so did an exhausted retry budget, because then
      // nothing re-added them. While parked they were also invisible to every
      // queue reader: pull's LWW index applied an older server row that the retry
      // then overwrote, and `hasPendingOperations` let a profile create be queued
      // twice. Kept queued, the next sync of any kind carries them, whatever the
      // budget says. The retry timer below is only the FAST path.

      // Remove PERMANENTLY REJECTED operations from the queue. The server has
      // named a status that proves it will never accept them, and replaying one
      // blocks the whole queue.
      //
      // What was dropped reaches the user through `onOperationsRejected`
      // (story 75.2), which fires below once the state is updated: the web layer
      // names each refused entry and reverts it locally.
      //
      // `discardBatch`, not `removeBatch` (story 75.3): when storage refuses the
      // write (quota, private mode, blocked site data), the ops still leave this
      // session's queue, so they are neither replayed nor left unannounced.
      // `removeBatch` kept them queued, and because the next removal failed the
      // same way, they replayed every cycle, silently. ⚠️ Limit: storage still
      // holds them, so a reload before any later successful write sends them once
      // more. They are then refused and announced once more.
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
          // `discardBatch` does not throw for a storage failure, so this is
          // something unexpected. Stay conservative: they may still be queued, so
          // do not announce them as dropped.
          this.log('Failed to discard rejected operations from queue:', removeError)
          recordableRejectedOps = []
        }
      }

      // Non-retryable but unclassified ops are intentionally NOT removed: leaving
      // them in the queue is the whole point, so they survive
      // a transient server fault and go out again on the next sync. Logged so the
      // "kept rather than dropped" decision is observable during debugging.
      if (unclassifiedFailedOperations.length > 0) {
        this.log(
          `Keeping ${unclassifiedFailedOperations.length} non-retryable operation(s) with no permanent-rejection status; they stay queued for the next sync.`,
          unclassifiedFailedOperations.map((op) => op.id)
        )
      }

      // Torn down during a removal await (story 79.1). The closed queue refused
      // any write that had not started; no state, notification or timer follows.
      if (this.destroyed) {
        return this.destroyedSyncResult(startTime)
      }

      // Update state
      this.state.lastSyncTimestamp = Date.now()
      this.state.pendingOperations = this.queue.getAll()
      // A VIEW, not a carrier (story 75.3): this sync's retryable failures that
      // are still queued. It is replaced each sync, and is a subset of
      // `pendingOperations`, never in addition to it.
      this.state.failedOperations = this.retryableStillQueued(failedOperations)
      // Story 79.2: count this sync's attempts, then re-derive the escalated view.
      // Counted HERE, past every destroyed check, so a torn-down sync counts
      // nothing, and after 75.1's D1 sweep, so a refused create's follow-ups
      // (moved out of the failure buckets above) are not counted as failures.
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
      // Capped, not unbounded (story 75.2): see `MAX_RECORDED_REJECTIONS`.
      this.state.rejectedOperations = [
        ...this.state.rejectedOperations,
        ...recordableRejectedOps,
      ].slice(-MAX_RECORDED_REJECTIONS)

      // Determine final status
      if (failedCount > 0 || conflictCount > 0) {
        this.state.status = SyncStatus.FAILED
        // Count this sync as a consecutive failure for the circuit breaker.
        // Previously the breaker only tripped when a retry-triggered sync threw,
        // so a server returning { success: false } indefinitely never opened it.
        this.consecutiveFailures++
        if (this.consecutiveFailures >= CIRCUIT_BREAKER_CONFIG.failureThreshold) {
          this.openCircuit()
        }
      } else {
        this.state.status = SyncStatus.COMPLETED
        // Reset circuit breaker + retry budget on a fully successful sync so
        // future transient failures get a fresh set of retry attempts.
        this.consecutiveFailures = 0
        this.state.retryCount = 0
      }

      this.notifyStatusCallbacks()

      if (recordableRejectedOps.length > 0) {
        this.notifyOperationsRejectedCallbacks(recordableRejectedOps)
      }

      // AUTH-blocked failures only: open the circuit to stop auto-retrying an
      // operation that cannot succeed until the user re-authenticates.
      //
      // ⚠️ This is deliberately NOT an `else if` chain with the retry below. It
      // used to be, and that stranded work: when one batch produced BOTH an
      // auth-blocked op and a retryable one, opening the circuit consumed the
      // branch and `scheduleRetry()` never ran. At the time, retryable ops were
      // removed from the queue and only a retry re-queued them, so the local edit
      // was lost on reload. (Since story 75.3 they stay queued, so a skipped retry
      // now only delays them.) The two decisions are independent and both must be
      // evaluated.
      //
      // ⚠️⚠️ TIER-blocked (403) is deliberately ABSENT from this condition. It
      // used to be folded in with 401, which re-opened the circuit on EVERY sync
      // for a downgraded account — reinstating, for a different status class, the
      // exact "replayed forever, suppresses retries for every other entity" defect
      // this whole split exists to remove. A 403 cannot be cleared by re-auth or
      // by waiting, so a cooldown buys nothing; the ops stay queued for a user who
      // may re-subscribe, and `consecutiveFailures` above still provides back-off.
      if (authBlockedOperations.length > 0) {
        this.openCircuit()
      }
      if (tierBlockedOperations.length > 0) {
        this.state.lastError =
          'Server sync is not included in your current plan. Your changes are saved on this device and will sync if you resubscribe.'
      }
      if (
        // Schedule retry only for retryable failures and only if retries remain.
        this.state.failedOperations.length > 0 &&
        this.state.retryCount < this.config.maxRetries
      ) {
        this.scheduleRetry()
      } else if (
        // Drain remaining batches: a fully successful batch may have left more
        // operations queued (queue size > batchSize). Trigger another sync on
        // the next tick so the whole backlog drains instead of one batch per
        // external trigger.
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
      // No state write for a session that has ended (story 79.1).
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

      // If a sync trigger arrived while we were processing (e.g. reconnect),
      // run one more pass now that the lock is released.
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

  /**
   * Process a single operation
   * If a custom processOperation function is provided in config, it will be used.
   * Otherwise, this returns success without actually processing (for testing/mocking).
   * @param operation - The sync operation to process
   */
  private async processOperation(operation: SyncOperation): Promise<ProcessOperationResult> {
    // If a custom processOperation function is provided, use it
    if (this.config.processOperation) {
      return this.config.processOperation(operation)
    }

    // No transport configured. Throwing (rather than returning success) is
    // deliberate: returning { success: true } here would make sync() delete the
    // operation from the queue as "synchronized" even though nothing was ever
    // sent to the server — silent data loss. Callers MUST provide a
    // processOperation (the client hook wires the server function).
    throw new Error(
      'No processOperation configured: refusing to mark operations as synced ' +
        'to avoid silent data loss. Provide config.processOperation.'
    )
  }

  /**
   * Schedule a retry for failed operations
   *
   * FIX: Added circuit breaker to prevent hammering failing server
   */
  private scheduleRetry(): void {
    // No timer may outlive `destroy()` (story 79.1).
    if (this.destroyed) {
      return
    }

    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout)
    }

    // Check if circuit is open (broken)
    const now = Date.now()
    if (this.circuitBroken) {
      if (now < this.circuitBrokenUntil) {
        // Circuit is open. DEFER the retry to just after the cooldown rather than
        // dropping it.
        //
        // ⚠️ This used to `return`. At the time that stranded work, because
        // retryable ops had been removed from the queue and only `runRetry`
        // re-queued them. Since story 75.3 they stay queued, so a dropped timer
        // would only delay them until the next sync of any kind. The deferral
        // still matters: it is the fast path, and the web app has no periodic push
        // (`useSync` passes `autoSync: false`).
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
          // ⚠️ Re-check the deadline instead of closing the circuit blind.
          // `delay` was computed from the `circuitBrokenUntil` observed when this
          // timer was ARMED, but `openCircuit()` can push that deadline out
          // afterwards without clearing this handle — a later sync that produces
          // auth-blocked ops and no retryable ones never re-enters
          // `scheduleRetry()`. The timer would then fire on the old schedule and
          // drain inside a cooldown that was just extended, defeating the breaker
          // under exactly the sustained failure it exists for.
          if (Date.now() < this.circuitBrokenUntil) {
            this.scheduleRetry()
            return
          }
          // Re-check the retry budget too: it can be exhausted by another path
          // during the wait, and `runRetry` increments `retryCount` BEFORE its
          // own empty-check, so an unguarded fire burns an attempt for nothing.
          if (this.state.retryCount >= this.config.maxRetries) {
            this.log('Circuit cooldown elapsed but the retry budget is exhausted; not draining.')
            return
          }
          // The cooldown has now elapsed; close the circuit and drain.
          this.circuitBroken = false
          this.consecutiveFailures = 0
          void this.runRetry()
        }, delay)
        return
      }
      // Cooldown period has passed, try to close the circuit
      this.circuitBroken = false
      this.consecutiveFailures = 0
      this.log('Circuit breaker: Cooldown complete. Resuming retries.')
    }

    this.retryTimeout = setTimeout(() => {
      // `runRetry` is async. Its failures are caught inside it, and the ops it
      // retries never left the queue (story 75.3), so a failure loses nothing.
      void this.runRetry()
    }, this.config.retryDelay)
  }

  /**
   * One retry attempt: sync again. The failed operations never left the queue
   * (story 75.3), so there is nothing to re-add. ⚠️ Re-adding one here would
   * DUPLICATE its id in the queue.
   *
   * ⚠️ Checked BEFORE the attempt is counted (story 75.3 code review, P2). A timer
   * outlives the failure that armed it: if an external sync has since landed the
   * ops (resetting `retryCount`), or the web sweep discarded them, or the device
   * is offline, the timer must neither spend the budget nor send the rest of the
   * queue (kept-queued 403/unclassified ops) as though it were a retry. Offline
   * ops go out on the `online` event instead.
   */
  private async runRetry(): Promise<void> {
    if (this.destroyed) {
      return
    }
    this.state.failedOperations = this.retryableStillQueued(this.state.failedOperations)
    // The queue can change under the service (the web sweep's `discardBatch`),
    // and this early return notifies nobody, so say so when the view moved
    // (story 79.2 code review): otherwise a notice outlives its op.
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
      // Track consecutive failures for circuit breaker
      this.consecutiveFailures++
      if (this.consecutiveFailures >= CIRCUIT_BREAKER_CONFIG.failureThreshold) {
        this.openCircuit()
      }
    }
  }

  /**
   * The subset of `operations` still in the queue. It keeps the
   * `state.failedOperations` view from naming an op that has since left the
   * queue (story 75.3).
   */
  private retryableStillQueued(operations: SyncOperation[]): SyncOperation[] {
    const queuedIds = new Set(this.queue.getAll().map((op) => op.id))
    return operations.filter((op) => queuedIds.has(op.id))
  }

  /**
   * How many consecutive failed attempts escalate an op to the user (story 79.2,
   * decision D2): `maxRetries + 1`, 4 with the defaults. That is the attempt at
   * which the fast retry path gives up on a fresh retryable op (the first try
   * plus `maxRetries` timed retries). Derived from the config so a caller that
   * tunes `maxRetries` keeps the two in step.
   *
   * ⚠️ An UNCLASSIFIED failure arms no retry timer, so it reaches the threshold
   * only through external syncs (an edit, a tab becoming visible, `online`,
   * mount). Counts live in memory, so it needs that many in ONE session.
   */
  private escalationThreshold(): number {
    return this.config.maxRetries + 1
  }

  /**
   * The TIME FLOOR (story 79.2 code review, decision: Lucas 2026-09-29): an op
   * escalates only once its run of failures has also lasted as long as the fast
   * retry path would take, `maxRetries × retryDelay` (15 s with the defaults).
   * Attempts are counted per sync, whatever triggered it, so without this a few
   * quick edits during a short blip reached the threshold in seconds.
   */
  private escalationFloorMs(): number {
    return this.config.maxRetries * this.config.retryDelay
  }

  /**
   * Record one sync's attempt outcomes (story 79.2). `failed` are the ops whose
   * attempt ended in a failure that keeps them queued (retryable or
   * unclassified): their count goes up. Every other ATTEMPTED op (landed,
   * conflict, 401, 403, refused) starts again from zero. An op this sync did not
   * attempt (held by `dependsOn`, cut off by going offline) appears in neither
   * list, so its count is left as it was.
   *
   * Counted per unique id (code review): the queue does not dedupe, and a
   * duplicated id must neither count twice per sync nor count at all when one of
   * its copies landed.
   */
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

  /**
   * Re-derive `state.escalatedOperations` from the queue (story 79.2), and
   * forget the count of every op that has left it. Called wherever
   * `state.failedOperations` is refreshed, and on every pull, so the view never
   * names an op that is no longer queued. It removes nothing from the queue
   * (FR120). Returns whether the view changed.
   */
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

  /**
   * Open the circuit breaker to prevent further retries
   * Called after consecutive failures exceed the threshold
   */
  private openCircuit(): void {
    this.circuitBroken = true
    this.circuitBrokenUntil = Date.now() + CIRCUIT_BREAKER_CONFIG.cooldownPeriod
    this.log(
      `Circuit breaker: OPENED. Too many consecutive failures (${this.consecutiveFailures}). Retries paused for ${CIRCUIT_BREAKER_CONFIG.cooldownPeriod}ms.`
    )
  }

  /**
   * Manual sync trigger
   * Forces a sync regardless of auto-sync settings
   */
  async forceSync(): Promise<SyncResult> {
    return this.sync()
  }

  /**
   * Pull server-side changes since the last pull cursor and reconcile them
   * against local state and the unsynced queue (Story 4-18, AC-1/AC-2/AC-3).
   *
   * Reconciliation model — STATE-BASED last-write-wins (intentionally distinct
   * from the op-based `detectConflict` push path; see the Dev Note in the story):
   * pulled changes are reconstructed from entity ROWS and carry no originating
   * deviceId/operation id, so op-based conflict detection cannot run faithfully.
   * Instead, for each server change we compare its `updatedAt` against any queued
   * local op targeting the same `(entityType, entityId)`:
   *   - local op newer OR equal (tie) → the local edit WINS; the server change is
   *     suppressed (reported as a conflict) and the queued op is LEFT IN PLACE so
   *     unsynced work is never silently lost (AC-2). Server loses ties to a
   *     still-queued local edit, by deliberate rule.
   *   - server strictly newer → the server change WINS; it is applied locally and
   *     the now-stale queued op is removed from the queue (it lost LWW and must
   *     not later re-push older data over the newer server value). A conflict
   *     callback is emitted so this is observable, not silent.
   * Server changes with no queued local op apply directly.
   *
   * ⚠️⚠️ A change that would be APPLIED (either of the last two cases) and is not
   * a tombstone is validated FIRST (story 75.4, FR123). A row that fails its
   * entity schema is REFUSED: it is not applied, it displaces no queued op, no
   * conflict is reported, and it is returned in `refused` instead. Before this,
   * the only validation ran in the web layer AFTER the queued op had been
   * removed, so a malformed row cost the user their edit and nothing ever pushed
   * it. A change that LOSES to a local edit is not validated: nothing is written,
   * so there is nothing to protect, and its conflict/cursor-hold semantics stay
   * exactly as they were.
   *
   * ⚠️ Two more drops happen in the same pass (story 76.2), neither a conflict:
   * ops stamped with a profile whose tombstone this pull APPLIED
   * (`discardedForDeletedProfile`), and ops that `dependsOn` an op LWW dropped
   * (`droppedDependents`). See the block before the queue write.
   *
   * The transport (`config.fetchServerChanges`) is REQUIRED — like
   * `processOperation`, a missing transport throws rather than no-oping, so a
   * misconfiguration can't masquerade as "no remote changes".
   */
  async pull(): Promise<PullResult> {
    // A destroyed service fetches nothing (story 79.1).
    if (this.destroyed) {
      return this.destroyedPullResult(this.state.lastPullTimestamp)
    }

    if (!this.config.fetchServerChanges) {
      // Fail loud (mirrors processOperation): never present "no transport" as
      // "no changes", which would hide a real wiring bug.
      throw new Error(
        'No fetchServerChanges configured: refusing to pull. Provide config.fetchServerChanges.'
      )
    }

    const since = this.state.lastPullTimestamp

    let changes: ServerChange[]
    try {
      changes = await this.config.fetchServerChanges(since)
    } catch (error) {
      // Torn down while the fetch was in flight (story 79.1): no state write.
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

    // ⚠️ Torn down while the fetch was in flight (story 79.1). The LWW drop
    // below would discard queued ops, and write the queue, for a session that
    // has ended. The next session's first pull starts from a `null` cursor and
    // makes the same decisions again.
    if (this.destroyed) {
      return this.destroyedPullResult(since)
    }

    const applied: ServerChange[] = []
    const conflicts: ServerChange[] = []
    const refused: RefusedServerChange[] = []
    const droppedLocalOps: SyncOperation[] = []
    // Dropped ops whose entity the server holds as a LIVE row (story 76.2): the
    // op's intent did not happen. A delete dropped against a TOMBSTONE did happen
    // (another device got there first, or this device's own push landed and its
    // response was lost), so what depends on it must stay.
    const lostToLiveRow = new Set<string>()

    // Index the current queue by entity key. The NEWEST op per entity is what
    // would win a push, so the LWW decision compares against it — but when the
    // server wins we must drop EVERY queued op for that entity (review P4), or an
    // older create/update left behind would re-push stale data over the value the
    // pull just applied. So track both the newest op and the full list per key.
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

      // Decide the winner by CAUSAL version when the local op carries a
      // baseVersion (review D1): the local edit has "already incorporated" the
      // server change iff that change is no newer than the server version the op
      // was based on (`change.updatedAt <= baseVersion`). A change newer than the
      // base is a genuine concurrent server edit → server wins. When baseVersion
      // is absent, fall back to the wall-clock `timestamp` comparison (unchanged
      // behavior), so this is a strict, regression-free refinement.
      const localWins =
        localOp !== undefined &&
        (localOp.baseVersion !== undefined
          ? change.updatedAt <= localOp.baseVersion
          : localOp.timestamp >= change.updatedAt)

      if (localOp && localWins) {
        // Local edit wins → suppress the server change and keep the queued op so
        // the unsynced edit still pushes (AC-2).
        conflicts.push(change)
        this.notifyConflictCallbacks({
          hasConflict: true,
          conflictType: 'update-update',
          localOperation: localOp,
          // resolution = the local op: the still-queued local edit is the winner.
          resolution: localOp,
        })
        continue
      }

      // ⚠️⚠️ Validate BEFORE the drop below (story 75.4). This change is about to
      // be applied and, if an op is queued for it, to displace that op. A refused
      // row must do neither: the op stays queued and pushes later (the server push
      // path has no timestamp LWW, so it lands). ⚠️ That heals the server row ONLY
      // in the fields the op carries: an update sends the fields the user changed,
      // so a bad `amount` survives an edit to `name` alone, and every later pull
      // refuses the row again (deferred-work, 75.4). A tombstone is never validated; it carries no meaningful payload, and
      // refusing one would stop deletes propagating (story 66.2, rule 1).
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
        // Server change is strictly newer than the newest queued local op →
        // server wins LWW. Drop ALL queued ops for this entity (review P4) so
        // neither the newest nor any older op can later resurrect stale data, and
        // record them so the UI conflict count reflects the discarded local
        // writes (review D4). No `resolution` is set here: the winner is the
        // server change, which is not a SyncOperation.
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

    // ⚠️ A REFUSED change advances the cursor like an applied one (story 66.2's
    // ADVANCE decision, re-read in 75.4): a malformed row stays malformed, so
    // holding the cursor below it would re-fetch it for ever and stall every
    // later change behind it. It is deliberately NOT in `earliestSuppressed`.
    //
    // Advance the pull cursor — but NOT past a change suppressed by a still-queued
    // local op (review D2). The cursor sits just below the earliest unresolved
    // (suppressed) change, so the next pull re-fetches it (and idempotently
    // re-applies anything after it) until the conflicting local op finally pushes.
    // Without this, a suppressed server change whose local op never lands would be
    // skipped forever by the server's `updatedAt > cursor` filter.
    const earliestSuppressed = conflicts.length
      ? Math.min(...conflicts.map((c) => c.updatedAt))
      : null
    let newCursor = since
    for (const change of changes) {
      if (earliestSuppressed !== null && change.updatedAt >= earliestSuppressed) {
        continue
      }
      if (newCursor === null || change.updatedAt > newCursor) {
        newCursor = change.updatedAt
      }
    }

    // ⚠️⚠️ Two more kinds of op leave the queue in this same pass (story 76.2).
    // Neither lost a comparison, so neither is a conflict.
    //
    // 1. Ops stamped with a profile whose tombstone this pull APPLIED. Another
    //    device deleted it; the server cascade tombstoned its rows, and the web
    //    layer's pull cascade (story 66.3) is about to destroy them locally. This
    //    is Lucas's 66.3 decision (2026-09-24, destroy, not reassign) applied to
    //    the rows' PENDING EDITS. It is not a new data-loss rule: none of these
    //    ops could change anything on the server any more — creates and updates
    //    fail for ever, deletes would be acknowledged no-ops (see
    //    `isStrandedByDeletedProfile`).
    //    Only an APPLIED tombstone counts: it is positive proof. A suppressed one
    //    means a local edit still wins and the profile is live here.
    //
    // 2. Ops that `dependsOn` an op LWW just dropped for a LIVE server row
    //    (decision D1 = A): a promotion whose deletion lost. Not when the row came
    //    back as a tombstone: the deletion happened, and the promotion still
    //    fills the seat. One level only: `dependsOn` is set on the promotion
    //    alone, and nothing depends on a promotion.
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
    // The two lists cannot overlap: a dependent is a `userProfile` promotion, and
    // `isStrandedByDeletedProfile` never matches a `userProfile` op.
    const toDiscard = [...droppedLocalOps, ...discardedForDeletedProfile, ...droppedDependents]
    if (discardedForDeletedProfile.length > 0 || droppedDependents.length > 0) {
      // Counts and ids only: an op's data can carry financial values.
      console.info('[sync] pull let go of queued ops', {
        deletedProfileIds: [...deletedProfileIds],
        forDeletedProfile: discardedForDeletedProfile.length,
        dependents: droppedDependents.length,
      })
    }

    // Remove queued ops that definitively lost LWW, and surface them as conflicts
    // (mirrors the push path's conflictOperations) so the UI count reflects the
    // local writes the server overwrote (review D4).
    if (toDiscard.length > 0) {
      // ⚠️ `discardBatch`, not `removeBatch` (code review 75.4, Lucas's decision).
      // `removeBatch` THROWS when storage refuses the write, and the ops then
      // stayed queued. The old comment called that "a redundant retry", and it
      // was not: the pull has just APPLIED the newer server value, so the next
      // push would send the stale local edit over it. `discardBatch` drops them
      // from memory even when storage refuses. Its limit (they return on a reload
      // while storage keeps refusing) is safe here: a reload pulls from `null`,
      // the same newer server row wins LWW again, and they are dropped again
      // before anything can push them.
      try {
        const { persisted } = await this.queue.discardBatch(toDiscard.map((op) => op.id))
        if (!persisted) {
          this.log('Stale local ops dropped from memory only; storage refused the write')
        }
        this.state.pendingOperations = this.queue.getAll()
        this.state.failedOperations = this.retryableStillQueued(this.state.failedOperations)
        this.refreshEscalated()
      } catch (error) {
        // `discardBatch` does not throw for a storage failure; this is a bug path.
        this.log('Failed to remove stale local ops after pull:', error)
      }
      if (droppedLocalOps.length > 0) {
        this.state.conflictOperations = [...this.state.conflictOperations, ...droppedLocalOps]
      }
    }

    // Torn down during the discard await (story 79.1): no cursor, no callbacks.
    if (this.destroyed) {
      return this.destroyedPullResult(since)
    }

    // Persist the advanced pull cursor (separate from the push cursor) and surface
    // the applied changes to the host app for store writes.
    this.state.lastPullTimestamp = newCursor
    this.state.lastError = undefined

    if (applied.length > 0) {
      this.notifyChangesPulledCallbacks(applied)
    }
    if (refused.length > 0) {
      this.notifyServerChangesRefusedCallbacks(refused)
    }
    // Every pull re-derives the escalated view (story 79.2 code review): an op
    // held back only by the time floor becomes visible at the next poll, without
    // waiting for another push.
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

  /**
   * Drop every queued op stamped with `profileId`, a profile that will never
   * exist on the server (story 76.2). Same strict predicate as `pull()`; see
   * `isStrandedByDeletedProfile`. Returns the ops it dropped.
   *
   * The pull applies it by itself. This entry point is for the host's other
   * source of positive proof: the server permanently refused the profile's
   * CREATE (story 75.2, `refusedEdits.ts`), so its children's queued ops would
   * otherwise fail `Profile not found` for ever.
   *
   * `discardBatch`, like the pull: storage refusing the write still drops the ops
   * from this session.
   */
  async discardOperationsForDeletedProfile(profileId: string): Promise<SyncOperation[]> {
    // A destroyed service drops nothing (story 79.1): its queue is closed.
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
      // Torn down before the discard ran (story 79.1): the closed queue refused
      // it, so nothing was dropped. That is the intended outcome, not a failure.
      if (error instanceof SyncQueueClosedError) {
        return []
      }
      throw error
    }
    if (!persisted) {
      this.log('Ops of a deleted profile dropped from memory only; storage refused the write')
    }
    // The discard had already started when `destroy()` landed: it completed, but
    // no state write or notification follows for an ended session.
    if (this.destroyed) {
      return stranded
    }
    this.state.pendingOperations = this.queue.getAll()
    this.state.failedOperations = this.retryableStillQueued(this.state.failedOperations)
    this.refreshEscalated()
    this.notifyStatusCallbacks()
    return stranded
  }

  /**
   * Manual pull trigger (Story 4-18, AC-5). Identical to {@link pull}; named for
   * symmetry with `forceSync` so the host hook can expose an explicit user action.
   */
  async forcePull(): Promise<PullResult> {
    return this.pull()
  }

  /**
   * Reset the server→client pull cursor (Story 4-18 review P7). Forces the next
   * pull to request a full snapshot. The web layer calls this on profile switch:
   * the pull cursor is global but the delta is profile-scoped, so without a reset
   * the newly-active profile's rows older than the cursor would never be pulled.
   */
  resetPullCursor(): void {
    this.state.lastPullTimestamp = null
    this.notifyStatusCallbacks()
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
    // The escalation threshold and time floor derive from these two (story 79.2
    // code review), so re-derive the view rather than keep the old rule.
    if (
      !this.destroyed &&
      ('maxRetries' in updates || 'retryDelay' in updates) &&
      this.refreshEscalated()
    ) {
      this.notifyStatusCallbacks()
    }
  }

  /**
   * Whether `destroy()` has run (story 79.1).
   */
  isDestroyed(): boolean {
    return this.destroyed
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
  ServerChange,
  PullResult,
  ChangesPulledCallback,
  OperationsRejectedCallback,
}

export {
  SyncQueue,
  SyncQueueClosedError,
  createSyncQueue,
  LocalStorageSyncQueueStorage,
  DEFAULT_CONFIG,
}
