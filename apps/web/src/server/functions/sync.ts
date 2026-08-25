/**
 * Sync Server Functions
 *
 * Server-side functions for multi-device synchronization.
 * These functions can be called from client code via TanStack Start's server function proxy.
 *
 * Data Sovereignty: ALL data stored in DanubeData PostgreSQL (Germany - EU) for CLOUD Act immunity (NFR1, NFR2)
 */

import { SyncStatus as SyncStatusEnum } from '@budget-planner/core/sync'
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
  let userResult: Awaited<ReturnType<typeof getUserContext>>
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

  // The session exposes the user id as `userId`; processBatchSync reads `user.id`
  // (and compares it to every operation's userId). Map it explicitly — passing the
  // raw session here made the ownership check compare against `undefined`.
  const user = {
    id: userResult.data.userId,
    subscriptionStatus: userResult.data.subscriptionStatus,
  }
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

  // Advisory-only request metadata for the audit log.
  // SECURITY: `x-forwarded-for` is client-supplied and trivially spoofable, so it
  // is NEVER used for a security decision — rate limiting keys on the
  // authenticated `user.id` inside processBatchSync, not on this value. It is
  // recorded as untrusted audit context only.
  const forwardedFor = request.headers.get('x-forwarded-for') || ''
  const advisoryIpAddress = forwardedFor.split(',').pop()?.trim() || ''
  const userAgent = request.headers.get('user-agent')?.slice(0, 500) || '' // Limit length

  return processBatchSync(data, user, advisoryIpAddress, userAgent)
}

/**
 * Resolve the authenticated user id from the request, or null when the request
 * carries no valid session.
 *
 * `request` is required: read endpoints must not be callable without a request
 * to authenticate against. An absent/invalid session resolves to null (the
 * caller returns a safe empty/pending result) rather than silently treating an
 * unauthenticated call as a successful empty read.
 */
async function resolveAuthenticatedUserId(request: Request): Promise<string | null> {
  try {
    const userResult = await getUserContext(request)
    if (!userResult.success || !userResult.data) {
      return null
    }
    // UserSession exposes the id as `userId` (not `id`); the downstream read
    // helpers key on it.
    return userResult.data.userId
  } catch {
    // Authentication error (malformed request, bad token, etc.)
    return null
  }
}

/**
 * Server Function: Get sync history for the current user
 */
export async function syncGetHistory(request: Request): Promise<ReturnType<typeof getSyncHistory>> {
  const userId = await resolveAuthenticatedUserId(request)
  if (!userId) {
    return []
  }
  return getSyncHistory(userId)
}

/**
 * Server Function: Get sync audit logs for the current user
 */
export async function syncGetAuditLogs(
  request: Request
): Promise<ReturnType<typeof getSyncAuditLogs>> {
  const userId = await resolveAuthenticatedUserId(request)
  if (!userId) {
    return []
  }
  return getSyncAuditLogs(userId)
}

/**
 * Server Function: Get current sync status for the current user
 */
export async function syncGetStatus(request: Request): Promise<ReturnType<typeof getSyncStatus>> {
  const userId = await resolveAuthenticatedUserId(request)
  if (!userId) {
    return {
      pendingCount: 0,
      conflictCount: 0,
      lastSyncTimestamp: null,
      status: SyncStatusEnum.PENDING,
    }
  }
  return getSyncStatus(userId)
}

/**
 * ⚠️ `processSyncOperation` USED TO LIVE HERE AND HAS BEEN REMOVED (story 5-15).
 *
 * It wrapped one operation in a `BatchSyncRequest` and passed that plain object to
 * `syncBatch(request: Request)`, which immediately calls `getUserContext(request)`
 * → `request.headers.get('cookie')`. A `BatchSyncRequest` has no `headers`, so the
 * call threw on every invocation and the function's own catch turned it into a
 * generic failure result — it could never have succeeded.
 *
 * It was already superseded: push moved over HTTP in story 5-15 precisely so the
 * client never imports server/DB code, and the live transport is
 * `sendSyncOperation` in `features/api/client.ts`, wired into the core service as
 * `config.processOperation`. Both `routes/api/sync/batch.ts:11` and
 * `features/api/client.ts:263` describe this function as the OLD direct import
 * they replaced. Nothing imported it; no test referenced it.
 *
 * Do not reinstate it — re-adding a direct client import of this module is the
 * `@budget-planner/db`-in-the-client-bundle hazard that 5-12, 4-18 and 5-15 each
 * fixed in turn.
 */

// Re-export types for convenience
export type { BatchSyncRequest, BatchSyncResponse }
