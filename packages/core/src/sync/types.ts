/**
 * Synchronization Service Types
 *
 * This file defines the core types used by the synchronization service for
 * multi-device data synchronization in the paid tier.
 */

import { z } from 'zod'

// ============================================================================
// Entity Validation Schemas
// ============================================================================

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

export const savingsGoalSchema = z.object({
  name: z.string().min(1).max(255),
  targetAmount: z.number().int(),
  currentBalance: z.number().int().default(0),
  userId: z.string().uuid(),
})

export const balanceTrackingSchema = z.object({
  type: z.enum(['investment', 'debt']),
  name: z.string().min(1).max(255),
  currentBalance: z.number().int().default(0),
  maxContributionLimit: z.number().int().optional(),
  monthlyContribution: z.number().int().default(0),
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
 * PostgreSQL 32-bit `integer` bounds. Monetary fields are stored as `integer`
 * (cents), so client-side validation must reject values the DB cannot store to
 * avoid "integer out of range" failures that would otherwise only surface at
 * persistence time and be retried forever.
 */
const PG_INT32_MAX = 2_147_483_647
const PG_INT32_MIN = -2_147_483_648

/**
 * Schema for sync operation data validation
 * Validates data structure based on entityType
 *
 * Numeric bounds mirror the database CHECK constraints (see packages/db/schema.ts)
 * so invalid amounts are rejected client-side instead of failing the INSERT/UPDATE:
 * - amount / targetAmount / maxContributionLimit: must be > 0
 * - monthlyContribution: must be >= 0
 * - currentBalance: may be negative (debt balances) but must fit in int32
 */
export const syncOperationDataSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  amount: z.number().int().positive().max(PG_INT32_MAX).optional(),
  frequency: z.enum(['weekly', 'biweekly', 'monthly', 'annually']).optional(),
  targetAmount: z.number().int().positive().max(PG_INT32_MAX).optional(),
  currentBalance: z.number().int().min(PG_INT32_MIN).max(PG_INT32_MAX).optional(),
  type: z.enum(['investment', 'debt']).optional(),
  maxContributionLimit: z.number().int().positive().max(PG_INT32_MAX).optional(),
  monthlyContribution: z.number().int().min(0).max(PG_INT32_MAX).optional(),
  description: z.string().max(500).optional(),
  isDefault: z.boolean().optional(),
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
