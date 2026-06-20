/**
 * Sync API Endpoints
 * 
 * Server API endpoints for handling synchronization operations.
 * Implements batch processing, conflict detection, and sync history tracking.
 * 
 * Features:
 * - Batch sync operations
 * - Conflict detection and resolution
 * - Sync history tracking
 * - Authentication validation
 * - Rate limiting
 * - Audit logging
 */

import { z } from 'zod'
import type { SyncOperation, SyncResult, SyncStatus } from '@budget-planner/core/sync'
import { SyncStatus as SyncStatusEnum } from '@budget-planner/core/sync'
import type { User } from '@budget-planner/db'

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
 * Sync history entry
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
 * Audit log entry for sync operations
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
 * Zod schema for sync operation validation
 */
export const syncOperationSchema = z.object({
  id: z.string(),
  type: z.enum(['create', 'update', 'delete']),
  entityType: z.enum(['incomeSource', 'expense', 'savingsGoal', 'balanceTracking', 'userProfile']),
  entityId: z.union([z.string(), z.number()]),
  data: z.record(z.unknown()),
  timestamp: z.number(),
  deviceId: z.string(),
  userId: z.string(),
  version: z.number().optional(),
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
// In-memory storage (would be replaced with database in production)
// ============================================================================

/**
 * In-memory storage for user data (simulating database)
 * In production, this would be replaced with actual database queries
 */
const userDataStore: Map<string, Map<string, Record<string, unknown>>> = new Map()

/**
 * In-memory storage for sync history
 */
const syncHistoryStore: SyncHistoryEntry[] = []

/**
 * In-memory storage for audit logs
 */
const auditLogStore: SyncAuditLog[] = []

/**
 * Rate limiting storage
 */
interface RateLimitEntry {
  userId: string
  count: number
  resetTime: number
}

const rateLimitStore: RateLimitEntry[] = []

// ============================================================================
// Rate Limiting Configuration
// ============================================================================

const RATE_LIMIT_CONFIG = {
  maxRequests: 100, // Max requests per window
  windowMs: 60 * 1000, // 1 minute window
}

/**
 * Check rate limit for a user
 */
function checkRateLimit(userId: string): { allowed: boolean; remaining: number } {
  const now = Date.now()
  
  // Remove expired entries
  const validEntries = rateLimitStore.filter((entry) => entry.resetTime > now)
  rateLimitStore.length = 0
  rateLimitStore.push(...validEntries)
  
  // Count requests for this user
  const userRequests = validEntries.filter((entry) => entry.userId === userId)
  const requestCount = userRequests.length
  
  if (requestCount >= RATE_LIMIT_CONFIG.maxRequests) {
    return { allowed: false, remaining: 0 }
  }
  
  // Add new entry
  rateLimitStore.push({
    userId,
    count: requestCount + 1,
    resetTime: now + RATE_LIMIT_CONFIG.windowMs,
  })
  
  return { allowed: true, remaining: RATE_LIMIT_CONFIG.maxRequests - requestCount - 1 }
}

// ============================================================================
// Database Operations (Mock)
// ============================================================================

/**
 * Get user data store for a specific user
 */
function getUserStore(userId: string): Map<string, Record<string, unknown>> {
  if (!userDataStore.has(userId)) {
    userDataStore.set(userId, new Map())
  }
  return userDataStore.get(userId)!
}

/**
 * Apply an operation to the database
 */
function applyOperation(operation: SyncOperation): { success: boolean; error?: string } {
  try {
    const userStore = getUserStore(operation.userId)
    const entityKey = `${operation.entityType}:${operation.entityId}`
    
    switch (operation.type) {
      case 'create':
        // Check if entity already exists
        if (userStore.has(entityKey)) {
          return { success: false, error: 'Entity already exists' }
        }
        userStore.set(entityKey, operation.data)
        break
      
      case 'update':
        // Check if entity exists
        if (!userStore.has(entityKey)) {
          return { success: false, error: 'Entity not found' }
        }
        userStore.set(entityKey, { ...userStore.get(entityKey), ...operation.data })
        break
      
      case 'delete':
        // Check if entity exists
        if (!userStore.has(entityKey)) {
          return { success: false, error: 'Entity not found' }
        }
        userStore.delete(entityKey)
        break
    }
    
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Check if an operation conflicts with current server state
 */
function checkConflict(
  operation: SyncOperation,
  userStore: Map<string, Record<string, unknown>>
): { hasConflict: boolean; conflictType?: string; serverData?: Record<string, unknown> } {
  const entityKey = `${operation.entityType}:${operation.entityId}`
  
  switch (operation.type) {
    case 'create':
      // Conflict if entity already exists on server
      if (userStore.has(entityKey)) {
        return { hasConflict: true, conflictType: 'create-create', serverData: userStore.get(entityKey) }
      }
      break
    
    case 'update':
      // Conflict if entity doesn't exist on server
      if (!userStore.has(entityKey)) {
        return { hasConflict: true, conflictType: 'update-delete', serverData: undefined }
      }
      break
    
    case 'delete':
      // Conflict if entity doesn't exist on server
      if (!userStore.has(entityKey)) {
        return { hasConflict: true, conflictType: 'delete-update', serverData: undefined }
      }
      break
  }
  
  return { hasConflict: false }
}

// ============================================================================
// Audit Logging
// ============================================================================

/**
 * Log an audit entry
 */
function logAudit(
  userId: string,
  operationId: string,
  entityType: string,
  entityId: string | number,
  operationType: 'create' | 'update' | 'delete',
  success: boolean,
  error?: string,
  ipAddress?: string,
  userAgent?: string
): void {
  const auditEntry: SyncAuditLog = {
    id: `audit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    userId,
    operationId,
    entityType,
    entityId,
    operationType,
    timestamp: Date.now(),
    success,
    error,
    ipAddress,
    userAgent,
  }
  
  auditLogStore.push(auditEntry)
  
  // In production, this would be persisted to the database
  console.log('[Audit]', auditEntry)
}

// ============================================================================
// Sync History
// ============================================================================

/**
 * Record a sync history entry
 */
function recordSyncHistory(
  userId: string,
  deviceId: string,
  startTimestamp: number,
  endTimestamp: number,
  operationsCount: number,
  conflictCount: number,
  failureCount: number,
  status: SyncStatus,
  error?: string
): SyncHistoryEntry {
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
  
  syncHistoryStore.push(historyEntry)
  
  // In production, this would be persisted to the database
  console.log('[SyncHistory]', historyEntry)
  
  return historyEntry
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
  
  // Check rate limit
  const rateLimit = checkRateLimit(user.id)
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
  
  // Verify all operations belong to this user
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
  
  const userStore = getUserStore(user.id)
  
  let processedCount = 0
  let failedCount = 0
  let conflictCount = 0
  const conflicts: SyncConflict[] = []
  const failedOperationIds: string[] = []
  
  // Process each operation
  for (const operation of operations) {
    // Check for conflicts
    const conflictCheck = checkConflict(operation, userStore)
    
    if (conflictCheck.hasConflict) {
      // Conflict detected - record it
      conflictCount++
      conflicts.push({
        localOperationId: operation.id,
        serverOperationId: `server-${operation.entityType}-${operation.entityId}`,
        entityType: operation.entityType,
        entityId: operation.entityId,
        conflictType: conflictCheck.conflictType || 'unknown',
        // In a real implementation, we would include the server data for conflict resolution
      })
      
      // For now, we'll skip this operation
      // In a production implementation with manual conflict resolution,
      // we would return the conflict to the client for resolution
      failedOperationIds.push(operation.id)
      
      // Log the conflict
      logAudit(
        user.id,
        operation.id,
        operation.entityType,
        operation.entityId,
        operation.type,
        false,
        `Conflict: ${conflictCheck.conflictType}`,
        ipAddress,
        userAgent
      )
      
      continue
    }
    
    // Apply the operation
    const result = applyOperation(operation)
    
    if (result.success) {
      processedCount++
      
      // Log successful operation
      logAudit(
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
      logAudit(
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
  if (failedCount > 0 || conflictCount > 0) {
    status = SyncStatusEnum.FAILED
  }
  
  // Record sync history
  recordSyncHistory(
    user.id,
    deviceId,
    startTime,
    endTime,
    operations.length,
    conflictCount,
    failedCount,
    status,
    status === SyncStatusEnum.FAILED ? 'Sync completed with errors' : undefined
  )
  
  return {
    success: failedCount === 0 && conflictCount === 0,
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
 * Get sync history for a user
 */
export async function getSyncHistory(userId: string): Promise<SyncHistoryEntry[]> {
  // In production, this would query the database
  return syncHistoryStore.filter((entry) => entry.userId === userId)
}

/**
 * Get sync audit logs for a user
 */
export async function getSyncAuditLogs(userId: string): Promise<SyncAuditLog[]> {
  // In production, this would query the database
  return auditLogStore.filter((entry) => entry.userId === userId)
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
  // In production, this would query the database
  const userHistory = syncHistoryStore.filter((entry) => entry.userId === userId)
  const lastSync = userHistory[userHistory.length - 1]
  
  return {
    pendingCount: 0, // Would be from pending operations table
    conflictCount: 0, // Would be from conflicts table
    lastSyncTimestamp: lastSync?.endTimestamp || null,
    status: lastSync?.status || SyncStatusEnum.PENDING,
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
  // In a production implementation, this would:
  // 1. Look up the conflict by ID
  // 2. Apply the resolution
  // 3. Remove the conflict from the conflicts table
  // 4. Log the resolution
  
  // For now, we'll just log and return success
  console.log(`[Conflict Resolution] User ${userId} resolved conflict ${conflictId} with:`, resolution)
  
  return { success: true }
}

// ============================================================================
// Exports
// ============================================================================

export {
  RATE_LIMIT_CONFIG,
  userDataStore,
  syncHistoryStore,
  auditLogStore,
}

export type {
  BatchSyncRequest,
  BatchSyncResponse,
  SyncConflict,
  SyncHistoryEntry,
  SyncAuditLog,
}
