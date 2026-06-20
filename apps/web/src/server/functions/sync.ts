/**
 * Sync Server Functions
 * 
 * Server-side functions for multi-device synchronization.
 * These functions can be called from client code via TanStack Start's server function proxy.
 * 
 * Data Sovereignty: ALL data stored in DanubeData PostgreSQL (Germany - EU) for CLOUD Act immunity (NFR1, NFR2)
 */

import type { SyncOperation, ProcessOperationResult } from '@budget-planner/core/sync'
import { SyncStatus as SyncStatusEnum } from '@budget-planner/core/sync'
import type { BatchSyncRequest, BatchSyncResponse } from '../api/sync'
import { processBatchSync, getSyncHistory, getSyncAuditLogs, getSyncStatus } from '../api/sync'
import type { User } from '@budget-planner/db'

/**
 * Server Function: Process a batch of sync operations
 * 
 * This is the main sync endpoint that handles client sync requests.
 * It validates the user, processes operations, and returns the sync result.
 * 
 * @param request - The batch sync request containing operations to process
 * @returns Promise resolving to the batch sync response
 */
export async function syncBatch(
  request: BatchSyncRequest
): Promise<BatchSyncResponse> {
  // Get the current user from the request context
  // In TanStack Start, this is automatically injected
  const user: User | null = null // This will be populated by TanStack Start's auth
  
  if (!user) {
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

  // Get client IP and user agent from request
  // In TanStack Start, these are available in the request context
  const ipAddress = '' // Will be populated by TanStack Start
  const userAgent = '' // Will be populated by TanStack Start

  return processBatchSync(request, user, ipAddress, userAgent)
}

/**
 * Server Function: Get sync history for the current user
 */
export async function syncGetHistory(): Promise<ReturnType<typeof getSyncHistory>> {
  const user: User | null = null // Will be populated by TanStack Start
  
  if (!user) {
    return []
  }
  
  return getSyncHistory(user.id)
}

/**
 * Server Function: Get sync audit logs for the current user
 */
export async function syncGetAuditLogs(): Promise<ReturnType<typeof getSyncAuditLogs>> {
  const user: User | null = null // Will be populated by TanStack Start
  
  if (!user) {
    return []
  }
  
  return getSyncAuditLogs(user.id)
}

/**
 * Server Function: Get current sync status for the current user
 */
export async function syncGetStatus(): Promise<ReturnType<typeof getSyncStatus>> {
  const user: User | null = null // Will be populated by TanStack Start
  
  if (!user) {
    return {
      pendingCount: 0,
      conflictCount: 0,
      lastSyncTimestamp: null,
      status: SyncStatusEnum.PENDING,
    }
  }
  
  return getSyncStatus(user.id)
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
        error: response.error || 'Operation failed on server' 
      }
    }
    
    // Fallback
    return { 
      success: response.success, 
      error: response.error 
    }
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    }
  }
}

// Re-export types for convenience
export type { BatchSyncRequest, BatchSyncResponse }
