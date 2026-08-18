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

import type { SyncEntityType } from '@budget-planner/core'

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
        // ⚠️⚠️ DELIBERATELY PINNED TO NULL UNTIL THE SYNC-CREATE REPAIR LANDS
        // (code review 30.4b, Lucas's call). REVERT THIS TO
        // `entity['categoryId'] ?? null` in the same pass that repairs category
        // sync — `category-sync-payload.test.ts` fails the moment you do, which
        // is how the revert stays discoverable.
        //
        // Why: `categories.id` is a REAL foreign key on both cashflow tables
        // (schema.ts), but category rows cannot reach the server at all (the
        // server strips `profileId` on create, and the missing client `id`
        // escalates to a permanent 23503 — see deferred-work.md). So forwarding
        // a real category uuid points the FK at a row that cannot exist. The
        // server's `updateEntity` does `.set({...data})` without filtering, so
        // the op fails 23503 — taking the name/amount edit bundled with it —
        // and because the failure is not marked `retryable: false`, the client
        // burns its retry budget, pins status FAILED and OPENS THE CIRCUIT
        // BREAKER, suppressing sync for EVERY OTHER ENTITY. 30.4a added the
        // column; 30.4b's picker is what first makes a non-null value reachable.
        //
        // Explicit `null` rather than an omitted key: `updateEntity` is a
        // partial `.set()`, so omitting would leave any prior server value in
        // place, and null is always a valid FK. Category assignments therefore
        // stay LOCAL-ONLY for now — which is exactly the status quo, since
        // categories never reached the server in the first place.
        categoryId: null,
        // Story 34.1a (FR60): the row's explicit display position. Emitted
        // UNCONDITIONALLY — never behind an `if` — because `updateEntity` does a
        // PARTIAL `.set()`, so an omitted key silently leaves the previous server
        // value in place and the reorder never lands. Note this function returns
        // `Record<string, unknown>`, so a forgotten key is NOT a type error: gate 2
        // is pinned by tests.
        //
        // ⚠️ PRECISION, corrected by code review 34.1a: "always emitted" describes
        // this CODE, not the wire. `sortOrder` is optional on the client types, and
        // `JSON.stringify` drops an `undefined`-valued key — so a row that somehow
        // reached here unpositioned would still serialize WITHOUT the key, hitting
        // exactly the partial-`.set()` hazard above. That is now prevented upstream
        // rather than here: `stampMissingSortOrder` gives every pulled row a
        // position on arrival, and the persist migrations backfill the rest.
        sortOrder: entity['sortOrder'],
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
        // Story 34.1a (FR60): the row's explicit display position. Emitted
        // UNCONDITIONALLY — never behind an `if` — because `updateEntity` does a
        // PARTIAL `.set()`, so an omitted key silently leaves the previous server
        // value in place and the reorder never lands. Note this function returns
        // `Record<string, unknown>`, so a forgotten key is NOT a type error: gate 2
        // is pinned by tests.
        //
        // ⚠️ PRECISION, corrected by code review 34.1a: "always emitted" describes
        // this CODE, not the wire. `sortOrder` is optional on the client types, and
        // `JSON.stringify` drops an `undefined`-valued key — so a row that somehow
        // reached here unpositioned would still serialize WITHOUT the key, hitting
        // exactly the partial-`.set()` hazard above. That is now prevented upstream
        // rather than here: `stampMissingSortOrder` gives every pulled row a
        // position on arrival, and the persist migrations backfill the rest.
        sortOrder: entity['sortOrder'],
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
        // Story 34.1a (FR60): the row's explicit display position. Emitted
        // UNCONDITIONALLY — never behind an `if` — because `updateEntity` does a
        // PARTIAL `.set()`, so an omitted key silently leaves the previous server
        // value in place and the reorder never lands. Note this function returns
        // `Record<string, unknown>`, so a forgotten key is NOT a type error: gate 2
        // is pinned by tests.
        //
        // ⚠️ PRECISION, corrected by code review 34.1a: "always emitted" describes
        // this CODE, not the wire. `sortOrder` is optional on the client types, and
        // `JSON.stringify` drops an `undefined`-valued key — so a row that somehow
        // reached here unpositioned would still serialize WITHOUT the key, hitting
        // exactly the partial-`.set()` hazard above. That is now prevented upstream
        // rather than here: `stampMissingSortOrder` gives every pulled row a
        // position on arrival, and the persist migrations backfill the rest.
        sortOrder: entity['sortOrder'],
        userId,
      }
      // Optional column — only forward when present (the schema rejects null but
      // allows it to be absent).
      if (entity['maxContributionLimit'] != null) {
        payload['maxContributionLimit'] = entity['maxContributionLimit']
      }
      return payload
    }
    case 'category':
      return {
        name: entity['name'],
        // Story 30.4a: `kind` separates the income and expense namespaces. Drop
        // it and every synced category becomes unplaceable server-side.
        kind: entity['kind'],
        userId,
      }
    case 'userProfile': {
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
    default: {
      // ⚠️ Story 30.4a: this was previously the `userProfile` case itself, which
      // made adding a SyncEntityType a SILENT defect — a new entity fell through
      // to userProfile's shape and shipped `currency`/`isDefault`, both of which
      // are declared in syncOperationDataSchema and so survive the strip gate and
      // get written. Extending the union produced no compile error at all.
      //
      // Now every member is named and the residual `default` is provably
      // unreachable, so `never` turns the next added entity type into a COMPILE
      // ERROR here instead of corrupt data on the wire.
      const exhaustive: never = entityType
      throw new Error(`toServerPayload: unhandled sync entity type ${String(exhaustive)}`)
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
