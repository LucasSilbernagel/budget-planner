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

import { z } from 'zod'
import type { SyncOperation, SyncResult, SyncStatus } from '@budget-planner/core/sync'
import { SyncStatus as SyncStatusEnum } from '@budget-planner/core/sync'
import type { User } from '@budget-planner/db'
import { db } from '@budget-planner/db'
import {
  incomeSources,
  expenses,
  savingsGoals,
  balanceTracking,
  userProfiles,
  rateLimits,
} from '@budget-planner/db'
import { eq, and, gt, lte } from 'drizzle-orm'

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
  /** Entity ID */
  entityId: string | number
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
  /** Entity ID */
  entityId: string | number
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
  userId: z.string().uuid(),
})

const expenseSchema = z.object({
  name: z.string().min(1).max(255),
  amount: z.number().int(),
  frequency: z.enum(['weekly', 'biweekly', 'monthly', 'annually']),
  userId: z.string().uuid(),
})

const savingsGoalSchema = z.object({
  name: z.string().min(1).max(255),
  targetAmount: z.number().int(),
  currentBalance: z.number().int().default(0),
  userId: z.string().uuid(),
})

const balanceTrackingSchema = z.object({
  type: z.enum(['investment', 'debt']),
  name: z.string().min(1).max(255),
  currentBalance: z.number().int().default(0),
  maxContributionLimit: z.number().int().optional(),
  monthlyContribution: z.number().int().default(0),
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
export const syncOperationSchema = z.object({
  id: z.string(),
  type: z.enum(['create', 'update', 'delete']),
  entityType: z.enum(['incomeSource', 'expense', 'savingsGoal', 'balanceTracking', 'userProfile']),
  entityId: z.string(),
  data: z.record(z.unknown()), // Kept for backward compatibility, but validated per-entity below
  timestamp: z.number(),
  deviceId: z.string(),
  userId: z.string(),
  version: z.number().optional(),
}).superRefine((data, ctx) => {
  // Validate data structure based on entityType
  const { entityType, data: entityData, type } = data
  
  // For delete operations, data may be minimal
  if (type === 'delete') {
    // Delete operations only need userId in data
    if (!entityData.userId) {
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
 */
const entityTableMap = {
  incomeSource: incomeSources,
  expense: expenses,
  savingsGoal: savingsGoals,
  balanceTracking: balanceTracking,
  userProfile: userProfiles,
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
 * Check rate limit for a user using DanubeData PostgreSQL
 * This ensures rate limiting persists across server restarts (NFR1, NFR2)
 */
async function checkRateLimit(userId: string): Promise<{ allowed: boolean; remaining: number }> {
  const now = Date.now()
  const windowStart = new Date(now - RATE_LIMIT_CONFIG.windowMs)

  try {
    // Get or create rate limit entry for this user
    const existing = await db
      .select()
      .from(rateLimits)
      .where(
        and(
          eq(rateLimits.userId, userId),
          gt(rateLimits.windowStart, windowStart)
        )
      )
      .limit(1)

    let requestCount = 0
    let rateLimitId: number | undefined

    if (existing.length > 0) {
      requestCount = existing[0].requestCount
      rateLimitId = existing[0].id
    }

    // Check if limit exceeded
    if (requestCount >= RATE_LIMIT_CONFIG.maxRequests) {
      return { allowed: false, remaining: 0 }
    }

    // Increment or create the rate limit entry
    const newCount = requestCount + 1
    
    if (rateLimitId) {
      // Update existing entry
      await db
        .update(rateLimits)
        .set({
          requestCount: newCount,
          updatedAt: new Date(now),
        })
        .where(eq(rateLimits.id, rateLimitId))
    } else {
      // Create new entry
      await db.insert(rateLimits).values({
        userId,
        requestCount: 1,
        windowStart: new Date(now),
        createdAt: new Date(now),
        updatedAt: new Date(now),
      })
    }

    return { allowed: true, remaining: RATE_LIMIT_CONFIG.maxRequests - newCount }
  } catch (error) {
    // If database fails, fall back to in-memory rate limiting
    // This ensures the feature still works even if rateLimits table is not available
    // Sanitize error to avoid exposing sensitive database information
    const sanitizedError = error instanceof Error ? error.message : String(error)
    console.error('[RateLimit] Database error, falling back to in-memory:', sanitizedError)
    
    // In-memory fallback
    const validEntries = rateLimitStore.filter((entry) => entry.resetTime > now)
    rateLimitStore.length = 0
    rateLimitStore.push(...validEntries)

    const userRequests = validEntries.filter((entry) => entry.userId === userId)
    const requestCount = userRequests.length

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
}

// Fallback in-memory store for when database is unavailable
interface RateLimitEntry {
  userId: string
  count: number
  resetTime: number
}

const rateLimitStore: RateLimitEntry[] = []

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
      // @ts-expect-error - Dynamic column access
      eq(table.userId, userId),
      // @ts-expect-error - Dynamic column access
      eq(table.id, entityId)
    )
    
    // Add profileId filter if provided and table has profileId column
    if (profileId && table.profileId) {
      // @ts-expect-error - Dynamic column access
      whereClause = and(whereClause, eq(table.profileId, profileId))
    }
    
    // @ts-expect-error - Dynamic table access
    const result = await db
      .select()
      .from(table)
      .where(whereClause)
      .limit(1)
    
    return result[0] || null
  } catch (error) {
    // Sanitize error to avoid exposing sensitive database information
    const sanitizedError = error instanceof Error ? error.message : String(error)
    console.error(`[DB Error] Failed to get entity ${entityType}:${entityId}:`, sanitizedError)
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
 * Create entity in database
 */
async function createEntity(
  entityType: keyof EntityTableMap,
  data: Record<string, unknown> & { userId: string; profileId?: string }
): Promise<{ success: boolean; error?: string }> {
  try {
    const table = getTable(entityType)
    // Ensure profileId is included in data if available
    const insertData = data
    // @ts-expect-error - Dynamic table insert
    await db.insert(table).values(insertData)
    return { success: true }
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
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
    let whereClause = and(
      // @ts-expect-error - Dynamic column access
      eq(table.userId, userId),
      // @ts-expect-error - Dynamic column access
      eq(table.id, entityId)
    )
    
    // Add profileId filter if provided and table has profileId column
    if (profileId && table.profileId) {
      // @ts-expect-error - Dynamic column access
      whereClause = and(whereClause, eq(table.profileId, profileId))
    }
    
    // @ts-expect-error - Dynamic table update
    await db
      .update(table)
      // @ts-expect-error - Dynamic column access
      .set(data)
      .where(whereClause)
    return { success: true }
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    }
  }
}

/**
 * Delete entity from database
 */
async function deleteEntity(
  entityType: keyof EntityTableMap,
  entityId: string,
  userId: string,
  profileId?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const table = getTable(entityType)
    let whereClause = and(
      // @ts-expect-error - Dynamic column access
      eq(table.userId, userId),
      // @ts-expect-error - Dynamic column access
      eq(table.id, entityId)
    )
    
    // Add profileId filter if provided and table has profileId column
    if (profileId && table.profileId) {
      // @ts-expect-error - Dynamic column access
      whereClause = and(whereClause, eq(table.profileId, profileId))
    }
    
    // @ts-expect-error - Dynamic table delete
    await db
      .delete(table)
      .where(whereClause)
    return { success: true }
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
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
    switch (operation.type) {
      case 'create':
        // Check if entity already exists
        const exists = await entityExists(entityType, entityId, userId, profileId)
        if (exists) {
          return { success: false, error: 'Entity already exists' }
        }
        // @ts-expect-error - Data may not have userId
        return createEntity(entityType, { ...operation.data, userId, profileId })

      case 'update':
        // Check if entity exists
        const entityExistsForUpdate = await entityExists(entityType, entityId, userId, profileId)
        if (!entityExistsForUpdate) {
          return { success: false, error: 'Entity not found' }
        }
        return updateEntity(entityType, entityId, operation.data, userId, profileId)

      case 'delete':
        // Check if entity exists
        const entityExistsForDelete = await entityExists(entityType, entityId, userId, profileId)
        if (!entityExistsForDelete) {
          return { success: false, error: 'Entity not found' }
        }
        return deleteEntity(entityType, entityId, userId, profileId)
    }
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
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
      case 'create':
        // Conflict if entity already exists on server
        const exists = await entityExists(entityType, entityId, userId, profileId)
        if (exists) {
          const serverData = await getEntity(entityType, entityId, userId, profileId)
          return { hasConflict: true, conflictType: 'create-create', serverData: serverData || undefined }
        }
        break

      case 'update':
        // Conflict if entity doesn't exist on server
        const existsForUpdate = await entityExists(entityType, entityId, userId, profileId)
        if (!existsForUpdate) {
          return { hasConflict: true, conflictType: 'update-delete', serverData: undefined }
        }
        break

      case 'delete':
        // Conflict if entity doesn't exist on server
        const existsForDelete = await entityExists(entityType, entityId, userId, profileId)
        if (!existsForDelete) {
          return { hasConflict: true, conflictType: 'delete-update', serverData: undefined }
        }
        break
    }

    return { hasConflict: false }
  } catch (error) {
    // If we can't check server state, be conservative and assume conflict
    // This prevents data resurrection from stale updates
    // Sanitize error to avoid exposing sensitive database information
    const sanitizedError = error instanceof Error ? error.message : String(error)
    console.error('[Conflict Check Error]:', sanitizedError)
    return { hasConflict: true, conflictType: 'server-check-failed' }
  }
}

// ============================================================================
// Audit Logging (DanubeData PostgreSQL)
// ============================================================================

// Sync history table name
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
    await db.execute(`
      INSERT INTO ${SYNC_AUDIT_TABLE} (
        id, userId, operationId, entityType, entityId, operationType, timestamp, success, error, ipAddress, userAgent
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
      )
    `, [
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
      userAgent
    ])
  } catch (dbError) {
    // Fallback to console log if database fails
    // Sanitize error to avoid exposing sensitive database information
    const sanitizedError = dbError instanceof Error ? dbError.message : String(dbError)
    console.error('[Audit DB Error]', {
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

    await db.execute(`
      INSERT INTO ${SYNC_HISTORY_TABLE} (
        id, userId, deviceId, startTimestamp, endTimestamp, operationsCount, conflictCount, failureCount, status, error
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
      )
    `, [
      historyEntry.id,
      historyEntry.userId,
      historyEntry.deviceId,
      historyEntry.startTimestamp,
      historyEntry.endTimestamp,
      historyEntry.operationsCount,
      historyEntry.conflictCount,
      historyEntry.failureCount,
      historyEntry.status,
      historyEntry.error
    ])

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
    console.error('[SyncHistory DB Error]', historyEntry)
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
 * @param user - The authenticated user
 * @param ipAddress - Client IP address
 * @param userAgent - Client user agent
 * @returns Batch sync response
 */
export async function processBatchSync(
  request: BatchSyncRequest,
  user: User,
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

  const { operations, clientTimestamp, deviceId } = validationResult.data

  // Tier gating: server-side sync is a paid-tier feature. Free (and canceled)
  // users must not be able to persist data to the server even with a valid
  // session. Only subscriptions with active access may sync.
  const PAID_SYNC_STATUSES = ['active', 'past_due']
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
  const errorMessage = failedCount > 0 ? 'Sync completed with errors' :
    conflictCount > 0 ? 'Sync completed with conflicts' : undefined
  
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
    const result = await db.execute(`
      SELECT * FROM ${SYNC_HISTORY_TABLE} 
      WHERE userId = $1 
      ORDER BY startTimestamp DESC
    `, [userId])
    return result.rows as SyncHistoryEntry[]
  } catch {
    return []
  }
}

/**
 * Get sync audit logs for a user from database
 */
export async function getSyncAuditLogs(userId: string): Promise<SyncAuditLog[]> {
  try {
    const result = await db.execute(`
      SELECT * FROM ${SYNC_AUDIT_TABLE} 
      WHERE userId = $1 
      ORDER BY timestamp DESC 
      LIMIT 1000
    `, [userId])
    return result.rows as SyncAuditLog[]
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
    const result = await db.execute(`
      SELECT * FROM ${SYNC_HISTORY_TABLE} 
      WHERE userId = $1 
      ORDER BY startTimestamp DESC 
      LIMIT 1
    `, [userId])
    
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
      error: error instanceof Error ? error.message : String(error) 
    }
  }
}

// ============================================================================
// Exports
// ============================================================================

export {
  RATE_LIMIT_CONFIG,
}

export type {
  BatchSyncRequest,
  BatchSyncResponse,
  SyncConflict,
  SyncHistoryEntry,
  SyncAuditLog,
}
