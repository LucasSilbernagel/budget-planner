import { logger } from '@/lib/logger'
import { hasPaidAccess } from '@/lib/premium/access-statuses'
import { type DbTx, lockUserProfileSet } from '@/server/api/profile-set-lock'
import type { SyncRejection, SyncRejectionReason } from '@/server/api/sync-rejection'
import { constraintOf, permanentRejectionReason, sqlStateOf } from '@/server/api/sync-rejection'
import { checkDbRateLimit } from '@/server/rate-limit/db-window'
import { FINANCE_TYPES } from '@budget-planner/core/services/balanceTracking'
import type { ServerChange, SyncOperation, SyncStatus } from '@budget-planner/core/sync'
import { SyncStatus as SyncStatusEnum } from '@budget-planner/core/sync'
import { SYNC_CURRENCIES, retirementPlanSyncSchema } from '@budget-planner/core/sync/types'
import type { User } from '@budget-planner/db'
import { db } from '@budget-planner/db'
import {
  balanceTracking,
  categories,
  expenses,
  forecastingProfiles,
  incomeSources,
  retirementPlans,
  savingsGoals,
  userProfiles,
} from '@budget-planner/db'
import { and, asc, eq, gt } from 'drizzle-orm'
import { z } from 'zod'

export interface BatchSyncRequest {
  operations: SyncOperation[]
  clientTimestamp: number
  deviceId: string
}

export interface BatchSyncResponse {
  success: boolean
  processedCount: number
  failedCount: number
  conflictCount: number
  conflicts: SyncConflict[]
  failedOperationIds: string[]
  serverTimestamp: number
  status: SyncStatus
  error?: string
  // Also counted in failedCount/failedOperationIds, so older clients behave as before.
  rejections?: SyncRejection[]
  // An explicit discriminant, so rewording an `error` cannot change the HTTP status.
  refusal?: BatchRefusal
}

// Only invalid-request is permanent (400). ownership answers 401, which core keeps queued.
export type BatchRefusal = 'invalid-request' | 'ownership' | 'tier' | 'rate-limit'

interface OperationResult {
  success: boolean
  error?: string
  rejection?: SyncRejectionReason
}

// Driver detail goes to the log only. Non-permanent failures keep their message and no
// rejection, so they stay queued.
function failureFromError(
  error: unknown,
  context: { entityType: string; entityId?: unknown; userId?: unknown }
): OperationResult {
  const rejection = permanentRejectionReason(error)
  if (rejection) {
    logger.error('Sync operation permanently refused by the database', {
      ...context,
      sqlState: sqlStateOf(error),
      constraint: constraintOf(error),
      error,
    })
    return { success: false, error: 'Refused by the database', rejection }
  }
  return {
    success: false,
    error: error instanceof Error ? error.message : String(error),
  }
}

interface SyncConflict {
  localOperationId: string
  serverOperationId: string
  entityType: string
  entityId: string
  conflictType: string
  resolution?: SyncOperation
}

const incomeSourceSchema = z.object({
  name: z.string().min(1).max(255),
  amount: z.number().int(),
  frequency: z.enum(['weekly', 'biweekly', 'monthly', 'annually']),
  // Accepts explicit null: un-categorizing sends null and updates use a partial .set().
  categoryId: z.string().uuid().nullable().optional(),
  // Validates, not strips: superRefine discards the parse result, so declaring the field is what
  // rejects a bad position here rather than at the INSERT.
  sortOrder: z.number().int().min(0).max(2_147_483_647).optional(),
  userId: z.string().uuid(),
})

const expenseSchema = z.object({
  name: z.string().min(1).max(255),
  amount: z.number().int(),
  frequency: z.enum(['weekly', 'biweekly', 'monthly', 'annually']),
  categoryId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).max(2_147_483_647).optional(),
  // Inert default: superRefine discards the parse. If that changes, every default here starts
  // landing on partial updates.
  endsBeforeRetirement: z.boolean().default(false),
  userId: z.string().uuid(),
})

const categorySchema = z.object({
  name: z.string().min(1).max(255),
  kind: z.enum(['income', 'expense']),
  userId: z.string().uuid(),
})

const savingsGoalSchema = z.object({
  name: z.string().min(1).max(255),
  // Positive integer = goal, null = account (no target); never a sentinel 0.
  targetAmount: z.number().int().positive().nullable().optional(),
  currentBalance: z.number().int().default(0),
  // Bounded to int32 so an over-range value is refused rather than overflowing the INSERT.
  monthlyAllocation: z.number().int().min(0).max(2_147_483_647).nullable().optional(),
  allocationMode: z.enum(['manual', 'automatic']).default('automatic'),
  sortOrder: z.number().int().min(0).max(2_147_483_647).optional(),
  userId: z.string().uuid(),
})

const balanceTrackingSchema = z.object({
  type: z.enum(FINANCE_TYPES),
  name: z.string().min(1).max(255),
  currentBalance: z.number().int().default(0),
  monthlyContribution: z.number().int().default(0),
  // Defaults to 'monthly' so pre-frequency rows round-trip.
  frequency: z.enum(['weekly', 'biweekly', 'monthly', 'annually']).default('monthly'),
  // Already recorded as an expense, so the savings pool must not subtract it twice.
  contributionRecordedAsExpense: z.boolean().default(false),
  // No FK and no existence check: a link to an expense the server does not hold yet is normal.
  paymentExpenseId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).max(2_147_483_647).optional(),
  userId: z.string().uuid(),
})

const userProfileSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(500).optional(),
  isDefault: z.boolean().default(false),
  // The full currency enum: the Paddle webhook can create profiles with any of them.
  currency: z.enum(SYNC_CURRENCIES),
  // Hand-maintained duplicate of core's userProfileSchema; change both.
  icon: z.string().max(16).nullable().optional(),
  userId: z.string().uuid(),
})

// Validates only; writeRetirementPlan re-parses and stores the parsed plan, so undeclared keys
// never reach the jsonb column.
const retirementPlanOperationSchema = z.object({
  plan: retirementPlanSyncSchema,
  userId: z.string().uuid(),
})

export const syncOperationSchema = z
  .object({
    id: z.string(),
    type: z.enum(['create', 'update', 'delete']),
    // Keep in lockstep with core's SyncEntityType: one unknown entityType fails the whole batch
    // and the client retries it forever.
    entityType: z.enum([
      'incomeSource',
      'expense',
      'savingsGoal',
      'balanceTracking',
      'userProfile',
      'category',
      'retirementPlan',
    ]),
    // Every entity id is a uuid; refusing here is a clean 400 instead of a permanent queue loop.
    entityId: z.string().uuid(),
    data: z.record(z.unknown()),
    timestamp: z.number(),
    deviceId: z.string(),
    userId: z.string(),
    // Load-bearing: z.object strips undeclared keys and the parsed output is consumed.
    // profileId is ownership-checked in applyOperation.
    profileId: z.string().uuid().optional(),
    version: z.number().optional(),
    baseVersion: z.number().optional(),
  })
  .superRefine((data, ctx) => {
    const { entityType, data: entityData, type } = data

    if (type === 'delete') {
      if (!entityData['userId']) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Delete operations require userId in data',
        })
      }
      return
    }

    // safeParse + addIssue, never .parse(): a throw escapes superRefine and the client reads
    // it as a retryable network failure.
    const schemaFor = {
      incomeSource: incomeSourceSchema,
      expense: expenseSchema,
      savingsGoal: savingsGoalSchema,
      balanceTracking: balanceTrackingSchema,
      userProfile: userProfileSchema,
      category: categorySchema,
      retirementPlan: retirementPlanOperationSchema,
    } satisfies Record<typeof entityType, z.ZodTypeAny>
    const result = schemaFor[entityType].safeParse(entityData)
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: issue.message,
          path: ['data', ...issue.path],
        })
      }
    }
  })

export const batchSyncRequestSchema = z.object({
  operations: z.array(syncOperationSchema),
  clientTimestamp: z.number(),
  deviceId: z.string(),
})

// Exported for a test that pins it against SyncEntityType: a missing entry fails every push silently.
export const entityTableMap = {
  incomeSource: incomeSources,
  expense: expenses,
  savingsGoal: savingsGoals,
  balanceTracking: balanceTracking,
  userProfile: userProfiles,
  category: categories,
  // One row per user, `id` = the user's id, no profileId column.
  retirementPlan: retirementPlans,
} as const

type EntityTableMap = typeof entityTableMap

function getTable<T extends keyof EntityTableMap>(entityType: T) {
  const table = entityTableMap[entityType]
  if (!table) {
    throw new Error(`Unknown entity type: ${entityType}`)
  }
  return table
}

const RATE_LIMIT_CONFIG = {
  maxRequests: 100,
  windowMs: 60 * 1000,
}

// Exported so pull shares push's per-user budget.
export async function checkRateLimit(
  userId: string
): Promise<{ allowed: boolean; remaining: number }> {
  const decision = await checkDbRateLimit({
    scope: 'sync',
    subject: userId,
    // Set so account erasure, which deletes rateLimits by userId, removes these counters.
    userId,
    windowMs: RATE_LIMIT_CONFIG.windowMs,
    maxAttempts: RATE_LIMIT_CONFIG.maxRequests,
    onDbError: (now) => syncInMemoryFallback(userId, now),
  })
  return { allowed: decision.allowed, remaining: decision.remaining }
}

// DB-error fallback for sync only (auth limiters fail closed): per-instance, same window and max.
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

type SyncTx = DbTx

type Executor = typeof db | SyncTx

async function getEntity(
  entityType: keyof EntityTableMap,
  entityId: string,
  userId: string,
  profileId?: string,
  executor: Executor = db
): Promise<Record<string, unknown> | null> {
  try {
    const table = getTable(entityType)
    let whereClause = and(
      eq(table.userId, userId),
      eq(table.id, entityId),
      eq(table.isDeleted, false)
    )

    // `in` narrows the union: userProfiles has no profileId column.
    if (profileId && 'profileId' in table) {
      whereClause = and(whereClause, eq(table.profileId, profileId))
    }

    const result = await executor.select().from(table).where(whereClause).limit(1)

    return result[0] || null
  } catch (error) {
    const sanitizedError = error instanceof Error ? error.message : String(error)
    logger.error('[DB Error] Failed to get entity', { entityType, entityId, error: sanitizedError })
    throw new Error(`Failed to get entity: ${sanitizedError}`)
  }
}

async function entityExists(
  entityType: keyof EntityTableMap,
  entityId: string,
  userId: string,
  profileId?: string,
  executor: Executor = db
): Promise<boolean> {
  try {
    const entity = await getEntity(entityType, entityId, userId, profileId, executor)
    return !!entity
  } catch {
    return false
  }
}

async function profileBelongsToUser(
  profileId: string,
  userId: string,
  executor: Executor = db
): Promise<boolean> {
  const rows = await executor
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

// Pull's userProfile changes are a paginated delta, so absence there does not mean the profile
// is missing on the server; the client needs this full list.
export async function getLiveProfileIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: userProfiles.id })
    .from(userProfiles)
    .where(and(eq(userProfiles.userId, userId), eq(userProfiles.isDeleted, false)))
  return rows.map((row) => row.id)
}

// Filters userId + id, not profileId: a cascade-tombstoned row still names its tombstoned profile.
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

// A tombstone is required: a delete can legitimately arrive before its own create lands.
async function isAlreadyDeleted(operation: SyncOperation): Promise<boolean> {
  return (
    operation.type === 'delete' &&
    (await tombstoneExists(
      operation.entityType as keyof EntityTableMap,
      operation.entityId,
      operation.userId
    ))
  )
}

// Strips identity columns plus isDeleted/createdAt, which the delete path and default repair own.
// updatedAt is bumped: defaultNow() fires only on INSERT, and pull is delta-by-updatedAt.
function updatePayload(data: Record<string, unknown>, userId: string) {
  const {
    id: _id,
    profileId: _profileId,
    userId: _userId,
    isDeleted: _isDeleted,
    createdAt: _createdAt,
    ...fields
  } = data
  return { ...fields, userId, updatedAt: new Date() }
}

async function createEntity(
  entityType: keyof EntityTableMap,
  data: Record<string, unknown> & { userId: string; profileId?: string },
  executor: Executor = db
): Promise<OperationResult> {
  try {
    const table = getTable(entityType)
    const insertData = { ...data, updatedAt: new Date() }
    // A cast, not @ts-expect-error: whether the union errors here depends on its members.
    await executor.insert(table).values(insertData as never)
    return { success: true }
  } catch (error) {
    return failureFromError(error, { entityType, entityId: data['id'], userId: data.userId })
  }
}

// Only a throw rolls a transaction back; a normal return commits.
class RollbackWith extends Error {
  constructor(readonly result: OperationResult) {
    super(result.error ?? 'rolled back')
  }
}

// Lock, liveness check and INSERT in one transaction, so a concurrent cascade cannot leave a live
// orphan. The refusal has no rejection: it stays queued until the next pull drops it.
async function createProfileScopedEntity(
  entityType: keyof EntityTableMap,
  data: Record<string, unknown> & { id: string; userId: string; profileId: string }
): Promise<OperationResult> {
  const { id: entityId, userId, profileId } = data
  try {
    return await db.transaction(async (tx) => {
      await lockUserProfileSet(tx, userId, 'share')
      if (!(await profileBelongsToUser(profileId, userId, tx))) {
        return { success: false, error: 'Profile not found' }
      }
      // getEntity, not entityExists: the latter swallows a failed SELECT that has already aborted the transaction.
      if (await getEntity(entityType, entityId, userId, profileId, tx)) {
        return { success: false, error: 'Entity already exists' }
      }
      const result = await createEntity(entityType, data, tx)
      if (!result.success) {
        throw new RollbackWith(result)
      }
      return result
    })
  } catch (error) {
    if (error instanceof RollbackWith) {
      return error.result
    }
    return failureFromError(error, { entityType, entityId, userId })
  }
}

// isDefault on create while a default exists inserts as non-default: such creates come from
// stale snapshots, never an explicit promotion.
async function createUserProfile(
  data: Record<string, unknown> & { id: string; userId: string }
): Promise<OperationResult> {
  const { id: entityId, userId } = data
  try {
    return await db.transaction(async (tx) => {
      await lockUserProfileSet(tx, userId, 'no key update')
      if (await getEntity('userProfile', entityId, userId, undefined, tx)) {
        return { success: false, error: 'Entity already exists' }
      }
      let isDefault = data['isDefault']
      if (isDefault === true) {
        const seatHolder = await tx
          .select({ id: userProfiles.id })
          .from(userProfiles)
          .where(
            and(
              eq(userProfiles.userId, userId),
              eq(userProfiles.isDefault, true),
              eq(userProfiles.isDeleted, false)
            )
          )
          .limit(1)
        if (seatHolder.length > 0) {
          isDefault = false
          logger.info('[Sync] profile create inserted non-default: default seat taken', {
            entityType: 'userProfile',
            entityId,
            userId,
          })
        }
      }
      const result = await createEntity('userProfile', { ...data, isDefault }, tx)
      if (!result.success) {
        throw new RollbackWith(result)
      }
      return result
    })
  } catch (error) {
    if (error instanceof RollbackWith) {
      return error.result
    }
    return failureFromError(error, { entityType: 'userProfile', entityId, userId })
  }
}

// Refused permanently: the op's own shape is wrong (plan id must equal the user id; plans have no delete).
function retirementPlanRefusal(operation: SyncOperation): OperationResult | null {
  if (operation.entityId !== operation.userId) {
    return {
      success: false,
      error: 'A retirement plan is stored under its own account id',
      rejection: 'invalid',
    }
  }
  if (operation.type === 'delete') {
    return { success: false, error: 'A retirement plan cannot be deleted', rejection: 'invalid' }
  }
  return null
}

// create = insert-if-absent, update = upsert, so nothing gets stuck as a conflict. Values are built
// here, never spread from op data. Logs nothing: the plan is personal data.
async function writeRetirementPlan(operation: SyncOperation): Promise<OperationResult> {
  const refusal = retirementPlanRefusal(operation)
  if (refusal) {
    return refusal
  }
  const parsed = retirementPlanSyncSchema.safeParse(operation.data['plan'])
  if (!parsed.success) {
    return { success: false, error: 'Invalid retirement plan', rejection: 'invalid' }
  }
  const userId = operation.userId
  const updatedAt = new Date()
  try {
    const insert = db
      .insert(retirementPlans)
      .values({ id: userId, userId, plan: parsed.data, updatedAt })
    if (operation.type === 'create') {
      await insert.onConflictDoNothing({ target: retirementPlans.id })
    } else {
      await insert.onConflictDoUpdate({
        target: retirementPlans.id,
        set: { plan: parsed.data, updatedAt },
      })
    }
    return { success: true }
  } catch (error) {
    return failureFromError(error, {
      entityType: 'retirementPlan',
      entityId: operation.entityId,
      userId,
    })
  }
}

async function updateEntity(
  entityType: keyof EntityTableMap,
  entityId: string,
  data: Record<string, unknown>,
  userId: string,
  profileId?: string
): Promise<OperationResult> {
  try {
    const table = getTable(entityType)
    let whereClause = and(eq(table.userId, userId), eq(table.id, entityId))

    // `in` narrows the union: userProfiles has no profileId column.
    if (profileId && 'profileId' in table) {
      whereClause = and(whereClause, eq(table.profileId, profileId))
    }

    await db.update(table).set(updatePayload(data, userId)).where(whereClause)
    return { success: true }
  } catch (error) {
    return failureFromError(error, { entityType, entityId, userId })
  }
}

// Demotes and promotes in one transaction under the user lock: the last promotion wins.
// The target must still be live, or the throw rolls the demotion back.
async function promoteProfile(
  profileId: string,
  data: Record<string, unknown>,
  userId: string
): Promise<OperationResult> {
  try {
    await db.transaction(async (tx) => {
      await lockUserProfileSet(tx, userId, 'no key update')
      // No `id <> profileId` exclusion: re-promoting the current holder is the same end state.
      await tx
        .update(userProfiles)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(
          and(
            eq(userProfiles.userId, userId),
            eq(userProfiles.isDefault, true),
            eq(userProfiles.isDeleted, false)
          )
        )
      const promoted = await tx
        .update(userProfiles)
        .set(updatePayload(data, userId))
        .where(
          and(
            eq(userProfiles.userId, userId),
            eq(userProfiles.id, profileId),
            eq(userProfiles.isDeleted, false)
          )
        )
        .returning({ id: userProfiles.id })
      if (promoted.length === 0) {
        throw new Error('Promotion target is no longer a live profile')
      }
    })
    return { success: true }
  } catch (error) {
    return failureFromError(error, { entityType: 'userProfile', entityId: profileId, userId })
  }
}

// Oldest live profile, tiebroken by id: createdAt alone is not a total order.
async function ensureUserHasDefaultProfile(userId: string): Promise<void> {
  // One transaction behind the user lock, so the repair cannot lose the seat to a concurrent
  // promotion and throw 23505 after the batch committed.
  await db.transaction(async (tx) => {
    await lockUserProfileSet(tx, userId, 'no key update')

    const live = await tx
      .select({ id: userProfiles.id, createdAt: userProfiles.createdAt })
      .from(userProfiles)
      .where(and(eq(userProfiles.userId, userId), eq(userProfiles.isDeleted, false)))

    if (live.length === 0) return

    const hasDefault = await tx
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

    await tx
      .update(userProfiles)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(and(eq(userProfiles.id, successor.id), eq(userProfiles.userId, userId)))
  })
}

// Unlocked precheck: running the locked repair on every batch would serialize every child create.
async function accountLacksLiveDefault(userId: string): Promise<boolean> {
  const live = await db
    .select({ isDefault: userProfiles.isDefault })
    .from(userProfiles)
    .where(and(eq(userProfiles.userId, userId), eq(userProfiles.isDeleted, false)))
  return live.length > 0 && !live.some((profile) => profile.isDefault)
}

// forecastingProfiles has no isDeleted column, so it is hard-deleted separately.
const PROFILE_CHILD_TABLES = [
  incomeSources,
  expenses,
  categories,
  savingsGoals,
  balanceTracking,
] as const

type ProfileDeleteOutcome =
  | { kind: 'deleted' }
  | { kind: 'already-deleted' }
  | { kind: 'last-profile' }
  | { kind: 'failed'; result: OperationResult }

// Tombstones the profile's rows (a hard delete is invisible to delta pulls). The last-profile
// count runs inside, after the user lock, so two concurrent deletes cannot leave zero profiles.
async function deleteProfileWithChildren(
  profileId: string,
  userId: string
): Promise<ProfileDeleteOutcome> {
  try {
    return await db.transaction(async (tx): Promise<ProfileDeleteOutcome> => {
      await lockUserProfileSet(tx, userId, 'no key update')

      // Both reads run after the lock, so each sees deletes that committed while this waited.
      if (!(await profileBelongsToUser(profileId, userId, tx))) {
        return { kind: 'already-deleted' }
      }
      const live = await tx
        .select({ id: userProfiles.id })
        .from(userProfiles)
        .where(and(eq(userProfiles.userId, userId), eq(userProfiles.isDeleted, false)))
      if (live.length <= 1) {
        return { kind: 'last-profile' }
      }

      const now = new Date()
      for (const table of PROFILE_CHILD_TABLES) {
        await tx
          .update(table)
          .set({ isDeleted: true, updatedAt: now })
          .where(and(eq(table.userId, userId), eq(table.profileId, profileId)))
      }

      // Hard delete: this table has no isDeleted column.
      await tx
        .delete(forecastingProfiles)
        .where(
          and(eq(forecastingProfiles.userId, userId), eq(forecastingProfiles.profileId, profileId))
        )

      await tx
        .update(userProfiles)
        .set({ isDeleted: true, updatedAt: now })
        .where(and(eq(userProfiles.userId, userId), eq(userProfiles.id, profileId)))
      return { kind: 'deleted' }
    })
  } catch (error) {
    // Driver detail goes to the log, never the envelope.
    logger.error('Profile cascade failed', {
      userId,
      profileId,
      sqlState: sqlStateOf(error),
      constraint: constraintOf(error),
      error,
    })
    // Never permanent: the cascade writes only isDeleted/updatedAt, so the op's data cannot cause a failure.
    return { kind: 'failed', result: { success: false, error: 'Failed to delete profile' } }
  }
}

// Soft delete: a hard DELETE would be invisible to delta-by-updatedAt pulls.
async function deleteEntity(
  entityType: keyof EntityTableMap,
  entityId: string,
  userId: string,
  profileId?: string
): Promise<OperationResult> {
  try {
    const table = getTable(entityType)
    let whereClause = and(eq(table.userId, userId), eq(table.id, entityId))

    // `in` narrows the union: userProfiles has no profileId column.
    if (profileId && 'profileId' in table) {
      whereClause = and(whereClause, eq(table.profileId, profileId))
    }

    await db.update(table).set({ isDeleted: true, updatedAt: new Date() }).where(whereClause)
    return { success: true }
  } catch (error) {
    // Never permanent: a soft delete's own data cannot violate a CHECK.
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function applyOperation(operation: SyncOperation): Promise<OperationResult> {
  const entityType = operation.entityType as keyof EntityTableMap
  const entityId = operation.entityId
  const userId = operation.userId
  const profileId = operation.profileId

  // Unreachable past the request schema, but permanent so it can never become a replay loop.
  if (!userId) {
    return { success: false, error: 'User ID is required', rejection: 'invalid' }
  }

  try {
    // The plan has its own write path: no tombstones, no delete op, no profile.
    if (entityType === 'retirementPlan') {
      return writeRetirementPlan(operation)
    }

    // A create for an id this user already deleted is a stale replay: acknowledge it, deletion wins.
    if (operation.type === 'create' && (await tombstoneExists(entityType, entityId, userId))) {
      return { success: true }
    }

    // Before the profile check: a cascade-tombstoned row names a tombstoned profile, which would
    // answer `Profile not found` and stay queued forever.
    if (await isAlreadyDeleted(operation)) {
      return { success: true }
    }

    // The FK alone only proves the profile exists, for someone.
    if ('profileId' in getTable(entityType)) {
      // Permanent: the op's own shape is wrong.
      if (!profileId) {
        return {
          success: false,
          error: 'profileId is required for this entity type',
          rejection: 'invalid',
        }
      }
      // Not permanent: the profile's own create may still be queued. Creates re-check inside their transaction.
      if (operation.type !== 'create' && !(await profileBelongsToUser(profileId, userId))) {
        return { success: false, error: 'Profile not found' }
      }
    }

    switch (operation.type) {
      case 'create': {
        // `id: entityId` keeps the client's uuid so later updates and deletes match the row.
        const { id: _id, isDeleted: _isDeleted, createdAt: _createdAt, ...fields } = operation.data
        if (profileId && 'profileId' in getTable(entityType)) {
          return createProfileScopedEntity(entityType, {
            ...fields,
            id: entityId,
            userId,
            profileId,
          })
        }
        if (entityType === 'userProfile') {
          return createUserProfile({ ...fields, id: entityId, userId })
        }
        const exists = await entityExists(entityType, entityId, userId, profileId)
        if (exists) {
          return { success: false, error: 'Entity already exists' }
        }
        return createEntity(entityType, { ...fields, id: entityId, userId, profileId })
      }

      case 'update': {
        const entityExistsForUpdate = await entityExists(entityType, entityId, userId, profileId)
        if (!entityExistsForUpdate) {
          return { success: false, error: 'Entity not found' }
        }
        // `=== true` only: false or absent keeps the plain update; the post-batch repair handles stale demotions.
        if (entityType === 'userProfile' && operation.data['isDefault'] === true) {
          return promoteProfile(entityId, operation.data, userId)
        }
        return updateEntity(entityType, entityId, operation.data, userId, profileId)
      }

      case 'delete': {
        const entityExistsForDelete = await entityExists(entityType, entityId, userId, profileId)
        if (!entityExistsForDelete) {
          return { success: false, error: 'Entity not found' }
        }

        if (entityType === 'userProfile') {
          // Last-profile rule: zero live profiles has no repair, so this refuses rather than repairs.
          // Not deleteEntity: the children must go in the same transaction.
          const outcome = await deleteProfileWithChildren(entityId, userId)
          if (outcome.kind === 'failed') {
            return outcome.result
          }
          if (outcome.kind === 'last-profile') {
            // Acknowledged, not failed: a failure in a 200 envelope stays queued forever and trips the
            // circuit breaker. The next pull corrects the out-of-step client.
            logger.warn('Refused a delete that would leave the user with no profile', {
              userId,
              entityId,
            })
          }
          return { success: true }
        }

        return deleteEntity(entityType, entityId, userId, profileId)
      }
    }
  } catch (error) {
    return failureFromError(error, { entityType, entityId, userId })
  }
}

// getEntity, not entityExists: a swallowed SELECT error would become a conflict, which never dequeues.
async function checkConflict(operation: SyncOperation): Promise<{
  hasConflict: boolean
  conflictType?: string
  serverData?: Record<string, unknown>
  alreadyApplied?: boolean
  failure?: OperationResult
}> {
  const entityType = operation.entityType as keyof EntityTableMap
  const entityId = operation.entityId
  const userId = operation.userId
  const profileId = operation.profileId

  if (!userId) {
    return { hasConflict: false }
  }

  try {
    // A plan op that can never land is a permanent failure, never a conflict; an update is an upsert.
    if (entityType === 'retirementPlan') {
      const refusal = retirementPlanRefusal(operation)
      if (refusal) {
        return { hasConflict: false, failure: refusal }
      }
      if (operation.type === 'update') {
        return { hasConflict: false }
      }
    }

    switch (operation.type) {
      case 'create': {
        const serverData = await getEntity(entityType, entityId, userId, profileId)
        if (serverData) {
          return { hasConflict: true, conflictType: 'create-create', serverData }
        }
        break
      }

      case 'update': {
        const existsForUpdate = await getEntity(entityType, entityId, userId, profileId)
        if (!existsForUpdate) {
          return { hasConflict: true, conflictType: 'update-delete', serverData: undefined }
        }
        break
      }

      case 'delete': {
        const existsForDelete = await getEntity(entityType, entityId, userId, profileId)
        if (!existsForDelete) {
          // Already tombstoned for this user (a lost response or another device). A conflict would never drain.
          if (await isAlreadyDeleted(operation)) {
            return { hasConflict: false, alreadyApplied: true }
          }
          return { hasConflict: true, conflictType: 'delete-update', serverData: undefined }
        }
        break
      }
    }

    return { hasConflict: false }
  } catch (error) {
    // A failure, not a conflict: core never escalates a conflict to the user, but escalates a failure.
    const sanitizedError = error instanceof Error ? error.message : String(error)
    logger.error('[Conflict Check Error]', { error: sanitizedError })
    return {
      hasConflict: false,
      failure: failureFromError(error, { entityType, entityId, userId }),
    }
  }
}

// `user.id` must be the uuid: the session calls it `userId`, and an unmapped id makes the
// ownership check compare against undefined.
export async function processBatchSync(
  request: BatchSyncRequest,
  user: Pick<User, 'id' | 'subscriptionStatus'>
): Promise<BatchSyncResponse> {
  // Permanent (400) only because the client sends one op per request; batching would require
  // per-operation refusals.
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
      refusal: 'invalid-request',
    }
  }

  const { operations } = validationResult.data

  // hasPaidAccess, not hasPremiumFeatures: past_due keeps sync during dunning.
  if (!hasPaidAccess(user.subscriptionStatus)) {
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
      refusal: 'tier',
    }
  }

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
        // Not permanent (401, kept queued): it may be another account's pending edit pushed under the
        // cookie of a sign-in in another tab.
        refusal: 'ownership',
      }
    }
  }

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
      refusal: 'rate-limit',
    }
  }

  let processedCount = 0
  let failedCount = 0
  let conflictCount = 0
  const conflicts: SyncConflict[] = []
  const failedOperationIds: string[] = []
  const rejections: SyncRejection[] = []

  const recordFailure = (operation: SyncOperation, result: OperationResult) => {
    failedCount++
    failedOperationIds.push(operation.id)
    // Also counted as failed, so clients that ignore `rejections` see the same envelope.
    if (result.rejection) {
      rejections.push({ operationId: operation.id, reason: result.rejection })
    }
  }

  for (const operation of operations) {
    const conflictCheck = await checkConflict(operation)

    if (conflictCheck.failure) {
      recordFailure(operation, conflictCheck.failure)
      continue
    }

    // Ids are client-generated, so a create the server already holds was already applied (lost
    // response). Reported as a conflict it would stay queued forever.
    if (conflictCheck.hasConflict && conflictCheck.conflictType === 'create-create') {
      processedCount++
      continue
    }

    // An explicit field, so rewording a conflictType cannot change it.
    if (conflictCheck.alreadyApplied) {
      processedCount++
      continue
    }

    if (conflictCheck.hasConflict) {
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

    const result = await applyOperation(operation)

    if (result.success) {
      processedCount++
    } else {
      recordFailure(operation, result)
    }
  }

  // Repair, not veto: no batch may end with live profiles but no default. Errors are logged,
  // not thrown: the ops have already committed.
  try {
    if (
      operations.some((operation) => operation.entityType === 'userProfile') ||
      (await accountLacksLiveDefault(user.id))
    ) {
      await ensureUserHasDefaultProfile(user.id)
    }
  } catch (error) {
    logger.error('[Default Repair Error]', {
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  const endTime = Date.now()

  let status: SyncStatus = SyncStatusEnum.COMPLETED
  if (failedCount > 0) {
    status = SyncStatusEnum.FAILED
  } else if (conflictCount > 0) {
    status = SyncStatusEnum.PARTIAL
  }

  return {
    success: failedCount === 0,
    processedCount,
    failedCount,
    conflictCount,
    conflicts,
    failedOperationIds,
    rejections,
    serverTimestamp: endTime,
    status,
  }
}

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

// Server-side cap regardless of the client's limit (DoS guard).
const MAX_PULL_LIMIT = 500

// Never split a same-updatedAt run across pages: the next pull's strict `> cursor` would skip the
// overflow forever. If the whole page is one timestamp, include the full group.
export function capChangesAtTimestampBoundary(sorted: ServerChange[], cap: number): ServerChange[] {
  if (sorted.length <= cap) {
    return sorted
  }
  const boundaryRow = sorted[cap]
  if (!boundaryRow) {
    return sorted
  }
  const boundaryTs = boundaryRow.updatedAt
  let end = cap
  while (end > 0 && sorted[end - 1]?.updatedAt === boundaryTs) {
    end--
  }
  if (end === 0) {
    let i = cap
    while (i < sorted.length && sorted[i]?.updatedAt === boundaryTs) {
      i++
    }
    return sorted.slice(0, i)
  }
  return sorted.slice(0, end)
}

// A DoS guard, not an expected ceiling.
const MAX_BOUNDARY_GROUP_SIZE = 5000

interface SafeTablePage {
  changes: ServerChange[]
  // Highest updatedAt this table is fully fetched through; Infinity when drained.
  safeWatermark: number
}

// Over-fetches one row to detect an open boundary group and fetches it whole if it fills the
// window. safeWatermark feeds the global cursor (the minimum across tables).
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
    return { changes: rows.map(toChange), safeWatermark: Number.POSITIVE_INFINITY }
  }

  const boundaryRow = rows[cappedLimit]
  if (!boundaryRow) {
    return { changes: rows.map(toChange), safeWatermark: Number.POSITIVE_INFINITY }
  }
  const boundaryTs = boundaryRow.updatedAt
  const boundaryMs = boundaryTs.getTime()

  const belowBoundary = rows.filter((row) => row.updatedAt.getTime() < boundaryMs)
  if (belowBoundary.length > 0) {
    // Defer the whole boundary group rather than return it incomplete.
    const lastSafeRow = belowBoundary[belowBoundary.length - 1]
    const safeWatermark = lastSafeRow ? lastSafeRow.updatedAt.getTime() : Number.NEGATIVE_INFINITY
    return { changes: belowBoundary.map(toChange), safeWatermark }
  }

  const fullGroup = await fetchExactTimestamp(boundaryTs)
  if (fullGroup.length >= MAX_BOUNDARY_GROUP_SIZE) {
    // Defer rather than trust a possibly incomplete group: no progress, but no silent loss.
    logger.error('[getSyncChanges] boundary group exceeds safety cap, deferring', {
      entityType,
      boundaryTs: boundaryTs.toISOString(),
      size: fullGroup.length,
    })
    return { changes: [], safeWatermark: Number.NEGATIVE_INFINITY }
  }
  return { changes: fullGroup.map(toChange), safeWatermark: boundaryMs }
}

// Callers must pass the session user id: `userId` is trusted as already authorized.
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

  // Profile-scoped tables only with a known profile: falling back to all profiles would mix
  // other profiles' rows into the active stores.
  if (profileId !== undefined) {
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

    // Hand-written per-entity blocks: a new entity reaches no other device unless a block is added.
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

  // User-scoped like profiles, so pulled whatever the active profile.
  const plans = await fetchTableChangesSafely(
    'retirementPlan',
    (pageLimit) =>
      db
        .select()
        .from(retirementPlans)
        .where(
          and(
            eq(retirementPlans.userId, userId),
            sinceDate ? gt(retirementPlans.updatedAt, sinceDate) : undefined
          )
        )
        .orderBy(asc(retirementPlans.updatedAt))
        .limit(pageLimit),
    (timestamp) =>
      db
        .select()
        .from(retirementPlans)
        .where(and(eq(retirementPlans.userId, userId), eq(retirementPlans.updatedAt, timestamp)))
        .limit(MAX_BOUNDARY_GROUP_SIZE),
    cappedLimit
  )
  changes.push(...plans.changes)
  watermarks.push(plans.safeWatermark)

  // Minimum watermark across tables: advancing past a table's unread rows would skip them forever.
  // Re-delivering already-safe rows is harmless (applying a change is idempotent).
  const safeCursor = Math.min(...watermarks)
  const safeChanges =
    safeCursor === Number.POSITIVE_INFINITY
      ? changes
      : changes.filter((c) => c.updatedAt <= safeCursor)

  // This second pass bounds the total response size across all tables.
  safeChanges.sort((a, b) => a.updatedAt - b.updatedAt || a.entityId.localeCompare(b.entityId))
  return capChangesAtTimestampBoundary(safeChanges, cappedLimit)
}
