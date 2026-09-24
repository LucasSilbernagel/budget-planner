/**
 * Sync API Endpoints
 *
 * Server API endpoints for handling synchronization operations.
 * Implements batch processing and conflict detection.
 *
 * Features:
 * - Batch sync operations
 * - Conflict DETECTION (reported to the client; this module does not resolve them)
 * - Authentication validation
 * - Rate limiting
 *
 * ⚠️ There is deliberately NO sync-history or audit-log feature here. One was
 * written, never worked, and was deleted by story 66.1 (FR102, 2026-09-24): the
 * `syncHistory`/`syncAuditLogs` tables were never in `packages/db/src/schema.ts`,
 * `db.execute()` was called with two arguments, and every failure was swallowed.
 * Re-adding one means a schema migration plus drizzle `sql` templates that bind
 * their parameters — a story with its own tests, not a helper dropped in here.
 *
 * Data Sovereignty: ALL data stored in DanubeData PostgreSQL (Germany - EU) for CLOUD Act immunity (NFR1, NFR2)
 */

import { logger } from '@/lib/logger'
import { checkDbRateLimit } from '@/server/rate-limit/db-window'
import { FINANCE_TYPES } from '@budget-planner/core/services/balanceTracking'
import type { ServerChange, SyncOperation, SyncStatus } from '@budget-planner/core/sync'
import { SyncStatus as SyncStatusEnum } from '@budget-planner/core/sync'
import { SYNC_CURRENCIES } from '@budget-planner/core/sync/types'
import type { User } from '@budget-planner/db'
import { db } from '@budget-planner/db'
import {
  balanceTracking,
  categories,
  expenses,
  forecastingProfiles,
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
  // Story 65.2 (FR101): the "this expense ends before I retire" flag.
  //
  // ⚠️ What this declaration buys is VALIDATION, not stripping — the same
  // correction `sortOrder` records above. `syncOperationSchema` declares `data:
  // z.record(z.unknown())` and invokes this schema inside a `superRefine`, which
  // DISCARDS its callback's return value, so `operation.data` reaches
  // `applyOperation` unstripped and this `.default(false)` never lands. Declaring
  // it is what makes a non-boolean get rejected HERE rather than at the UPDATE.
  // ⚠️ Deliberately NOT on `incomeSourceSchema`: `incomeSources` has no such
  // column, and `updateEntity` spreads `operation.data` straight into `.set()`.
  //
  // ⚠️ `.default(false)` is KEPT rather than narrowed to `.optional()`, a call
  // code review 65.2 raised: the default is provably inert here (the Gate 4 test
  // pins that `superRefine` discards it), so `.optional()` would state the real
  // contract more honestly. It stays for symmetry with
  // `contributionRecordedAsExpense` below, which is the established precedent for
  // a boolean in this file — a lone exception would read as an oversight. If the
  // `superRefine` is ever fixed to use its parse result, EVERY default in this
  // file starts landing on partial updates and they must be reviewed together.
  endsBeforeRetirement: z.boolean().default(false),
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
  // ⚠⚠ The FULL enum, via core's shared list. This gate carried an 11-value
  // list until the code review of story 66.2: the `currency` column has held all
  // 21 values since migration 0001, and `mapProvidedCurrency` in the Paddle
  // webhook writes any of them. An 11-value list here rejects a legitimate EDIT
  // to a profile the webhook itself created. Pre-existing; fixed alongside the
  // pull gate so the two cannot drift apart again.
  currency: z.enum(SYNC_CURRENCIES),
  // Story 54.2 (FR78): the user-chosen avatar emoji.
  //
  // ⚠️ This object is a HAND-MAINTAINED DUPLICATE of core's `userProfileSchema`
  // (packages/core/src/sync/types.ts) — it is not derived from it, so the two
  // drift silently. Change both.
  //
  // ⚠️ This gate VALIDATES but does not STRIP: it is invoked inside
  // `syncOperationSchema`'s `superRefine`, whose return value zod discards, and
  // `data` is `z.record(z.unknown())` at the top level. So omitting this line
  // would not drop `icon` — it would let an over-long value through to the
  // INSERT, to fail against `varchar(16)` in the database instead of here.
  icon: z.string().max(16).nullable().optional(),
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
 * reach the INSERT and fail on the primary key.
 *
 * ⚠️ That failure would surface as a 200 envelope with `failedCount > 0` and NO
 * status code, which the client now KEEPS QUEUED (it removes an operation only
 * on a status code that proves permanent rejection). So without this guard the
 * op replays every cycle rather than being dropped — a stuck queue, not a lost
 * edit. Either way the guard is what stops it.
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
 * Restore the "at least one default profile" invariant for one user.
 *
 * No-op unless the user has live profiles and none of them is the default, so
 * it is safe to call after any batch that touched `userProfile`. See the call
 * site for the three push shapes that can empty the set.
 *
 * ⚠️ The successor is the OLDEST live profile, tiebroken by `id`. The tiebreak
 * is load-bearing rather than tidy: `createDefaultProfileForUser` can create
 * profiles inside one transaction, so `createdAt` alone is not a total order and
 * "the oldest" would otherwise mean "whatever the planner returned first" —
 * which can differ between two devices repairing the same account.
 */
async function ensureUserHasDefaultProfile(userId: string): Promise<void> {
  const live = await db
    .select({ id: userProfiles.id, createdAt: userProfiles.createdAt })
    .from(userProfiles)
    .where(and(eq(userProfiles.userId, userId), eq(userProfiles.isDeleted, false)))

  if (live.length === 0) return

  const hasDefault = await db
    .select({ id: userProfiles.id })
    .from(userProfiles)
    .where(
      and(
        eq(userProfiles.userId, userId),
        eq(userProfiles.isDefault, true),
        eq(userProfiles.isDeleted, false)
      )
    )
  if (hasDefault.length > 0) return

  const successor = [...live].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)
  )[0]
  if (!successor) return

  await db
    .update(userProfiles)
    .set({ isDefault: true, updatedAt: new Date() })
    .where(and(eq(userProfiles.id, successor.id), eq(userProfiles.userId, userId)))
}

/**
 * Every profile-scoped CHILD table, in the order `server/api/account.ts:90-100`
 * deletes them (story 66.3, AC-4/AC-9).
 *
 * ⚠️ The child set is SIX tables, not the four "financial arrays" the epic names.
 * `categories` became profile-scoped in story 30.4a and `forecastingProfiles`
 * (saved forecasts, `routes/forecasting.tsx`) has always been — it is simply not
 * a syncable entity, so no push can express an operation on it and it is easy to
 * miss. `server/functions/profiles.ts` names it in a comment as a child it does
 * not delete.
 *
 * ⚠️ `forecastingProfiles` is listed SEPARATELY below rather than here because it
 * has NO `isDeleted` column (`packages/db/src/schema.ts:568-600`), so it cannot
 * be tombstoned — see {@link deleteProfileWithChildren}.
 */
const PROFILE_CHILD_TABLES = [
  incomeSources,
  expenses,
  categories,
  savingsGoals,
  balanceTracking,
] as const

/**
 * Tombstone a profile AND everything it owns, atomically (story 66.3, AC-4/AC-9).
 *
 * ## The decision this implements
 *
 * Deleting a profile DESTROYS its rows; it does not re-home them onto a survivor
 * (story 66.3, D1). Re-homing MERGES two ledgers and silently moves the
 * survivor's totals — the one outcome profiles exist to prevent. `deleteAccount`
 * (`server/api/account.ts`) is the destroy precedent at this exact shape.
 *
 * ## ⚠️⚠️ Tombstone for five, HARD DELETE for one, and the asymmetry is forced
 *
 * The five tables above are SOFT-deleted, matching {@link deleteEntity} and the
 * rest of the push path: a tombstone is the only thing a delta-by-updatedAt pull
 * can carry, so a hard delete would make the removal invisible to other devices
 * by construction. `forecastingProfiles` has no `isDeleted` column at all, so it
 * is hard-deleted — it is also unsyncable (absent from `entityTableMap`), so
 * there is no pull that could have carried its tombstone anyway.
 *
 * ⚠️ FK ORDER IS NOT LOAD-BEARING HERE, and saying otherwise would be inherited
 * as a false constraint. Every FK in this schema is `ON DELETE NO ACTION`
 * (`grep -n onDelete packages/db/src/schema.ts packages/db/migrations/*.sql`
 * returns zero hits), which is exactly why `deleteUserAccount` must order its
 * HARD deletes — but an UPDATE that sets `isDeleted` removes no row and violates
 * no constraint. The order above is kept only so the two cascades read the same
 * way. The one genuinely constrained statement is the `forecastingProfiles`
 * delete, and it is a leaf: nothing references it.
 *
 * ⚠️ The profile row itself is tombstoned LAST, inside the same transaction, so a
 * failure part-way leaves the profile live rather than orphaning its children
 * behind a deleted parent.
 */
async function deleteProfileWithChildren(
  profileId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await db.transaction(async (tx) => {
      const now = new Date()
      for (const table of PROFILE_CHILD_TABLES) {
        await tx
          .update(table)
          .set({ isDeleted: true, updatedAt: now })
          .where(and(eq(table.userId, userId), eq(table.profileId, profileId)))
      }

      // ⚠️ HARD delete: no `isDeleted` column exists on this table. See above.
      await tx
        .delete(forecastingProfiles)
        .where(
          and(eq(forecastingProfiles.userId, userId), eq(forecastingProfiles.profileId, profileId))
        )

      await tx
        .update(userProfiles)
        .set({ isDeleted: true, updatedAt: now })
        .where(and(eq(userProfiles.userId, userId), eq(userProfiles.id, profileId)))
    })
    return { success: true }
  } catch (error) {
    // ⚠️ The detail goes to the LOG, not into the envelope (code review). The
    // envelope's `error` is discarded by `processBatchSync` today, so nothing
    // reaches a user either way — but returning the raw driver text from the one
    // path this story added, in the same story that closed exactly that leak in
    // `server/functions/profiles.ts`, is an asymmetry that survives only until
    // someone renders the envelope. Logging it also means a failed cascade is
    // observable at all, which it was not.
    logger.error('Profile cascade failed', { userId, profileId, error })
    return { success: false, error: 'Failed to delete profile' }
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

        if (entityType === 'userProfile') {
          // ⚠️⚠️ THE LAST-PROFILE RULE, ON THE LIVE PATH (story 66.3, AC-3).
          //
          // Both pre-existing guards are OFF this path: `stores/profileStore.ts`
          // is the client and is bypassable, and
          // `server/functions/profiles.ts:deleteProfile` has zero production
          // callers. So until this check, a hand-crafted or REPLAYED push could
          // tombstone a user's last profile — leaving an account with nowhere to
          // put data and `reconcileActiveProfile` early-returning on an empty
          // profile list (`lib/sync/applyServerChanges.ts:316-319`), which
          // strands `activeProfileId` on an id that no longer exists.
          //
          // ⚠️ This is a REFUSAL, and `ensureUserHasDefaultProfile` below stays a
          // REPAIR. They are not the same kind of rule and must not be merged.
          // The default-profile invariant is repairable — if a batch leaves the
          // account with no default, the server picks one and everything
          // continues — and the first version of that code DID veto, which broke
          // the legitimate demote-A-then-promote-B sequence (recorded at the
          // repair's call site, proven by its own positive control). "Zero live
          // profiles" has no repair: there is nothing left to promote and
          // inventing a replacement profile would be the server fabricating user
          // data. So this one refuses and that one repairs.
          const liveProfiles = await getLiveProfileIds(userId)
          if (liveProfiles.length <= 1) {
            // ⚠⚠ ACKNOWLEDGED, NOT TOMBSTONED — and the distinction is the whole
            // point (code review, Lucas's call). The INVARIANT AC-3 exists for is
            // "an account is never left with zero live profiles", and that holds
            // here: nothing below runs, the profile stays live. What changes is
            // the ENVELOPE.
            //
            // ⚠⚠ WHY NOT `success: false`. The first version returned a failure,
            // and the code review measured where that lands: a `{success:false}`
            // in a 200 envelope carries NO http status, so
            // `features/api/client.ts:348` marks it `retryable: false` with no
            // `statusCode`, and core files it under `unclassifiedFailedOperations`
            // (`packages/core/src/sync/synchronization.ts:1103`) which `:1185-1194`
            // DELIBERATELY KEEPS QUEUED — removal requires positive proof of
            // permanence. So the op replays every cycle, `failedCount > 0` every
            // time, `consecutiveFailures` climbs, the circuit breaker opens and
            // the drain branch never runs. One refused delete killed all sync for
            // that account. Before this story the same push SUCCEEDED, so the
            // permanently-unsatisfiable op was new damage.
            //
            // A client asking to delete its last profile is already out of step
            // with the server (its own guard would have stopped it). Acknowledging
            // drains the queue; the next pull delivers the real profile list and
            // corrects the client. Refusing forever corrects nothing.
            logger.warn('Refused a delete that would leave the user with no profile', {
              userId,
              entityId,
            })
            return { success: true }
          }

          // ⚠️ NOT `deleteEntity` — the profile's children must go with it
          // (AC-4/AC-9), in ONE transaction. `deleteEntity` tombstones the named
          // row and nothing else, which is the defect this story closes.
          return deleteProfileWithChildren(entityId, userId)
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
 * @returns Batch sync response
 */
export async function processBatchSync(
  request: BatchSyncRequest,
  user: Pick<User, 'id' | 'subscriptionStatus'>
): Promise<BatchSyncResponse> {
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

  const { operations } = validationResult.data

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

      continue
    }

    // Apply the operation
    const result = await applyOperation(operation)

    if (result.success) {
      processedCount++
    } else {
      failedCount++
      failedOperationIds.push(operation.id)
    }
  }

  // ⚠️⚠️ INVARIANT REPAIR: an account must never end a batch with live profiles
  // but NO default (story 63.2 code review, HIGH — reproduced against real
  // PostgreSQL before this existed).
  //
  // Three separate pushes can empty the set, and none of them is an error the
  // client can see:
  //  1. A device that has not pulled since another device deleted the default
  //     renames the promoted profile. `syncBridge` sends `isDefault` on EVERY
  //     profile update and `updateEntity` spreads it into `.set()`, so an
  //     ordinary RENAME re-sends `isDefault: false` and clears the flag. The
  //     update arm of `checkConflict` only tests existence — it never compares
  //     `baseVersion` — so nothing else stops it and the push reports success.
  //  2. A delete+promote pair that arrives promotion-first: the promotion is
  //     rejected by `userProfiles_one_default_per_user`, the tombstone applies.
  //  3. The tombstone lands while its paired promotion is stranded by a
  //     transient failure (recorded in `deferred-work.md`).
  //
  // Zero defaults is silent CORRUPTION, not an error: every consumer resolves
  // the default as `find(p => p.isDefault) ?? data[0]`, so each device quietly
  // falls back to an arbitrary profile and the user's data appears to change.
  //
  // ⚠️ A REPAIR, deliberately, and NOT a veto on demotion. The first design here
  // rejected any demotion that would empty the set — which also broke the
  // legitimate unset-then-set sequence (demote A, promote B in one batch), as
  // its own positive-control test proved. Repairing after the batch leaves every
  // valid ordering alone: a batch that ends with a default never triggers it.
  if (operations.some((operation) => operation.entityType === 'userProfile')) {
    await ensureUserHasDefaultProfile(user.id)
  }

  const endTime = Date.now()

  // Determine final status
  let status: SyncStatus = SyncStatusEnum.COMPLETED
  if (failedCount > 0) {
    status = SyncStatusEnum.FAILED
  } else if (conflictCount > 0) {
    status = SyncStatusEnum.PARTIAL
  }

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

// ============================================================================
// Exports
// ============================================================================

export { RATE_LIMIT_CONFIG }

// The remaining exported types (`BatchSyncRequest`, `BatchSyncResponse`,
// `SyncConflict`) are already exported at their declarations; re-exporting them
// here was a duplicate declaration, not an additional export. Line numbers are
// deliberately omitted — the previous version of this comment cited five types at
// five fixed lines, and story 66.1 both deleted two of them (`SyncHistoryEntry`,
// `SyncAuditLog`) and shifted every line it named.
