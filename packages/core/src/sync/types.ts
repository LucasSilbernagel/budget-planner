/**
 * Synchronization Service Types
 *
 * This file defines the core types used by the synchronization service for
 * multi-device data synchronization in the paid tier.
 */

import { z } from 'zod'
import { FINANCE_TYPES } from '../services/balanceTracking'

// ============================================================================
// Entity Validation Schemas
// ============================================================================

/**
 * PostgreSQL 32-bit `integer` bounds. Monetary fields are stored as `integer`
 * (cents), so client-side validation must reject values the DB cannot store to
 * avoid "integer out of range" failures that would otherwise only surface at
 * persistence time and be retried forever.
 */
const PG_INT32_MAX = 2_147_483_647
const PG_INT32_MIN = -2_147_483_648

/**
 * Zod schemas for validating entity data payloads
 * These ensure data structure matches expected format for each entity type
 */
export const incomeSourceSchema = z.object({
  name: z.string().min(1).max(255),
  amount: z.number().int(),
  frequency: z.enum(['weekly', 'biweekly', 'monthly', 'annually']),
  userId: z.string().uuid(),
})

export const expenseSchema = z.object({
  name: z.string().min(1).max(255),
  amount: z.number().int(),
  frequency: z.enum(['weekly', 'biweekly', 'monthly', 'annually']),
  userId: z.string().uuid(),
})

/**
 * Story 30.4a: user-defined category (FR54).
 *
 * ⚠️ Like its siblings above, this schema is currently UNEXERCISED — nothing
 * imports it. The gate that actually runs at queue time is
 * `syncOperationDataSchema` below (see `validateOperationData` in
 * synchronization.ts). It is declared anyway for parity, because the drift
 * between these mirrors and the flat schema is exactly how the documented
 * asymmetries in savingsGoalSchema arose. If you change one, change both.
 */
export const categorySchema = z.object({
  name: z.string().min(1).max(255),
  kind: z.enum(['income', 'expense']),
  userId: z.string().uuid(),
})

export const savingsGoalSchema = z.object({
  name: z.string().min(1).max(255),
  targetAmount: z.number().int(),
  currentBalance: z.number().int().default(0),
  // Story 26.1: per-account allocation. `monthlyAllocation` is nullable cents
  // (0..int32). `allocationMode` is `.optional()` here (the client emits it via
  // syncBridge); the server gate uses `.default('automatic')` on ingest — an
  // intentional asymmetry, not an exact mirror. Bound matches syncOperationDataSchema.
  monthlyAllocation: z.number().int().min(0).max(PG_INT32_MAX).nullable().optional(),
  allocationMode: z.enum(['manual', 'automatic']).optional(),
  userId: z.string().uuid(),
})

export const balanceTrackingSchema = z.object({
  type: z.enum(FINANCE_TYPES),
  name: z.string().min(1).max(255),
  currentBalance: z.number().int().default(0),
  maxContributionLimit: z.number().int().optional(),
  monthlyContribution: z.number().int().default(0),
  // Story 16-2: cadence of the contribution (defaults to 'monthly'). Mirrors the
  // server gate in apps/web/src/server/api/sync.ts.
  frequency: z.enum(['weekly', 'biweekly', 'monthly', 'annually']).default('monthly'),
  userId: z.string().uuid(),
})

export const userProfileSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(500).optional(),
  isDefault: z.boolean().default(false),
  currency: z.enum(['NONE', 'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'SEK', 'NZD']),
  userId: z.string().uuid(),
})

/**
 * Schema for sync operation data validation
 * Validates data structure based on entityType
 *
 * Numeric bounds mirror the database CHECK constraints (see packages/db/schema.ts)
 * so invalid amounts are rejected client-side instead of failing the INSERT/UPDATE:
 * - amount / maxContributionLimit: must be > 0
 * - targetAmount: > 0 for a goal, or null for a goal-less savings account (Story 16-1)
 * - monthlyContribution: must be >= 0
 * - currentBalance: may be negative (debt balances) but must fit in int32
 */
export const syncOperationDataSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  amount: z.number().int().positive().max(PG_INT32_MAX).optional(),
  frequency: z.enum(['weekly', 'biweekly', 'monthly', 'annually']).optional(),
  // null ⇒ savings account (no target); a positive int ⇒ goal. Must allow null
  // or a paid-tier account create/update ZodError-fails at the sync-queue gate.
  targetAmount: z.number().int().positive().max(PG_INT32_MAX).nullable().optional(),
  currentBalance: z.number().int().min(PG_INT32_MIN).max(PG_INT32_MAX).optional(),
  type: z.enum(FINANCE_TYPES).optional(),
  maxContributionLimit: z.number().int().positive().max(PG_INT32_MAX).optional(),
  monthlyContribution: z.number().int().min(0).max(PG_INT32_MAX).optional(),
  // Story 26.1: savings monthly allocation (nullable cents, >= 0) + mode. Bounds
  // mirror the DB (allocationMode NOT NULL default 'automatic'; monthlyAllocation
  // nullable). Absent from a payload is fine — both are optional here.
  monthlyAllocation: z.number().int().min(0).max(PG_INT32_MAX).nullable().optional(),
  allocationMode: z.enum(['manual', 'automatic']).optional(),
  description: z.string().max(500).optional(),
  isDefault: z.boolean().optional(),
  // Story 30.4a (FR54): the category entity's own `kind`, and the nullable
  // `categoryId` reference carried by incomeSource/expense rows.
  //
  // ⚠️ `categoryId` MUST be `.nullable()`, not merely `.optional()`. Clearing a
  // category sends an explicit `null` (an omitted key would leave the previous
  // server value in place — updateEntity does a PARTIAL `.set()`), so a
  // nullable-less schema would reject every un-categorize operation at the queue
  // gate with a ZodError. This is the same trap savingsGoal.targetAmount hit in
  // Story 16-1; see its note above.
  kind: z.enum(['income', 'expense']).optional(),
  categoryId: z.string().uuid().nullable().optional(),
  // Story 34.1a (FR60): explicit display position for the four financial lists.
  //
  // ⚠️ This gate STRIPS undeclared keys (see the note below), so omitting this line
  // would drop `sortOrder` from the payload before the operation is ever queued —
  // with no error, no rejection, and a "successful" sync that silently discards the
  // user's ordering. Bounded to the int32 column range for the same
  // defense-in-depth reason as monthlyAllocation.
  //
  // `.optional()` because entity types that have no ordering (userProfile,
  // category) share this one schema; `.min(0)` because positions are dense and
  // zero-based, and the backfill plus `max + 1` can never produce a negative.
  sortOrder: z.number().int().min(0).max(PG_INT32_MAX).optional(),
  currency: z
    .enum(['NONE', 'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'SEK', 'NZD'])
    .optional(),
  userId: z.string().uuid().optional(),
})

/**
 * Supported entity types that can be synchronized
 */
export type SyncEntityType =
  | 'incomeSource'
  | 'expense'
  | 'savingsGoal'
  | 'balanceTracking'
  | 'userProfile'
  // Story 30.4a: user-defined income/expense categories (FR54).
  //
  // ⚠️ Extending this union type-enforces exactly ONE downstream gate —
  // `ENTITY_BINDINGS` in apps/web/src/lib/sync/applyServerChanges.ts, which is
  // declared `Record<SyncEntityType, EntityBinding>`. Every other gate must be
  // updated by hand and fails SILENTLY if missed:
  //   - toServerPayload's switch (syncBridge.ts) — now has a `never`-exhaustive
  //     default so it, too, is a compile error rather than a silent misroute
  //   - syncOperationDataSchema below — zod STRIPS undeclared keys
  //   - syncOperationSchema.entityType (server/api/sync.ts) — a hard-coded enum;
  //     an unknown value fails the whole batch, not just its own operation
  //   - getSyncChanges (server/api/sync.ts) — five hard-coded per-entity blocks
  // A green `tsc` is NOT evidence the contract is complete.
  | 'category'

/**
 * Supported operation types for synchronization
 */
export type SyncOperationType = 'create' | 'update' | 'delete'

/**
 * Represents a single synchronization operation
 * Contains all metadata needed to sync data between devices
 */
export interface SyncOperation {
  /** Unique identifier for the operation */
  id: string

  /** Type of operation: create, update, or delete */
  type: SyncOperationType

  /** Type of entity being synchronized */
  entityType: SyncEntityType

  /** ID of the entity being synchronized */
  entityId: string

  /** The actual data payload for the operation */
  data: Record<string, unknown>

  /** Timestamp when the operation was created (Unix timestamp in milliseconds) */
  timestamp: number

  /** Unique identifier for the device where the operation originated */
  deviceId: string

  /** User ID who owns the data */
  userId: string

  /** Profile ID for data isolation (UUID) - required for profile-scoped entities */
  profileId?: string

  /** Optional version number for optimistic concurrency control */
  version?: number

  /**
   * The server-authoritative `updatedAt` (Unix ms epoch) of the entity row this
   * operation was derived from, if known (Story 4-18 review D1). Lets pull
   * reconciliation decide the winner by CAUSAL version instead of wall-clock
   * `timestamp`, which is unreliable across devices with skewed clocks: a pulled
   * server change is "already incorporated" by this op iff `change.updatedAt <=
   * baseVersion`. When absent (e.g. a brand-new create, or an edit on an entity
   * never pulled), reconciliation falls back to the `timestamp` comparison, so
   * this is a strict, regression-free improvement. Populated by the host layer
   * when it queues an edit against a known server row.
   */
  baseVersion?: number
}

/**
 * A single server-side change surfaced by the pull endpoint (Story 4-18).
 *
 * Reconstructed from an entity ROW (not an operation), so it deliberately carries
 * no originating deviceId or operation id — the server stores entities, not the
 * op log. Pull reconciliation therefore uses state-based last-write-wins keyed on
 * `updatedAt` rather than the op-based `detectConflict` path. A tombstone
 * (`isDeleted: true`) represents a delete the client must apply by removing the
 * entity locally.
 */
export interface ServerChange {
  /** Type of entity that changed */
  entityType: SyncEntityType

  /** Server-authoritative id of the entity (serial int as string, or uuid) */
  entityId: string

  /** The entity's current column values (cents for monetary fields) */
  data: Record<string, unknown>

  /** When the row was last mutated on the server (Unix ms epoch) */
  updatedAt: number

  /** Whether this change is a soft-delete tombstone */
  isDeleted: boolean
}

/**
 * Transport hook for fetching server-side changes since a cursor (Story 4-18).
 * Injected via {@link SyncConfig} to keep the core transport-agnostic — the web
 * layer supplies an HTTP implementation; the core never imports `fetch`/`db`.
 *
 * @param since - Pull cursor (Unix ms epoch); `null` requests a full snapshot.
 */
export type FetchServerChangesFn = (since: number | null) => Promise<ServerChange[]>

/**
 * Callback invoked with the server changes that were applied during a pull, so
 * the host app (web layer) can write them into its UI stores. The core never
 * imports the stores; it only emits the applied changes.
 */
export type ChangesPulledCallback = (changes: ServerChange[]) => void

/**
 * Result of a pull (server → client) operation (Story 4-18).
 */
export interface PullResult {
  /** Whether the pull completed without a transport/processing error */
  success: boolean

  /** Number of server changes applied to local state */
  changesPulledCount: number

  /** The server changes that were applied locally */
  applied: ServerChange[]

  /**
   * Server changes that were NOT applied because a newer queued local edit won
   * the last-write-wins comparison (unsynced local work is never discarded).
   */
  conflicts: ServerChange[]

  /** Error message if the pull failed */
  error?: string

  /** The advanced pull cursor after this pull (Unix ms epoch, or null) */
  lastPullTimestamp: number | null
}

/**
 * Status of the synchronization process
 */
export enum SyncStatus {
  PENDING = 'PENDING', // Sync has not started or is queued
  IN_PROGRESS = 'IN_PROGRESS', // Sync is currently in progress
  COMPLETED = 'COMPLETED', // Sync completed successfully with no conflicts or failures
  FAILED = 'FAILED', // Sync failed with errors
  CONFLICT = 'CONFLICT', // Sync detected conflicts that need resolution
  PARTIAL = 'PARTIAL', // Sync completed with some conflicts but no failures
  OFFLINE = 'OFFLINE', // Device is offline, operations are queued
}

/**
 * Interface for tracking the overall synchronization state
 */
export interface SyncState {
  /** Current status of synchronization */
  status: SyncStatus

  /** Timestamp of the last successful sync (null if never synced) */
  lastSyncTimestamp: number | null

  /**
   * Cursor for server → client pulls (Unix ms epoch; null if never pulled).
   * Tracked SEPARATELY from `lastSyncTimestamp` (the push cursor): a push must
   * not advance the pull cursor, or remote changes between the last pull and the
   * push would be skipped forever (Story 4-18).
   */
  lastPullTimestamp: number | null

  /** Operations that are pending synchronization */
  pendingOperations: SyncOperation[]

  /** Operations that failed during synchronization */
  failedOperations: SyncOperation[]

  /** Operations that have conflicts requiring resolution */
  conflictOperations: SyncOperation[]

  /** Whether the device is currently online */
  isOnline: boolean

  /** Error message from the last failed sync, if any */
  lastError?: string

  /** Number of retries attempted for failed operations */
  retryCount: number
}

/**
 * Interface for conflict detection result
 */
export interface ConflictResult {
  /** Whether a conflict was detected */
  hasConflict: boolean

  /** Type of conflict if detected */
  conflictType?: ConflictType

  /** The operation from the local device */
  localOperation?: SyncOperation

  /** The operation from the server */
  serverOperation?: SyncOperation

  /** Suggested resolution */
  resolution?: SyncOperation
}

/**
 * Types of conflicts that can occur during synchronization
 */
export type ConflictType =
  | 'create-create' // Both local and server created same entity
  | 'create-update' // Local create conflicts with server update
  | 'create-delete' // Local create conflicts with server delete
  | 'update-create' // Local update conflicts with server create
  | 'update-update' // Both local and server updated same entity
  | 'update-delete' // Local update conflicts with server delete
  | 'delete-create' // Local delete conflicts with server create
  | 'delete-update' // Local delete conflicts with server update
  | 'delete-delete' // Both local and server deleted same entity
  | 'version-mismatch' // Version numbers don't match

/**
 * Strategy for resolving conflicts
 */
export type ConflictResolutionStrategy =
  | 'last-write-wins' // Most recent timestamp wins
  | 'server-wins' // Server always wins
  | 'client-wins' // Client always wins
  | 'manual' // Require manual resolution
  | 'merge' // Attempt to merge changes

/**
 * Result of processing a single operation
 */
export interface ProcessOperationResult {
  /** Whether the operation was successful */
  success: boolean
  /** Whether a conflict was detected */
  conflict?: boolean
  /** Error message if operation failed */
  error?: string
  /**
   * Whether a failed operation should be retried. Transient failures
   * (network/5xx) are retryable; auth/validation failures (4xx) are not and
   * must abort rather than be hammered. When omitted, the failure is treated
   * as retryable for backwards compatibility.
   */
  retryable?: boolean
  /** Optional HTTP-style status code from the transport, used to classify failures. */
  statusCode?: number
}

/**
 * Function type for processing a single operation
 * This allows the sync service to be customized with different transport mechanisms
 * (e.g., direct database access, HTTP API calls, etc.)
 */
export type ProcessOperationFn = (operation: SyncOperation) => Promise<ProcessOperationResult>

/**
 * Configuration options for the synchronization service
 */
export interface SyncConfig {
  /** Strategy to use for conflict resolution */
  conflictResolutionStrategy: ConflictResolutionStrategy

  /** Maximum number of retry attempts for failed operations */
  maxRetries: number

  /** Delay between retry attempts in milliseconds */
  retryDelay: number

  /** Maximum batch size for sync operations */
  batchSize: number

  /** Whether to enable automatic sync */
  autoSync: boolean

  /** Interval for automatic sync in milliseconds (0 = disabled) */
  autoSyncInterval: number

  /** Whether to enable debug logging */
  debug: boolean

  /** Custom function to process operations (e.g., make API calls)
   * If not provided, operations will be queued but not processed
   */
  processOperation?: ProcessOperationFn

  /**
   * Transport hook for pulling server-side changes (Story 4-18). Injected the
   * same way as {@link processOperation} to keep the core transport-agnostic.
   * If not provided, `pull()` fails loud (it does not silently no-op) so a
   * misconfiguration can't masquerade as "no remote changes".
   */
  fetchServerChanges?: FetchServerChangesFn

  /** Interval for automatic server pulls in milliseconds (0/undefined = disabled) */
  pullInterval?: number

  /**
   * Active profile ID (UUID) for the session. Profile-scoped entities
   * (incomeSource, expense, savingsGoal, balanceTracking) require a
   * `profileId NOT NULL` server-side, so every queued operation is stamped
   * with this value. Required for those entity types when syncing the paid tier.
   */
  profileId?: string
}

/**
 * Result of a synchronization operation
 */
export interface SyncResult {
  /** Whether the sync was successful */
  success: boolean

  /** Number of operations synchronized */
  synchronizedCount: number

  /** Number of operations that failed */
  failedCount: number

  /** Number of conflicts detected */
  conflictCount: number

  /** New sync state after the operation */
  state: SyncState

  /** Error message if sync failed */
  error?: string

  /** Duration of the sync operation in milliseconds */
  duration: number
}

/**
 * Callback function type for sync status changes
 */
export type SyncStatusCallback = (state: SyncState) => void

/**
 * Callback function type for conflict detection
 */
export type ConflictCallback = (conflict: ConflictResult) => void

/**
 * Interface for storage of persisted sync queue
 * This allows the sync queue to survive page refreshes and browser restarts
 */
export interface SyncQueueStorage {
  /** Load the sync queue from storage */
  loadQueue: (userId: string) => Promise<SyncOperation[]>

  /** Save the sync queue to storage */
  saveQueue: (userId: string, queue: SyncOperation[]) => Promise<void>

  /** Clear the sync queue from storage */
  clearQueue: (userId: string) => Promise<void>
}
