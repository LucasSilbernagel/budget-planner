/**
 * Sync Bridge (Story 5-15)
 *
 * The seam between the localStorage-first Zustand domain stores and the paid-tier
 * push queue. Domain store actions call the `syncEntity*` helpers below after they
 * mutate local state; when a paid session is active (the {@link SyncProvider} has
 * registered a handle) the edit is ALSO enqueued onto the offline-durable sync
 * queue and pushed to DanubeData. When no paid session is active the helpers are
 * a no-op, so the FREE tier stays localStorage-only with zero network calls
 * (AC-6 / NFR tier separation).
 *
 * WHY A MODULE-LEVEL HANDLE: the sync service lives inside the `useSync` hook
 * (React tree), but the store actions are plain functions called from anywhere.
 * The provider registers the queue functions here on mount and clears them on
 * unmount (logout / downgrade), so the stores never import React or the service.
 *
 * Direction of dependency is one-way: stores → bridge. The bridge never imports
 * the stores (no cycle) and never imports server/db code (no client-bundle hazard).
 */

import type { SyncEntityType } from '@budget-planner/core/sync'

/** Queue functions the provider supplies (sourced from `useSync`). */
export interface SyncBridgeHandle {
  /** The authenticated paid user's uuid — the authoritative owner of every op. */
  userId: string
  queueCreate: (
    entityType: SyncEntityType,
    entityId: string,
    data: Record<string, unknown>
  ) => Promise<void>
  queueUpdate: (
    entityType: SyncEntityType,
    entityId: string,
    data: Record<string, unknown>,
    version?: number,
    baseVersion?: number
  ) => Promise<void>
  queueDelete: (entityType: SyncEntityType, entityId: string, baseVersion?: number) => Promise<void>
}

let handle: SyncBridgeHandle | null = null

/** Register the active paid-session queue (called by SyncProvider on mount). */
export function registerSyncBridge(next: SyncBridgeHandle): void {
  handle = next
}

/** Clear the active paid-session queue (logout / downgrade / unmount). */
export function clearSyncBridge(): void {
  handle = null
}

/** Whether a paid sync session is currently wired (used by tests + guards). */
export function isSyncActive(): boolean {
  return handle !== null
}

/**
 * A client domain entity as the stores hold it: a uuid `id`, the domain fields,
 * and ISO-string timestamps. The bridge reads `id`/`updatedAt` and lets the
 * per-entity mapper pick the server-shaped fields.
 */
// NOTE: deliberately NOT intersected with `Record<string, unknown>` — the store
// item types are plain interfaces (no index signature) and would not be assignable
// to such an intersection. The mapper casts to a record for its field reads.
type ClientEntity = { id: string; updatedAt?: string }

/**
 * Parse an ISO timestamp into a Unix-ms epoch for `baseVersion` (4-18 D1), or
 * `undefined` when absent/unparseable (reconciliation then falls back to the
 * op timestamp — a strict, regression-free default).
 */
function toBaseVersion(updatedAt: unknown): number | undefined {
  if (typeof updatedAt !== 'string') {
    return undefined
  }
  const ms = Date.parse(updatedAt)
  return Number.isNaN(ms) ? undefined : ms
}

/**
 * Build the server-shaped operation payload for an entity type. The local store
 * item carries a free-tier `userId` (often `0`); the payload MUST carry the
 * authenticated session uuid instead, which the server also re-verifies against
 * the session. Only the columns the server validates per entity are forwarded.
 */
function toServerPayload(
  entityType: SyncEntityType,
  entityIn: ClientEntity,
  userId: string
): Record<string, unknown> {
  // Read the domain fields through a record view (ClientEntity only declares
  // id/updatedAt); bracket access satisfies noPropertyAccessFromIndexSignature.
  const entity = entityIn as Record<string, unknown>
  switch (entityType) {
    case 'incomeSource':
    case 'expense':
      return {
        name: entity['name'],
        amount: entity['amount'],
        frequency: entity['frequency'],
        userId,
      }
    case 'savingsGoal':
      return {
        name: entity['name'],
        targetAmount: entity['targetAmount'],
        currentBalance: entity['currentBalance'],
        // Story 26.1: forward the allocation mode (default 'automatic'), else a
        // paid-tier sync silently drops it and the server defaults every account.
        allocationMode: entity['allocationMode'] ?? 'automatic',
        // Forward the manual amount ALWAYS, including null — unlike the
        // omit-when-null `maxContributionLimit` (whose server gate rejects null),
        // this field's gates are both `.nullable()`, and null is a reachable state:
        // switching an account manual→automatic must RESET the stored amount to null
        // on the server + other devices. `updateEntity` does a partial `.set()`, so
        // an omitted key would leave a stale prior amount (review 26-1 P1). Mirrors
        // how `targetAmount` is always forwarded.
        monthlyAllocation: entity['monthlyAllocation'] ?? null,
        userId,
      }
    case 'balanceTracking': {
      const payload: Record<string, unknown> = {
        type: entity['type'],
        name: entity['name'],
        currentBalance: entity['currentBalance'],
        monthlyContribution: entity['monthlyContribution'] ?? 0,
        // Story 16-2: forward the contribution cadence, else paid-tier syncs silently
        // drop it and the server defaults every synced entry to 'monthly'.
        frequency: entity['frequency'] ?? 'monthly',
        userId,
      }
      // Optional column — only forward when present (the schema rejects null but
      // allows it to be absent).
      if (entity['maxContributionLimit'] != null) {
        payload['maxContributionLimit'] = entity['maxContributionLimit']
      }
      return payload
    }
    default: {
      // userProfile (the only remaining SyncEntityType) — `default` rather than a
      // named case so the switch is provably exhaustive for tsc.
      const payload: Record<string, unknown> = {
        name: entity['name'],
        isDefault: entity['isDefault'] ?? false,
        currency: entity['currency'] ?? 'NONE',
        userId,
      }
      if (entity['description'] != null) {
        payload['description'] = entity['description']
      }
      return payload
    }
  }
}

/** Log + swallow a queue failure — a sync hiccup must not break the local edit. */
function onQueueError(action: string, error: unknown): void {
  console.error(`[syncBridge] failed to queue ${action}:`, error)
}

/**
 * Queue a CREATE for a freshly added entity (no-op for the free tier). The op
 * carries the entity's shared uuid id (Story 5-14), so it reconciles by id on
 * every device with no duplicate-on-create.
 */
export function syncEntityCreate(entityType: SyncEntityType, entity: ClientEntity): void {
  const queued = enqueueCreate(entityType, entity)
  if (queued) {
    queued.catch((error) => onQueueError(`create ${entityType}`, error))
  }
}

/**
 * Raw create enqueue: returns the queue's durable-add promise (or `null` when no
 * paid session is active) WITHOUT swallowing rejections. The free→paid seeder
 * uses this so it can AWAIT the enqueues and only mark the user "seeded" once they
 * have actually persisted (a fire-and-forget enqueue could set the marker while
 * the add is still pending — losing the backlog on a crash). The live path wraps
 * it with a catch above.
 */
export function enqueueCreate(
  entityType: SyncEntityType,
  entity: ClientEntity
): Promise<void> | null {
  if (!handle) {
    return null
  }
  const payload = toServerPayload(entityType, entity, handle.userId)
  return handle.queueCreate(entityType, entity.id, payload)
}

/**
 * Queue an UPDATE (no-op for the free tier). `previous` is the pre-edit entity;
 * its `updatedAt` becomes the `baseVersion` so pull reconciliation uses causal
 * LWW instead of wall-clock time (4-18 D1).
 */
export function syncEntityUpdate(
  entityType: SyncEntityType,
  entity: ClientEntity,
  previous?: ClientEntity
): void {
  if (!handle) {
    return
  }
  const payload = toServerPayload(entityType, entity, handle.userId)
  const baseVersion = toBaseVersion(previous?.updatedAt ?? entity.updatedAt)
  handle.queueUpdate(entityType, entity.id, payload, undefined, baseVersion).catch((error) => {
    onQueueError(`update ${entityType}`, error)
  })
}

/**
 * Queue a DELETE (no-op for the free tier). `entity` is the row being removed;
 * its `updatedAt` provides the `baseVersion`. The server soft-deletes (tombstone)
 * so the deletion propagates to other devices on their next pull.
 */
export function syncEntityDelete(entityType: SyncEntityType, entity: ClientEntity): void {
  if (!handle) {
    return
  }
  const baseVersion = toBaseVersion(entity.updatedAt)
  handle.queueDelete(entityType, entity.id, baseVersion).catch((error) => {
    onQueueError(`delete ${entityType}`, error)
  })
}
