/**
 * Sync Server Functions
 *
 * Server-side functions for multi-device synchronization.
 * These functions can be called from client code via TanStack Start's server function proxy.
 *
 * Data Sovereignty: ALL data stored in DanubeData PostgreSQL (Germany - EU) for CLOUD Act immunity (NFR1, NFR2)
 */

import type { ProcessOperationResult, SyncOperation } from '@budget-planner/core/sync'
import { SyncStatus as SyncStatusEnum } from '@budget-planner/core/sync'
import type { User } from '@budget-planner/db'
import type { Request } from '@tanstack/start'
import { getUserContext } from '../api/data/forecasting'
import type { BatchSyncRequest, BatchSyncResponse } from '../api/sync'
import { getSyncAuditLogs, getSyncHistory, getSyncStatus, processBatchSync } from '../api/sync'

/**
 * Server Function: Process a batch of sync operations
 *
 * This is the main sync endpoint that handles client sync requests.
 * It validates the user, processes operations, and returns the sync result.
 *
 * @param request - The batch sync request containing operations to process
 * @returns Promise resolving to the batch sync response
 */
export async function syncBatch(request: Request): Promise<BatchSyncResponse> {
  // Get the current user from the request context using Paddle auth
  let userResult
  try {
    userResult = await getUserContext(request)
  } catch (error) {
    // Handle errors from getUserContext (malformed request, etc.)
    return {
      success: false,
      processedCount: 0,
      failedCount: 0,
      conflictCount: 0,
      conflicts: [],
      failedOperationIds: [],
      serverTimestamp: Date.now(),
      status: SyncStatusEnum.FAILED,
      error: `Authentication error: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  if (!userResult.success || !userResult.data) {
    return {
      success: false,
      processedCount: 0,
      failedCount: 0,
      conflictCount: 0,
      conflicts: [],
      failedOperationIds: [],
      serverTimestamp: Date.now(),
      status: SyncStatusEnum.FAILED,
      error: 'Unauthorized: User not authenticated',
    }
  }

  const user = userResult.data
  let data: BatchSyncRequest

  // SECURITY: Limit request body size to prevent DoS
  const contentLength = request.headers.get('content-length')
  const MAX_REQUEST_SIZE = 1024 * 1024 // 1MB
  if (contentLength && parseInt(contentLength) > MAX_REQUEST_SIZE) {
    return {
      success: false,
      processedCount: 0,
      failedCount: 0,
      conflictCount: 0,
      conflicts: [],
      failedOperationIds: [],
      serverTimestamp: Date.now(),
      status: SyncStatusEnum.FAILED,
      error: 'Request too large',
    }
  }

  try {
    data = await request.json()
  } catch (error) {
    return {
      success: false,
      processedCount: 0,
      failedCount: 0,
      conflictCount: 0,
      conflicts: [],
      failedOperationIds: [],
      serverTimestamp: Date.now(),
      status: SyncStatusEnum.FAILED,
      error: `Invalid request: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  // Get client IP and user agent from request
  // SECURITY: x-forwarded-for can be spoofed; use with caution
  // In production, consider using connection.socket.remoteAddress for more reliable IP
  const forwardedFor = request.headers.get('x-forwarded-for') || ''
  const ipAddress = forwardedFor.split(',').pop()?.trim() || ''
  const userAgent = request.headers.get('user-agent')?.slice(0, 500) || '' // Limit length

  return processBatchSync(data, user, ipAddress, userAgent)
}

/**
 * Server Function: Get sync history for the current user
 */
export async function syncGetHistory(
  request?: Request
): Promise<ReturnType<typeof getSyncHistory>> {
  let userResult = { success: false, data: null as User | null }
  if (request) {
    try {
      userResult = await getUserContext(request)
    } catch {
      // Authentication error - return empty array (no history for unauthenticated)
      return []
    }
  }

  if (!userResult.success || !userResult.data) {
    return []
  }

  return getSyncHistory(userResult.data.id)
}

/**
 * Server Function: Get sync audit logs for the current user
 */
export async function syncGetAuditLogs(
  request?: Request
): Promise<ReturnType<typeof getSyncAuditLogs>> {
  let userResult = { success: false, data: null as User | null }
  if (request) {
    try {
      userResult = await getUserContext(request)
    } catch {
      // Authentication error - return empty array (no audit logs for unauthenticated)
      return []
    }
  }

  if (!userResult.success || !userResult.data) {
    return []
  }

  return getSyncAuditLogs(userResult.data.id)
}

/**
 * Server Function: Get current sync status for the current user
 */
export async function syncGetStatus(request?: Request): Promise<ReturnType<typeof getSyncStatus>> {
  let userResult = { success: false, data: null as User | null }
  if (request) {
    try {
      userResult = await getUserContext(request)
    } catch {
      // Authentication error - return pending status for unauthenticated
      return {
        pendingCount: 0,
        conflictCount: 0,
        lastSyncTimestamp: null,
        status: SyncStatusEnum.PENDING,
      }
    }
  }

  if (!userResult.success || !userResult.data) {
    return {
      pendingCount: 0,
      conflictCount: 0,
      lastSyncTimestamp: null,
      status: SyncStatusEnum.PENDING,
    }
  }

  return getSyncStatus(userResult.data.id)
}

/**
 * Process a single sync operation
 *
 * This is a helper function that can be used as a custom processOperation
 * implementation for the SynchronizationService on the client side.
 *
 * It wraps a single operation in a batch request and sends it to the server.
 *
 * @param operation - The sync operation to process
 * @returns Promise resolving to the operation result
 */
export async function processSyncOperation(
  operation: SyncOperation
): Promise<ProcessOperationResult> {
  try {
    // Wrap the single operation in a batch request
    const request: BatchSyncRequest = {
      operations: [operation],
      clientTimestamp: Date.now(),
      deviceId: operation.deviceId,
    }

    // Call the server batch sync function
    const response = await syncBatch(request)

    // If the batch succeeded and processed one operation
    if (response.success && response.processedCount === 1) {
      return { success: true }
    }

    // If there were conflicts
    if (response.conflictCount > 0) {
      return { success: false, conflict: true }
    }

    // If there were failures
    if (response.failedCount > 0) {
      return {
        success: false,
        error: response.error || 'Operation failed on server',
      }
    }

    // Fallback
    return {
      success: response.success,
      error: response.error,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

// Re-export types for convenience
export type { BatchSyncRequest, BatchSyncResponse }
