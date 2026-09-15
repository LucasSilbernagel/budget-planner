/**
 * Sync API Endpoints
 *
 * Server API endpoints for handling synchronization operations.
 * Implements batch processing, conflict detection, and sync history tracking.
 *
 * Features:
 * - Batch sync operations
 * - Conflict detection and resolution
 * - Sync history tracking to DanubeData PostgreSQL
 * - Authentication validation
 * - Rate limiting
 * - Audit logging to DanubeData PostgreSQL
 *
 * Data Sovereignty: ALL data stored in DanubeData PostgreSQL (Germany - EU) for CLOUD Act immunity (NFR1, NFR2)
 */

import { logger } from '@/lib/logger'
import { checkDbRateLimit } from '@/server/rate-limit/db-window'
import { FINANCE_TYPES } from '@budget-planner/core/services/balanceTracking'
import type { ServerChange, SyncOperation, SyncStatus } from '@budget-planner/core/sync'
import { SyncStatus as SyncStatusEnum } from '@budget-planner/core/sync'
import type { User } from '@budget-planner/db'
import { db } from '@budget-planner/db'
import {
  balanceTracking,
  categories,
  expenses,
  incomeSources,
  savingsGoals,
  userProfiles,
} from '@budget-planner/db'
import { and, asc, eq, gt } from 'drizzle-orm'
import { z } from 'zod'

// ============================================================================
// Types
// ============================================================================

/**
 * Request body for batch sync operations
 */
export interface BatchSyncRequest {
  /** Array of operations to sync */
  operations: SyncOperation[]
  /** Client timestamp for request ordering */
  clientTimestamp: number
  /** Device ID making the request */
  deviceId: string
}

/**
 * Response for batch sync operations
 */
export interface BatchSyncResponse {
  /** Whether the sync was successful */
  success: boolean
  /** Number of operations processed */
  processedCount: number
  /** Number of operations that failed */
  failedCount: number
  /** Number of conflicts detected */
  conflictCount: number
  /** Array of conflict results */
  conflicts: SyncConflict[]
  /** Array of failed operation IDs */
  failedOperationIds: string[]
  /** Server timestamp */
  serverTimestamp: number
  /** Sync status */
  status: SyncStatus
  /** Error message if sync failed */
  error?: string
}

/**
 * Conflict information returned to client
 */
export interface SyncConflict {
  /** Local operation ID */
  localOperationId: string
  /** Server operation ID */
  serverOperationId: string
  /** Entity type */
  entityType: string
  /** Entity ID (uuid string since Story 5-14 — no serial-int ids remain) */
  entityId: string
  /** Type of conflict */
  conflictType: string
  /** Suggested resolution */
  resolution?: SyncOperation
}

/**
 * Sync history entry - stored in database
 */
export interface SyncHistoryEntry {
  /** Unique ID for the sync session */
  id: string
  /** User ID */
  userId: string
  /** Device ID */
  deviceId: string
  /** Start timestamp */
  startTimestamp: number
  /** End timestamp */
  endTimestamp: number
  /** Number of operations synced */
  operationsCount: number
  /** Number of conflicts */
  conflictCount: number
  /** Number of failures */
  failureCount: number
  /** Final status */
  status: SyncStatus
  /** Error message if any */
  error?: string
}

/**
 * Audit log entry for sync operations - stored in database
 */
export interface SyncAuditLog {
  /** Unique ID */
  id: string
  /** User ID */
  userId: string
  /** Operation ID */
  operationId: string
  /** Entity type */
  entityType: string
  /** Entity ID (uuid string since Story 5-14 — no serial-int ids remain) */
  entityId: string
  /** Operation type */
  operationType: 'create' | 'update' | 'delete'
  /** Timestamp */
  timestamp: number
  /** Whether the operation succeeded */
  success: boolean
  /** Error message if failed */
  error?: string
  /** IP address */
  ipAddress?: string
  /** User agent */
  userAgent?: string
}

// ============================================================================
// Validation Schemas
// ============================================================================

/**
 * Zod schemas for entity-specific data validation
 * These ensure data structure matches expected format for each entity type
 */
const incomeSourceSchema = z.object({
  name: z.string().min(1).max(255),
  amount: z.number().int(),
  frequency: z.enum(['weekly', 'biweekly', 'monthly', 'annually']),
  // Story 30.4a: nullable FK to `categories`. Must accept an explicit null —
  // un-categorizing a row sends null, and updateEntity does a partial .set(), so
  // the client always forwards the key rather than omitting it.
  categoryId: z.string().uuid().nullable().optional(),
  // Story 34.1a (FR60): explicit display position. This is a VALIDATION gate, not
  // a stripping one — the per-entity schemas are invoked inside
  // `syncOperationSchema`'s superRefine, which discards its callback's return
  // value, so `operation.data` passes through unstripped (verified by probe; see
  // lib/sync/__tests__/sort-order-gates.test.ts). Declaring the field is what makes
  // a negative, fractional or over-int32 position get rejected HERE rather than
  // blowing up at the INSERT. Bounds mirror the client gate in
  // packages/core/src/sync/types.ts.
  sortOrder: z.number().int().min(0).max(2_147_483_647).optional(),
  userId: z.string().uuid(),
})

const expenseSchema = z.object({
  name: z.string().min(1).max(255),
  amount: z.number().int(),
  frequency: z.enum(['weekly', 'biweekly', 'monthly', 'annually']),
  // Story 30.4a: see incomeSourceSchema above.
  categoryId: z.string().uuid().nullable().optional(),
  // Story 34.1a (FR60): explicit display position; see incomeSourceSchema above.
  sortOrder: z.number().int().min(0).max(2_147_483_647).optional(),
  userId: z.string().uuid(),
})

/**
 * Story 30.4a: user-defined income/expense category (FR54).
 *
 * Untrusted-input gate for the category entity. Mirrors core's `categorySchema`
 * but is declared independently, matching this file's existing convention of
 * hand-duplicating the per-entity schemas rather than importing core's.
 */
const categorySchema = z.object({
  name: z.string().min(1).max(255),
  kind: z.enum(['income', 'expense']),
  userId: z.string().uuid(),
})

const savingsGoalSchema = z.object({
  name: z.string().min(1).max(255),
  // Optional/nullable (Story 16-1): a positive integer ⇒ goal, null ⇒ account
  // (no target) — an ABSENT value, never a sentinel 0. (Originally described as
  // mirroring balanceTracking.maxContributionLimit, dropped by story 49.1 / FR75.)
  targetAmount: z.number().int().positive().nullable().optional(),
  currentBalance: z.number().int().default(0),
  // Story 26.1: per-account allocation. `monthlyAllocation` nullable cents, bounded
  // to the int32 column range (defense-in-depth: the enforced client gate in
  // packages/core/src/sync/types.ts already caps it, but this untrusted-input gate
  // must reject an over-range value rather than let the INSERT overflow).
  // `allocationMode` defaults to 'automatic' on ingest so a payload omitting it
  // matches the DB default (the client always emits it — an intentional asymmetry
  // with the client gate's `.optional()`, not an exact mirror).
  monthlyAllocation: z.number().int().min(0).max(2_147_483_647).nullable().optional(),
  allocationMode: z.enum(['manual', 'automatic']).default('automatic'),
  // Story 34.1a (FR60): explicit display position; see incomeSourceSchema above.
  sortOrder: z.number().int().min(0).max(2_147_483_647).optional(),
  userId: z.string().uuid(),
})

const balanceTrackingSchema = z.object({
  type: z.enum(FINANCE_TYPES),
  name: z.string().min(1).max(255),
  currentBalance: z.number().int().default(0),
  monthlyContribution: z.number().int().default(0),
  // Story 16-2: cadence of the contribution. Defaults to 'monthly' so pre-frequency
  // paid-tier rows round-trip. Server gate — must mirror the client gate in
  // packages/core/src/sync/types.ts (syncOperationDataSchema already carries `frequency`).
  frequency: z.enum(['weekly', 'biweekly', 'monthly', 'annually']).default('monthly'),
  // Story 45.1 (FR72): the user's statement that this contribution is already
  // recorded as an expense, so the savings distributable pool must not subtract
  // it twice. Server gate — must mirror the client gate in
  // packages/core/src/sync/types.ts and the syncBridge payload whitelist.
  contributionRecordedAsExpense: z.boolean().default(false),
  // Story 34.1a (FR60): explicit display position; see incomeSourceSchema above.
  sortOrder: z.number().int().min(0).max(2_147_483_647).optional(),
  userId: z.string().uuid(),
})

const userProfileSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(500).optional(),
  isDefault: z.boolean().default(false),
  currency: z.enum(['NONE', 'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'SEK', 'NZD']),
  userId: z.string().uuid(),
})

/**
 * Zod schema for sync operation validation
 * Uses discriminated union to validate data based on entityType
 */
export const syncOperationSchema = z
  .object({
    id: z.string(),
    type: z.enum(['create', 'update', 'delete']),
    // ⚠️ Hard-coded, NOT derived from core's SyncEntityType — so adding an entity
    // type upstream does NOT surface here at compile time. Omitting a value is a
    // SILENT and unusually destructive defect: this schema is applied via
    // `z.array(syncOperationSchema)` in batchSyncRequestSchema, so ONE operation
    // with an unrecognised entityType fails the WHOLE batch (processedCount 0,
    // failedOperationIds empty). The client then retries the same batch forever
    // and NO entity's operations ever drain. Keep in lockstep with
    // SyncEntityType in packages/core/src/sync/types.ts.
    entityType: z.enum([
      'incomeSource',
      'expense',
      'savingsGoal',
      'balanceTracking',
      'userProfile',
      'category',
    ]),
    entityId: z.string(),
    data: z.record(z.unknown()), // Kept for backward compatibility, but validated per-entity below
    timestamp: z.number(),
    deviceId: z.string(),
    userId: z.string(),
    // ⚠️ LOAD-BEARING. `z.object` STRIPS undeclared keys and `processBatchSync`
    // consumes the PARSED output, so before these two were declared every op
    // reached `applyOperation` with `profileId === undefined`. Every create of a
    // profile-scoped entity (income, expenses, savings, balances, categories)
    // then violated `profileId NOT NULL` — nothing the user entered ever reached
    // the server, and a second device signed in to an empty account.
    // `profileId` is ownership-checked against the session user in
    // `applyOperation`; it is not trusted merely because it parses.
    profileId: z.string().uuid().optional(),
    version: z.number().optional(),
    baseVersion: z.number().optional(),
  })
  .superRefine((data, ctx) => {
    // Validate data structure based on entityType
    const { entityType, data: entityData, type } = data

    // For delete operations, data may be minimal
    if (type === 'delete') {
      // Delete operations only need userId in data
      if (!entityData['userId']) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Delete operations require userId in data',
        })
      }
      return
    }

    // For create/update, validate full structure based on entityType
    switch (entityType) {
      case 'incomeSource':
        incomeSourceSchema.parse(entityData)
        break
      case 'expense':
        expenseSchema.parse(entityData)
        break
      case 'savingsGoal':
        savingsGoalSchema.parse(entityData)
        break
      case 'balanceTracking':
        balanceTrackingSchema.parse(entityData)
        break
      case 'userProfile':
        userProfileSchema.parse(entityData)
        break
      case 'category':
        categorySchema.parse(entityData)
        break
    }
  })

/**
 * Zod schema for batch sync request
 */
export const batchSyncRequestSchema = z.object({
  operations: z.array(syncOperationSchema),
  clientTimestamp: z.number(),
  deviceId: z.string(),
})

// ============================================================================
// Database Helper Types
// ============================================================================

/**
 * Map of entity types to their database tables
 *
 * ⚠️ EXPORTED FOR TESTING (code review 30.4a). This is an enumerated gate: a
 * `SyncEntityType` with no entry here makes `getTable` throw
 * `Unknown entity type` at apply time, so every push of that entity fails while
 * the client sees nothing wrong. It had zero coverage — removing
 * `category: categories` left 240/240 green across `src/server` + `src/lib/sync`.
 * `sync-category-gates.test.ts` now pins the map against the `SyncEntityType`
 * union itself, so a new entity cannot be added to the union without landing here.
 */
export const entityTableMap = {
  incomeSource: incomeSources,
  expense: expenses,
  savingsGoal: savingsGoals,
  balanceTracking: balanceTracking,
  userProfile: userProfiles,
  category: categories,
} as const

/**
 * Type for entity table map
 */
type EntityTableMap = typeof entityTableMap

/**
 * Get the database table for an entity type
 */
function getTable<T extends keyof EntityTableMap>(entityType: T) {
  const table = entityTableMap[entityType]
  if (!table) {
    throw new Error(`Unknown entity type: ${entityType}`)
  }
  return table
}

// ============================================================================
// Rate Limiting Configuration (Database-backed for data sovereignty)
// ============================================================================

const RATE_LIMIT_CONFIG = {
  maxRequests: 100, // Max requests per window
  windowMs: 60 * 1000, // 1 minute window
}

/**
 * Subscription statuses permitted to use server-side sync (push AND pull).
 *
 * The full permitted set, and why each is here:
 *  - `active`    — the ordinary paying subscriber.
 *  - `past_due`  — a paying customer whose latest charge failed keeps access
 *                  during the dunning window. This is why the sync gate differs
 *                  from the calculations gate, which is `active`-only. The pull
 *                  route must match the PUSH gate, not the calculations gate
 *                  (Story 4-18).
 *  - `lifetime`  — a one-time lifetime purchase (Story 25-2). Permanent Premium,
 *                  deliberately distinct from `active` so a subscription
 *                  lifecycle event can never downgrade a lifetime buyer.
 *
 * ⚠️ `lifetime` was MISSING here from Story 25-2 until Story 30.4a. The status
 * was added to the schema and to `usePremiumAccess` (active OR lifetime) but
 * never to this array, so a lifetime buyer saw every premium surface unlocked
 * and received a 403 on both sync push and pull — their data silently never
 * left the device. Restored with a regression test that asserts this set
 * directly, so a future status addition cannot re-open the same hole.
 *
 * Keep in lockstep with `usePremiumAccess` (hooks/usePremiumAccess.ts) and the
 * server tier guards in server/functions/profiles.ts.
 */
export const PAID_SYNC_STATUSES = ['active', 'past_due', 'lifetime']

/**
 * Check rate limit for a user using DanubeData PostgreSQL
 * This ensures rate limiting persists across server restarts (NFR1, NFR2).
 *
 * Exported so the pull route shares the same per-user budget as push (review D3);
 * the window is generous (100/min) and a 30s poll is ~2/min, so push and pull
 * coexist comfortably in one bucket.
 */
export async function checkRateLimit(
  userId: string
): Promise<{ allowed: boolean; remaining: number }> {
  // Story SEC-2: the per-user sync limiter now shares the ONE atomic DB-backed
  // primitive (`checkDbRateLimit`, scope `sync`) with the auth limiters — a
  // single, cross-instance-safe implementation instead of the former inline
  // read-then-write (which could race and under-count across instances).
  const decision = await checkDbRateLimit({
    scope: 'sync',
    subject: userId,
    // Populate the FK so account erasure (account.ts deletes rateLimits by
    // userId) still removes this user's sync counters.
    userId,
    windowMs: RATE_LIMIT_CONFIG.windowMs,
    maxAttempts: RATE_LIMIT_CONFIG.maxRequests,
    onDbError: (now) => syncInMemoryFallback(userId, now),
  })
  return { allowed: decision.allowed, remaining: decision.remaining }
}

// Bounded per-instance in-memory store — the DB-error fallback for the sync
// limiter ONLY (auth limiters fail closed instead). It is NOT cross-instance by
// definition; it keeps the paid sync path available during a transient DB outage
// rather than fail closed, and it still enforces the same window/max (it never
// silently allows unlimited attempts).
interface RateLimitEntry {
  userId: string
  count: number
  resetTime: number
}

const rateLimitStore: RateLimitEntry[] = []

function syncInMemoryFallback(
  userId: string,
  now: number
): { allowed: boolean; remaining: number } {
  const validEntries = rateLimitStore.filter((entry) => entry.resetTime > now)
  rateLimitStore.length = 0
  rateLimitStore.push(...validEntries)

  const requestCount = validEntries.filter((entry) => entry.userId === userId).length
  if (requestCount >= RATE_LIMIT_CONFIG.maxRequests) {
    return { allowed: false, remaining: 0 }
  }

  rateLimitStore.push({
    userId,
    count: requestCount + 1,
    resetTime: now + RATE_LIMIT_CONFIG.windowMs,
  })
  return { allowed: true, remaining: RATE_LIMIT_CONFIG.maxRequests - requestCount - 1 }
}

// ============================================================================
// Database Operations (DanubeData PostgreSQL)
// ============================================================================

/**
 * Get entity from database by type and ID
 */
async function getEntity(
  entityType: keyof EntityTableMap,
  entityId: string,
  userId: string,
  profileId?: string
): Promise<Record<string, unknown> | null> {
  try {
    const table = getTable(entityType)
    let whereClause = and(
      eq(table.userId, userId),
      eq(table.id, entityId),
      // Soft-deleted rows are treated as absent (Story 4-18): excluded from
      // conflict checks AND from the app's normal reads so tombstones never
      // resurface as live entities.
      eq(table.isDeleted, false)
    )

    // Add profileId filter if provided and table has profileId column.
    // ⚠️ `'profileId' in table`, not `table.profileId`. The runtime behaviour was
    // always right — `userProfiles` genuinely has no `profileId` column and the
    // truthiness check skipped it — but READING the property to test for it is
    // itself the type error on that union member. An `in` check narrows the union,
    // which also retires the `@ts-expect-error` this used to need.
    if (profileId && 'profileId' in table) {
      whereClause = and(whereClause, eq(table.profileId, profileId))
    }

    const result = await db.select().from(table).where(whereClause).limit(1)

    return result[0] || null
  } catch (error) {
    // Sanitize error to avoid exposing sensitive database information
    const sanitizedError = error instanceof Error ? error.message : String(error)
    logger.error('[DB Error] Failed to get entity', { entityType, entityId, error: sanitizedError })
    throw new Error(`Failed to get entity: ${sanitizedError}`)
  }
}

/**
 * Check if entity exists in database
 */
async function entityExists(
  entityType: keyof EntityTableMap,
  entityId: string,
  userId: string,
  profileId?: string
): Promise<boolean> {
  try {
    const entity = await getEntity(entityType, entityId, userId, profileId)
    return !!entity
  } catch {
    return false
  }
}

/**
 * Whether `profileId` is a live (non-tombstoned) profile owned by `userId`.
 */
async function profileBelongsToUser(profileId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: userProfiles.id })
    .from(userProfiles)
    .where(
      and(
        eq(userProfiles.id, profileId),
        eq(userProfiles.userId, userId),
        eq(userProfiles.isDeleted, false)
      )
    )
    .limit(1)
  return rows.length > 0
}

/**
 * Ids of every live (non-tombstoned) profile the user owns — the authoritative
 * profile list, returned alongside each pull (`/api/sync/changes`).
 *
 * The pull's own `userProfile` changes are NOT a substitute: they are a delta
 * (empty whenever the cursor is past every profile's `updatedAt`) and a capped,
 * paginated page, so a client cannot infer "this profile does not exist on the
 * server" from its absence there. The client uses this list to find profiles it
 * created while sync was not wired, which would otherwise never be uploaded —
 * and every row stamped with them would be rejected as "Profile not found".
 */
export async function getLiveProfileIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: userProfiles.id })
    .from(userProfiles)
    .where(and(eq(userProfiles.userId, userId), eq(userProfiles.isDeleted, false)))
  return rows.map((row) => row.id)
}

/**
 * Whether a TOMBSTONED row with this id exists for this user. `entityExists`
 * treats tombstones as absent, so a create for a deleted id would otherwise
 * reach the INSERT and fail on the primary key — permanently, since the client
 * keeps non-retryable failures queued.
 */
async function tombstoneExists(
  entityType: keyof EntityTableMap,
  entityId: string,
  userId: string
): Promise<boolean> {
  const table = getTable(entityType)
  const rows = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.userId, userId), eq(table.id, entityId), eq(table.isDeleted, true)))
    .limit(1)
  return rows.length > 0
}

/**
 * Create entity in database
 */
async function createEntity(
  entityType: keyof EntityTableMap,
  data: Record<string, unknown> & { userId: string; profileId?: string }
): Promise<{ success: boolean; error?: string }> {
  try {
    const table = getTable(entityType)
    // Explicitly stamp updatedAt (Story 4-18). Although the column defaults to
    // now() on INSERT, a delta-by-updatedAt pull relies on updatedAt being a
    // real, monotonic value for every mutation; set it here so create/update/
    // soft-delete are uniform and a freshly created row is always pull-visible.
    const insertData = { ...data, updatedAt: new Date() }
    // @ts-expect-error - Dynamic table insert
    await db.insert(table).values(insertData)
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Update entity in database
 */
async function updateEntity(
  entityType: keyof EntityTableMap,
  entityId: string,
  data: Record<string, unknown>,
  userId: string,
  profileId?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const table = getTable(entityType)
    let whereClause = and(eq(table.userId, userId), eq(table.id, entityId))

    // Add profileId filter if provided and table has profileId column.
    // ⚠️ `'profileId' in table`, not `table.profileId`. The runtime behaviour was
    // always right — `userProfiles` genuinely has no `profileId` column and the
    // truthiness check skipped it — but READING the property to test for it is
    // itself the type error on that union member. An `in` check narrows the union,
    // which also retires the `@ts-expect-error` this used to need.
    if (profileId && 'profileId' in table) {
      whereClause = and(whereClause, eq(table.profileId, profileId))
    }

    // Drizzle's defaultNow() only fires on INSERT, so an UPDATE that does not
    // set updatedAt would leave the cursor stale and a delta-by-updatedAt pull
    // would MISS the update (Story 4-18). Always bump updatedAt on UPDATE.
    // The per-entity schemas VALIDATE but do not strip `operation.data`, so drop
    // the identity columns a client must never be able to rewrite: `id` and
    // `profileId` would re-home the row, and `data.userId` is not the
    // session-verified `operation.userId` — spreading it would let a payload
    // move a row into another user's account.
    const { id: _id, profileId: _profileId, userId: _userId, ...fields } = data
    const updateData = { ...fields, userId, updatedAt: new Date() }
    await db.update(table).set(updateData).where(whereClause)
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Soft-delete an entity (Story 4-18).
 *
 * A hard `DELETE` removes the row entirely, so a later delta-by-updatedAt pull
 * can never surface it and the deletion is invisible to other devices (AC-3).
 * Instead we set the tombstone flag and bump updatedAt; `getEntity`/`entityExists`
 * and the app's normal reads filter `isDeleted = false`, so the row is absent for
 * all live purposes while remaining discoverable by the pull cursor.
 */
async function deleteEntity(
  entityType: keyof EntityTableMap,
  entityId: string,
  userId: string,
  profileId?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const table = getTable(entityType)
    let whereClause = and(eq(table.userId, userId), eq(table.id, entityId))

    // Add profileId filter if provided and table has profileId column.
    // ⚠️ `'profileId' in table`, not `table.profileId`. The runtime behaviour was
    // always right — `userProfiles` genuinely has no `profileId` column and the
    // truthiness check skipped it — but READING the property to test for it is
    // itself the type error on that union member. An `in` check narrows the union,
    // which also retires the `@ts-expect-error` this used to need.
    if (profileId && 'profileId' in table) {
      whereClause = and(whereClause, eq(table.profileId, profileId))
    }

    await db.update(table).set({ isDeleted: true, updatedAt: new Date() }).where(whereClause)
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Apply an operation to the database
 */
async function applyOperation(
  operation: SyncOperation
): Promise<{ success: boolean; error?: string }> {
  const entityType = operation.entityType as keyof EntityTableMap
  const entityId = operation.entityId
  const userId = operation.userId
  const profileId = operation.profileId

  // Validate userId is not empty
  if (!userId) {
    return { success: false, error: 'User ID is required' }
  }

  try {
    // A create for an id this user already DELETED is a stale replay (e.g. a
    // device that had not yet pulled the tombstone). Acknowledge it without
    // resurrecting the row: deletion wins.
    if (operation.type === 'create' && (await tombstoneExists(entityType, entityId, userId))) {
      return { success: true }
    }

    // Profile-scoped entities must name a live profile the SESSION user owns.
    // The FK alone only proves the profile exists — for someone.
    if ('profileId' in getTable(entityType)) {
      if (!profileId) {
        return { success: false, error: 'profileId is required for this entity type' }
      }
      if (!(await profileBelongsToUser(profileId, userId))) {
        return { success: false, error: 'Profile not found' }
      }
    }

    switch (operation.type) {
      case 'create': {
        // Check if entity already exists
        const exists = await entityExists(entityType, entityId, userId, profileId)
        if (exists) {
          return { success: false, error: 'Entity already exists' }
        }
        // `id: entityId` inserts the CLIENT's uuid (Story 5-14). Without it the
        // row took a fresh `defaultRandom()` id, so the creating device's local
        // row and the server row never matched: every later update/delete of it
        // was "Entity not found", and a pull delivered it as a duplicate.
        const { id: _id, ...fields } = operation.data
        return createEntity(entityType, { ...fields, id: entityId, userId, profileId })
      }

      case 'update': {
        // Check if entity exists
        const entityExistsForUpdate = await entityExists(entityType, entityId, userId, profileId)
        if (!entityExistsForUpdate) {
          return { success: false, error: 'Entity not found' }
        }
        return updateEntity(entityType, entityId, operation.data, userId, profileId)
      }

      case 'delete': {
        // Check if entity exists
        const entityExistsForDelete = await entityExists(entityType, entityId, userId, profileId)
        if (!entityExistsForDelete) {
          return { success: false, error: 'Entity not found' }
        }
        return deleteEntity(entityType, entityId, userId, profileId)
      }
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Check if an operation conflicts with current server state
 */
async function checkConflict(
  operation: SyncOperation
): Promise<{ hasConflict: boolean; conflictType?: string; serverData?: Record<string, unknown> }> {
  const entityType = operation.entityType as keyof EntityTableMap
  const entityId = operation.entityId
  const userId = operation.userId
  const profileId = operation.profileId

  // Validate userId is not empty
  if (!userId) {
    return { hasConflict: false }
  }

  try {
    switch (operation.type) {
      case 'create': {
        // Conflict if entity already exists on server
        const exists = await entityExists(entityType, entityId, userId, profileId)
        if (exists) {
          const serverData = await getEntity(entityType, entityId, userId, profileId)
          return {
            hasConflict: true,
            conflictType: 'create-create',
            serverData: serverData || undefined,
          }
        }
        break
      }

      case 'update': {
        // Conflict if entity doesn't exist on server
        const existsForUpdate = await entityExists(entityType, entityId, userId, profileId)
        if (!existsForUpdate) {
          return { hasConflict: true, conflictType: 'update-delete', serverData: undefined }
        }
        break
      }

      case 'delete': {
        // Conflict if entity doesn't exist on server
        const existsForDelete = await entityExists(entityType, entityId, userId, profileId)
        if (!existsForDelete) {
          return { hasConflict: true, conflictType: 'delete-update', serverData: undefined }
        }
        break
      }
    }

    return { hasConflict: false }
  } catch (error) {
    // If we can't check server state, be conservative and assume conflict
    // This prevents data resurrection from stale updates
    // Sanitize error to avoid exposing sensitive database information
    const sanitizedError = error instanceof Error ? error.message : String(error)
    logger.error('[Conflict Check Error]', { error: sanitizedError })
    return { hasConflict: true, conflictType: 'server-check-failed' }
  }
}

// ============================================================================
// Audit Logging (DanubeData PostgreSQL)
// ============================================================================

// Sync history table name
// ⚠️⚠️ THE SYNC AUDIT TRAIL AND HISTORY ARE NON-FUNCTIONAL. READ BEFORE EDITING.
//
// Every `db.execute()` below is suppressed with `@ts-expect-error`, and the
// suppression is the honest signal, not a workaround. Three independent problems,
// all pre-existing (tracked in `deferred-work.md`):
//
//   1. `db.execute()` takes ONE argument. These calls pass a template string plus a
//      params array in node-postgres style, so the `$1, $2, …` placeholders are
//      never bound and Postgres would reject the statement outright.
//   2. NEITHER TABLE EXISTS. `packages/db/src/schema.ts` defines 11 tables and
//      `syncHistory`/`syncAuditLogs` are not among them, nor anywhere in that package.
//   3. Every call site swallows the failure into a `logger.error` fallback, which is
//      why none of this has ever surfaced.
//
// Left exactly as-is on purpose: story 38.3's type sweep chose the type-only route
// here rather than quietly rewriting a subsystem. Fixing it properly means a schema
// migration plus drizzle `sql` templates so parameters bind — a story with its own
// tests, not the tail end of a type cleanup. When that lands, these directives will
// start reporting "unused" and should be deleted with the fix.
const SYNC_HISTORY_TABLE = 'syncHistory'
const SYNC_AUDIT_TABLE = 'syncAuditLogs'

/**
 * Log an audit entry to database
 */
async function logAudit(
  userId: string,
  operationId: string,
  entityType: string,
  entityId: string,
  operationType: 'create' | 'update' | 'delete',
  success: boolean,
  error?: string,
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  try {
    await db.execute(
      `
      INSERT INTO ${SYNC_AUDIT_TABLE} (
        id, userId, operationId, entityType, entityId, operationType, timestamp, success, error, ipAddress, userAgent
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
      )
    `,
      // @ts-expect-error - unbound params; see the note at SYNC_HISTORY_TABLE
      [
        `audit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        userId,
        operationId,
        entityType,
        entityId,
        operationType,
        Date.now(),
        success,
        error,
        ipAddress,
        userAgent,
      ]
    )
  } catch (dbError) {
    // Fallback to console log if database fails
    // Sanitize error to avoid exposing sensitive database information
    const sanitizedError = dbError instanceof Error ? dbError.message : String(dbError)
    logger.error('[Audit DB Error]', {
      id: `audit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      userId,
      operationId,
      entityType,
      entityId,
      operationType,
      timestamp: Date.now(),
      success,
      error: sanitizedError,
      ipAddress,
      userAgent,
    })
  }
}

// ============================================================================
// Sync History (DanubeData PostgreSQL)
// ============================================================================

/**
 * Record a sync history entry to database
 */
async function recordSyncHistory(
  userId: string,
  deviceId: string,
  startTimestamp: number,
  endTimestamp: number,
  operationsCount: number,
  conflictCount: number,
  failureCount: number,
  status: SyncStatus,
  error?: string
): Promise<SyncHistoryEntry> {
  try {
    const historyEntry: SyncHistoryEntry = {
      id: `sync-history-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      userId,
      deviceId,
      startTimestamp,
      endTimestamp,
      operationsCount,
      conflictCount,
      failureCount,
      status,
      error,
    }

    await db.execute(
      `
      INSERT INTO ${SYNC_HISTORY_TABLE} (
        id, userId, deviceId, startTimestamp, endTimestamp, operationsCount, conflictCount, failureCount, status, error
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
      )
    `,
      // @ts-expect-error - unbound params; see the note at SYNC_HISTORY_TABLE
      [
        historyEntry.id,
        historyEntry.userId,
        historyEntry.deviceId,
        historyEntry.startTimestamp,
        historyEntry.endTimestamp,
        historyEntry.operationsCount,
        historyEntry.conflictCount,
        historyEntry.failureCount,
        historyEntry.status,
        historyEntry.error,
      ]
    )

    return historyEntry
  } catch (dbError) {
    // Fallback to console log if database fails
    // Sanitize error to avoid exposing sensitive database information
    const sanitizedError = dbError instanceof Error ? dbError.message : String(dbError)
    const historyEntry: SyncHistoryEntry = {
      id: `sync-history-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      userId,
      deviceId,
      startTimestamp,
      endTimestamp,
      operationsCount,
      conflictCount,
      failureCount,
      status,
      error: `DB Error: ${sanitizedError}`,
    }
    logger.error('[SyncHistory DB Error]', { entry: historyEntry })
    return historyEntry
  }
}

// ============================================================================
// Main API Functions
// ============================================================================

/**
 * Process a batch of sync operations
 *
 * This is the main endpoint for handling client sync requests.
 * It processes operations in order, detects conflicts, and applies changes.
 *
 * @param request - The batch sync request
 * @param user - The authenticated user. Only `id` (the uuid the operations must
 *   belong to) and `subscriptionStatus` (the paid-tier gate) are read, so callers
 *   may pass a session projection rather than a full DB row. NOTE: the session
 *   object exposes the user id as `userId`; callers MUST map it to `id` here or
 *   the per-operation ownership check silently compares against `undefined`.
 * @param ipAddress - Client IP address
 * @param userAgent - Client user agent
 * @returns Batch sync response
 */
export async function processBatchSync(
  request: BatchSyncRequest,
  user: Pick<User, 'id' | 'subscriptionStatus'>,
  ipAddress?: string,
  userAgent?: string
): Promise<BatchSyncResponse> {
  const startTime = Date.now()

  // Validate request
  const validationResult = batchSyncRequestSchema.safeParse(request)
  if (!validationResult.success) {
    return {
      success: false,
      processedCount: 0,
      failedCount: 0,
      conflictCount: 0,
      conflicts: [],
      failedOperationIds: [],
      serverTimestamp: Date.now(),
      status: SyncStatusEnum.FAILED,
      error: `Invalid request: ${validationResult.error.message}`,
    }
  }

  const { operations, deviceId } = validationResult.data

  // Tier gating: server-side sync is a paid-tier feature. Free (and canceled)
  // users must not be able to persist data to the server even with a valid
  // session. Only subscriptions with active access may sync.
  if (!PAID_SYNC_STATUSES.includes(user.subscriptionStatus)) {
    return {
      success: false,
      processedCount: 0,
      failedCount: 0,
      conflictCount: 0,
      conflicts: [],
      failedOperationIds: [],
      serverTimestamp: Date.now(),
      status: SyncStatusEnum.FAILED,
      error: 'Forbidden: server sync requires an active paid subscription',
    }
  }

  // Verify all operations belong to this user first (fail fast on auth)
  for (const operation of operations) {
    if (operation.userId !== user.id) {
      return {
        success: false,
        processedCount: 0,
        failedCount: 0,
        conflictCount: 0,
        conflicts: [],
        failedOperationIds: [],
        serverTimestamp: Date.now(),
        status: SyncStatusEnum.FAILED,
        error: 'Unauthorized: Operation user ID mismatch',
      }
    }
  }

  // Check rate limit (only after user validation succeeds)
  const rateLimit = await checkRateLimit(user.id)
  if (!rateLimit.allowed) {
    return {
      success: false,
      processedCount: 0,
      failedCount: 0,
      conflictCount: 0,
      conflicts: [],
      failedOperationIds: [],
      serverTimestamp: Date.now(),
      status: SyncStatusEnum.FAILED,
      error: 'Rate limit exceeded',
    }
  }

  let processedCount = 0
  let failedCount = 0
  let conflictCount = 0
  const conflicts: SyncConflict[] = []
  const failedOperationIds: string[] = []

  // Process each operation
  for (const operation of operations) {
    // Check for conflicts
    const conflictCheck = await checkConflict(operation)

    // A create whose uuid the server already holds (for this user + profile) is
    // an ALREADY-APPLIED create — ids are client-generated uuids, so no other
    // device can have minted it. Typical causes: a lost response, or the
    // free→paid seed re-enqueueing a row. Acknowledge it as processed. Reported
    // as a conflict, the client keeps the op queued forever (conflicts are never
    // removed), and a batch that always contains a conflict never drains the
    // operations behind it.
    if (conflictCheck.hasConflict && conflictCheck.conflictType === 'create-create') {
      processedCount++
      await logAudit(
        user.id,
        operation.id,
        operation.entityType,
        operation.entityId,
        operation.type,
        true,
        'Create already applied',
        ipAddress,
        userAgent
      )
      continue
    }

    if (conflictCheck.hasConflict) {
      // Conflict detected - record it
      conflictCount++
      conflicts.push({
        localOperationId: operation.id,
        serverOperationId: `server-${operation.entityType}-${operation.entityId}`,
        entityType: operation.entityType,
        entityId: operation.entityId,
        conflictType: conflictCheck.conflictType || 'unknown',
      })

      // Log the conflict (success: true because conflicts are expected scenarios)
      await logAudit(
        user.id,
        operation.id,
        operation.entityType,
        operation.entityId,
        operation.type,
        true,
        `Conflict: ${conflictCheck.conflictType}`,
        ipAddress,
        userAgent
      )

      continue
    }

    // Apply the operation
    const result = await applyOperation(operation)

    if (result.success) {
      processedCount++

      // Log successful operation
      await logAudit(
        user.id,
        operation.id,
        operation.entityType,
        operation.entityId,
        operation.type,
        true,
        undefined,
        ipAddress,
        userAgent
      )
    } else {
      failedCount++
      failedOperationIds.push(operation.id)

      // Log failed operation
      await logAudit(
        user.id,
        operation.id,
        operation.entityType,
        operation.entityId,
        operation.type,
        false,
        result.error,
        ipAddress,
        userAgent
      )
    }
  }

  const endTime = Date.now()

  // Determine final status
  let status: SyncStatus = SyncStatusEnum.COMPLETED
  if (failedCount > 0) {
    status = SyncStatusEnum.FAILED
  } else if (conflictCount > 0) {
    status = SyncStatusEnum.PARTIAL
  }

  // Record sync history to database
  const errorMessage =
    failedCount > 0
      ? 'Sync completed with errors'
      : conflictCount > 0
        ? 'Sync completed with conflicts'
        : undefined

  await recordSyncHistory(
    user.id,
    deviceId,
    startTime,
    endTime,
    operations.length,
    conflictCount,
    failedCount,
    status,
    errorMessage
  )

  return {
    success: failedCount === 0, // Success if no failures (conflicts are OK)
    processedCount,
    failedCount,
    conflictCount,
    conflicts,
    failedOperationIds,
    serverTimestamp: endTime,
    status,
  }
}

/**
 * Get sync history for a user from database
 */
export async function getSyncHistory(userId: string): Promise<SyncHistoryEntry[]> {
  try {
    const result = await db.execute(
      `
      SELECT * FROM ${SYNC_HISTORY_TABLE} 
      WHERE userId = $1 
      ORDER BY startTimestamp DESC
    `,
      // @ts-expect-error - unbound params; see the note at SYNC_HISTORY_TABLE
      [userId]
    )
    // The query above cannot run (see the SYNC_HISTORY_TABLE note), so this cast is
    // never exercised. Routed through `unknown` because `Record<string, unknown>[]`
    // and `SyncHistoryEntry[]` genuinely do not overlap — asserting otherwise would
    // be claiming a shape nothing produces.
    return result.rows as unknown as SyncHistoryEntry[]
  } catch {
    return []
  }
}

/**
 * Get sync audit logs for a user from database
 */
export async function getSyncAuditLogs(userId: string): Promise<SyncAuditLog[]> {
  try {
    const result = await db.execute(
      `
      SELECT * FROM ${SYNC_AUDIT_TABLE} 
      WHERE userId = $1 
      ORDER BY timestamp DESC 
      LIMIT 1000
    `,
      // @ts-expect-error - unbound params; see the note at SYNC_HISTORY_TABLE
      [userId]
    )
    // See the note on the history query above — same non-functional path.
    return result.rows as unknown as SyncAuditLog[]
  } catch {
    return []
  }
}

/**
 * Get current sync status for a user
 */
export async function getSyncStatus(userId: string): Promise<{
  pendingCount: number
  conflictCount: number
  lastSyncTimestamp: number | null
  status: SyncStatus
}> {
  try {
    // Get last sync from history
    const result = await db.execute(
      `
      SELECT * FROM ${SYNC_HISTORY_TABLE} 
      WHERE userId = $1 
      ORDER BY startTimestamp DESC 
      LIMIT 1
    `,
      // @ts-expect-error - unbound params; see the note at SYNC_HISTORY_TABLE
      [userId]
    )

    const lastSync = result.rows[0] as SyncHistoryEntry | undefined

    return {
      pendingCount: 0, // Would be from pending operations table
      conflictCount: 0, // Would be from conflicts table
      lastSyncTimestamp: lastSync?.endTimestamp || null,
      status: lastSync?.status || SyncStatusEnum.PENDING,
    }
  } catch {
    return {
      pendingCount: 0,
      conflictCount: 0,
      lastSyncTimestamp: null,
      status: SyncStatusEnum.PENDING,
    }
  }
}

// ============================================================================
// Server → Client Pull (Story 4-18)
// ============================================================================

/**
 * Normalize a Drizzle timestamp value to a Unix epoch in milliseconds.
 * Drizzle may hand back a `Date` (default mode) or an ISO string; both are
 * handled so the pull cursor is always a comparable number.
 */
function toEpochMs(value: unknown): number {
  if (value instanceof Date) {
    return value.getTime()
  }
  if (typeof value === 'number') {
    return value
  }
  const parsed = new Date(value as string).getTime()
  return Number.isNaN(parsed) ? 0 : parsed
}

/**
 * Maximum number of changes returned by a single pull, regardless of the
 * client-requested limit. Bounds the response size (DoS guard).
 */
const MAX_PULL_LIMIT = 500

/**
 * Get server-side changes for a user since a cursor (Story 4-18, AC-1/AC-3).
 *
 * Selects rows from every syncable entity table where `updatedAt > since`
 * (full snapshot when `since` is null), INCLUDING soft-deleted tombstones so
 * deletions propagate to other devices (AC-3). Profile-scoped entities are
 * additionally filtered by the active `profileId` to prevent cross-profile
 * leakage; `userProfiles` are scoped by user only.
 *
 * SECURITY: the caller MUST pass the SESSION user id (never a client-supplied
 * userId) — this function trusts `userId` as already-authorized. The result is
 * ordered by `updatedAt` ascending and capped at `limit`, so a client that is
 * behind paginates forward deterministically via its advancing cursor.
 */
/**
 * Cap a timestamp-sorted change list WITHOUT splitting a run of rows that share
 * the same `updatedAt` across the page boundary (Story 4-18 review P1).
 *
 * The pull cursor is the last returned row's `updatedAt`, and the next pull
 * filters `updatedAt > cursor`. A blind `slice(0, cap)` through a run of rows
 * sharing one `updatedAt` would leave the overflow rows at that timestamp `==
 * cursor` next time, so the strict `>` would skip them FOREVER (silent data
 * loss). So trim back to the last fully-included timestamp. Degenerate case: if
 * the entire first `cap` rows share one timestamp, include that whole timestamp
 * group (may exceed `cap`) so the cursor can still advance instead of stalling.
 */
export function capChangesAtTimestampBoundary(sorted: ServerChange[], cap: number): ServerChange[] {
  if (sorted.length <= cap) {
    return sorted
  }
  const boundaryRow = sorted[cap] // first EXCLUDED row
  // Unreachable: the `sorted.length <= cap` branch above already returned, so index
  // `cap` is in range. Narrowed rather than asserted.
  if (!boundaryRow) {
    return sorted
  }
  const boundaryTs = boundaryRow.updatedAt
  let end = cap
  while (end > 0 && sorted[end - 1]?.updatedAt === boundaryTs) {
    end--
  }
  if (end === 0) {
    // The whole page is a single timestamp larger than the cap: include the full
    // group for that timestamp to guarantee forward progress.
    let i = cap
    while (i < sorted.length && sorted[i]?.updatedAt === boundaryTs) {
      i++
    }
    return sorted.slice(0, i)
  }
  return sorted.slice(0, end)
}

/**
 * Upper bound on a supplementary exact-timestamp fetch (below). Real
 * financial data essentially never has thousands of rows sharing one
 * millisecond; this is a DoS guard, not an expected ceiling.
 */
const MAX_BOUNDARY_GROUP_SIZE = 5000

interface SafeTablePage {
  changes: ServerChange[]
  /**
   * The highest `updatedAt` (epoch ms) this table is now KNOWN to be
   * completely fetched up to and including. `Infinity` when the table had no
   * more rows beyond what was returned (fully drained by this pull).
   */
  safeWatermark: number
}

/**
 * Fetch one entity table's page for a pull, guaranteed never to silently,
 * permanently drop rows at a shared-`updatedAt` boundary (Story 53.1, AC-3;
 * review-hardened — see the story's Review Findings).
 *
 * Two-phase strategy:
 *  1. Over-fetch by one row (`cappedLimit + 1`) so the LAST row's timestamp
 *     reveals whether the page's tail sits inside a still-open group.
 *  2. If the group at that boundary fills the ENTIRE over-fetched window (the
 *     degenerate case `capChangesAtTimestampBoundary` already detects), issue
 *     ONE supplementary query for every row at that exact timestamp
 *     (`fetchExactTimestamp`, bounded by `MAX_BOUNDARY_GROUP_SIZE`) so the
 *     group is returned COMPLETE — not merely "not split mid-group", which is
 *     as far as the pre-existing cross-table-only fix went.
 *
 * `safeWatermark` is this table's own contribution to the GLOBAL pull cursor:
 * `getSyncChanges` takes the MINIMUM watermark across all 6 tables, because a
 * table that stopped early (its own cap, not exhaustion) has UNSEEN rows that
 * a cursor advanced past any other table's later timestamp would skip
 * forever — exactly the cross-table interaction the story's code review
 * found broken in the first version of this fix.
 */
async function fetchTableChangesSafely<
  Row extends { id: string; updatedAt: Date; isDeleted: boolean },
>(
  entityType: ServerChange['entityType'],
  fetchPage: (limit: number) => Promise<Row[]>,
  fetchExactTimestamp: (timestamp: Date) => Promise<Row[]>,
  cappedLimit: number
): Promise<SafeTablePage> {
  const toChange = (row: Row): ServerChange => ({
    entityType,
    entityId: row.id,
    data: row,
    updatedAt: toEpochMs(row.updatedAt),
    isDeleted: row.isDeleted,
  })

  const rows = await fetchPage(cappedLimit + 1)
  if (rows.length <= cappedLimit) {
    // Exhausted: every matching row for this table was returned.
    return { changes: rows.map(toChange), safeWatermark: Number.POSITIVE_INFINITY }
  }

  // rows.length === cappedLimit + 1 here (fetchPage never returns more than
  // asked), so index `cappedLimit` is the first row we over-fetched to peek at.
  const boundaryRow = rows[cappedLimit]
  if (!boundaryRow) {
    // Unreachable given the length check above; narrowed rather than asserted.
    return { changes: rows.map(toChange), safeWatermark: Number.POSITIVE_INFINITY }
  }
  const boundaryTs = boundaryRow.updatedAt
  const boundaryMs = boundaryTs.getTime()

  const belowBoundary = rows.filter((row) => row.updatedAt.getTime() < boundaryMs)
  if (belowBoundary.length > 0) {
    // A safe cutoff exists strictly below the boundary timestamp — defer the
    // whole boundary group to the next pull rather than risk returning it
    // incomplete.
    const lastSafeRow = belowBoundary[belowBoundary.length - 1]
    // Unreachable (belowBoundary.length > 0 just checked); narrowed not asserted.
    const safeWatermark = lastSafeRow ? lastSafeRow.updatedAt.getTime() : Number.NEGATIVE_INFINITY
    return { changes: belowBoundary.map(toChange), safeWatermark }
  }

  // Degenerate case: every one of the cappedLimit+1 fetched rows shares the
  // boundary timestamp, so this fetch alone cannot tell whether more rows
  // exist at that exact instant. Fetch the true full group.
  const fullGroup = await fetchExactTimestamp(boundaryTs)
  if (fullGroup.length >= MAX_BOUNDARY_GROUP_SIZE) {
    // Pathological: bail out rather than trust a possibly-incomplete
    // "complete" group. Defer the whole thing — no forward progress from
    // this table this round, but no silent loss either.
    logger.error('[getSyncChanges] boundary group exceeds safety cap, deferring', {
      entityType,
      boundaryTs: boundaryTs.toISOString(),
      size: fullGroup.length,
    })
    return { changes: [], safeWatermark: Number.NEGATIVE_INFINITY }
  }
  return { changes: fullGroup.map(toChange), safeWatermark: boundaryMs }
}

export async function getSyncChanges(
  userId: string,
  since: number | null,
  limit = 100,
  profileId?: string
): Promise<ServerChange[]> {
  const cappedLimit = Math.min(Math.max(1, Math.floor(limit)), MAX_PULL_LIMIT)
  const sinceDate = since !== null ? new Date(since) : null
  const changes: ServerChange[] = []
  const watermarks: number[] = []

  // Profile-scoped entity tables are pulled ONLY when an active profile is known
  // (Story 4-18 review P3). Without a profileId we must NOT fall back to "all
  // profiles", or a null / mid-switch active profile would mix other profiles'
  // rows into the active stores. `userProfiles` is user-scoped and always pulled
  // (the client needs the profile list before it can choose an active profile).
  //
  // ⚠️ Every table below goes through `fetchTableChangesSafely` (Story 53.1,
  // AC-3), not a bare `.limit()` — see that function's docblock for why a
  // per-table-only fix (the first version of this story's patch) was still
  // provably lossy across tables, and how the GLOBAL cursor below is derived.
  if (profileId !== undefined) {
    // Income sources (profile-scoped)
    const income = await fetchTableChangesSafely(
      'incomeSource',
      (pageLimit) =>
        db
          .select()
          .from(incomeSources)
          .where(
            and(
              eq(incomeSources.userId, userId),
              eq(incomeSources.profileId, profileId),
              sinceDate ? gt(incomeSources.updatedAt, sinceDate) : undefined
            )
          )
          .orderBy(asc(incomeSources.updatedAt))
          .limit(pageLimit),
      (timestamp) =>
        db
          .select()
          .from(incomeSources)
          .where(
            and(
              eq(incomeSources.userId, userId),
              eq(incomeSources.profileId, profileId),
              eq(incomeSources.updatedAt, timestamp)
            )
          )
          .limit(MAX_BOUNDARY_GROUP_SIZE),
      cappedLimit
    )
    changes.push(...income.changes)
    watermarks.push(income.safeWatermark)

    // Categories (profile-scoped, Story 30.4a)
    //
    // ⚠️ This function is FIVE (now six) hand-written per-entity blocks, not a
    // table-driven loop. A new field rides along free because select() returns
    // the whole row — but a new ENTITY reaches no second device at all unless a
    // block like this is added. Silent: nothing fails, the data simply never
    // arrives.
    const category = await fetchTableChangesSafely(
      'category',
      (pageLimit) =>
        db
          .select()
          .from(categories)
          .where(
            and(
              eq(categories.userId, userId),
              eq(categories.profileId, profileId),
              sinceDate ? gt(categories.updatedAt, sinceDate) : undefined
            )
          )
          .orderBy(asc(categories.updatedAt))
          .limit(pageLimit),
      (timestamp) =>
        db
          .select()
          .from(categories)
          .where(
            and(
              eq(categories.userId, userId),
              eq(categories.profileId, profileId),
              eq(categories.updatedAt, timestamp)
            )
          )
          .limit(MAX_BOUNDARY_GROUP_SIZE),
      cappedLimit
    )
    changes.push(...category.changes)
    watermarks.push(category.safeWatermark)

    // Expenses (profile-scoped)
    const expense = await fetchTableChangesSafely(
      'expense',
      (pageLimit) =>
        db
          .select()
          .from(expenses)
          .where(
            and(
              eq(expenses.userId, userId),
              eq(expenses.profileId, profileId),
              sinceDate ? gt(expenses.updatedAt, sinceDate) : undefined
            )
          )
          .orderBy(asc(expenses.updatedAt))
          .limit(pageLimit),
      (timestamp) =>
        db
          .select()
          .from(expenses)
          .where(
            and(
              eq(expenses.userId, userId),
              eq(expenses.profileId, profileId),
              eq(expenses.updatedAt, timestamp)
            )
          )
          .limit(MAX_BOUNDARY_GROUP_SIZE),
      cappedLimit
    )
    changes.push(...expense.changes)
    watermarks.push(expense.safeWatermark)

    // Savings goals (profile-scoped)
    const savings = await fetchTableChangesSafely(
      'savingsGoal',
      (pageLimit) =>
        db
          .select()
          .from(savingsGoals)
          .where(
            and(
              eq(savingsGoals.userId, userId),
              eq(savingsGoals.profileId, profileId),
              sinceDate ? gt(savingsGoals.updatedAt, sinceDate) : undefined
            )
          )
          .orderBy(asc(savingsGoals.updatedAt))
          .limit(pageLimit),
      (timestamp) =>
        db
          .select()
          .from(savingsGoals)
          .where(
            and(
              eq(savingsGoals.userId, userId),
              eq(savingsGoals.profileId, profileId),
              eq(savingsGoals.updatedAt, timestamp)
            )
          )
          .limit(MAX_BOUNDARY_GROUP_SIZE),
      cappedLimit
    )
    changes.push(...savings.changes)
    watermarks.push(savings.safeWatermark)

    // Balance tracking (profile-scoped)
    const balance = await fetchTableChangesSafely(
      'balanceTracking',
      (pageLimit) =>
        db
          .select()
          .from(balanceTracking)
          .where(
            and(
              eq(balanceTracking.userId, userId),
              eq(balanceTracking.profileId, profileId),
              sinceDate ? gt(balanceTracking.updatedAt, sinceDate) : undefined
            )
          )
          .orderBy(asc(balanceTracking.updatedAt))
          .limit(pageLimit),
      (timestamp) =>
        db
          .select()
          .from(balanceTracking)
          .where(
            and(
              eq(balanceTracking.userId, userId),
              eq(balanceTracking.profileId, profileId),
              eq(balanceTracking.updatedAt, timestamp)
            )
          )
          .limit(MAX_BOUNDARY_GROUP_SIZE),
      cappedLimit
    )
    changes.push(...balance.changes)
    watermarks.push(balance.safeWatermark)
  }

  // User profiles (scoped by user only — profiles are not themselves profile-scoped)
  const profiles = await fetchTableChangesSafely(
    'userProfile',
    (pageLimit) =>
      db
        .select()
        .from(userProfiles)
        .where(
          and(
            eq(userProfiles.userId, userId),
            sinceDate ? gt(userProfiles.updatedAt, sinceDate) : undefined
          )
        )
        .orderBy(asc(userProfiles.updatedAt))
        .limit(pageLimit),
    (timestamp) =>
      db
        .select()
        .from(userProfiles)
        .where(and(eq(userProfiles.userId, userId), eq(userProfiles.updatedAt, timestamp)))
        .limit(MAX_BOUNDARY_GROUP_SIZE),
    cappedLimit
  )
  changes.push(...profiles.changes)
  watermarks.push(profiles.safeWatermark)

  // The GLOBAL cursor this pull can safely promise is the MINIMUM watermark
  // across all 6 tables — the tightest constraint wins. A table with a lower
  // watermark than another has rows this pull never even looked at yet
  // (its own page ran out before reaching that far); advancing the cursor
  // past that point would make `gt(updatedAt, cursor)` skip them forever on
  // the next pull. Some already-safe rows from a faster-draining table may
  // get re-delivered next pull as a result — harmless, since applying a
  // change twice is idempotent (`applyServerChangesToStores`).
  const safeCursor = Math.min(...watermarks)
  const safeChanges =
    safeCursor === Number.POSITIVE_INFINITY
      ? changes
      : changes.filter((c) => c.updatedAt <= safeCursor)

  // Merge across tables, order by the global cursor with a stable id tiebreaker,
  // then cap WITHOUT splitting a same-timestamp group across the boundary (P1).
  // (Every table's own page is already safe up to `safeCursor` above; this
  // second pass bounds the TOTAL response size across all 6 tables combined.)
  safeChanges.sort((a, b) => a.updatedAt - b.updatedAt || a.entityId.localeCompare(b.entityId))
  return capChangesAtTimestampBoundary(safeChanges, cappedLimit)
}

/**
 * Resolve a conflict manually
 *
 * In a production implementation, this would allow the user to choose
 * which version of the data to keep when a conflict is detected.
 */
export async function resolveConflict(
  userId: string,
  conflictId: string,
  resolution: SyncOperation
): Promise<{ success: boolean; error?: string }> {
  // For now, apply the resolution operation
  try {
    const result = await applyOperation(resolution)
    if (result.success) {
      // Log the resolution
      await logAudit(
        userId,
        conflictId,
        resolution.entityType,
        resolution.entityId,
        resolution.type,
        true,
        'Conflict resolved',
        undefined,
        undefined
      )
    }
    return result
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

// ============================================================================
// Exports
// ============================================================================

export { RATE_LIMIT_CONFIG }

// The five types are already exported at their declarations (`:42`, `:54`, `:78`,
// `:96`, `:122`); re-exporting them here was a duplicate declaration, not an
// additional export.
