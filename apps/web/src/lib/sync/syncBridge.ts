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

import type { SyncEntityType, SyncOperation } from '@budget-planner/core'
import { RETIREMENT_PLAN_STRING_MAX } from '@budget-planner/core/sync/types'
import { z } from 'zod'
import { type RetirementPlan, coerceRetirementPlan } from '../retirement-plan'

/**
 * Make every string field of a plan one the push gate accepts (99.2 code review).
 *
 * The coercion accepts any string, but `retirementPlanSyncSchema` refuses one
 * over {@link RETIREMENT_PLAN_STRING_MAX} and one jsonb cannot store (a NUL or a
 * lone surrogate, `isJsonbStorableString`). The inputs have no `maxLength`
 * and localStorage is user-editable, so both are reachable, and either would make
 * core's G2 gate throw on EVERY push of that plan: it would never sync. So:
 * drop NULs, replace a lone surrogate with U+FFFD, then cut to the bound without
 * splitting a surrogate pair (a cut pair is itself a lone surrogate). No real
 * value (an age, a rate, a formatted amount, a locale tag) is touched.
 */
function sanitizePlanString(value: string): string {
  let clean = value
    .replaceAll('\u0000', '')
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '\ufffd')
  if (clean.length > RETIREMENT_PLAN_STRING_MAX) {
    clean = clean.slice(0, RETIREMENT_PLAN_STRING_MAX)
    if (/[\ud800-\udbff]$/.test(clean)) {
      clean = clean.slice(0, -1)
    }
  }
  return clean
}

function sanitizePlanStrings(plan: RetirementPlan): RetirementPlan {
  const clean: Record<string, unknown> = { ...plan }
  for (const [key, value] of Object.entries(clean)) {
    if (typeof value === 'string') {
      clean[key] = sanitizePlanString(value)
    }
  }
  return clean as unknown as RetirementPlan
}

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
    baseVersion?: number,
    dependsOn?: SyncOperation['dependsOn']
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
 * The wired paid session's account id, or `null` when none is (story 99.3: the
 * retirement plan push checks the plan's owner against it, AC-6).
 */
export function getSyncSessionUserId(): string | null {
  return handle === null ? null : handle.userId
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

/** The queue gate's uuid rule (`syncOperationDataSchema.paymentExpenseId`), story 102.1. */
const UUID_SCHEMA = z.string().uuid()

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
 * The columns shared by the two cash-flow entities (`incomeSource`, `expense`).
 *
 * ⚠️ Extracted by story 65.2 so the two cases could be SPLIT without duplicating
 * the rationale below. They were one shared arm until this field arrived:
 * `expenses` gained an `endsBeforeRetirement` column and `incomeSources` did not,
 * and `updateEntity` spreads `operation.data` straight into `.set()` with no
 * column whitelist.
 *
 * ⚠️ MEASURED, not assumed (story 65.2, decision D4): drizzle SILENTLY DROPS a
 * key that is not a column — probed against `incomeSources`, the generated SQL
 * was `update "incomeSources" set "name" = $1 …` with the unknown key absent, no
 * throw. So a shared arm would NOT have broken income sync today. The split is
 * for the latent trap, not a live one: a payload that declares a field the
 * entity does not have is a key the server's `incomeSourceSchema` never declares,
 * so any future `.strict()` there would break ALL income sync for a field that
 * never meant anything on that entity.
 */
function cashflowPayload(entity: Record<string, unknown>, userId: string): Record<string, unknown> {
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
}

/**
 * Build the server-shaped operation payload for an entity type. The local store
 * item carries a free-tier `userId` (often `0`); the payload MUST carry the
 * authenticated session uuid instead, which the server also re-verifies against
 * the session. Only the columns the server validates per entity are forwarded.
 *
 * The local row gets the session uuid too, but only once the server ACCEPTS the
 * op (story 86.3, `stampSyncedOwner` in `applyServerChanges.ts`), never here: a
 * row whose push never lands stays a placeholder, adoptable by the next account.
 */
export function toServerPayload(
  entityType: SyncEntityType,
  entityIn: ClientEntity,
  userId: string
): Record<string, unknown> {
  // Read the domain fields through a record view (ClientEntity only declares
  // id/updatedAt); bracket access satisfies noPropertyAccessFromIndexSignature.
  const entity = entityIn as Record<string, unknown>
  switch (entityType) {
    case 'incomeSource':
      return cashflowPayload(entity, userId)
    case 'expense':
      return {
        ...cashflowPayload(entity, userId),
        // Story 65.2 (FR101): the user's "this expense ends before I retire"
        // flag. Emitted UNCONDITIONALLY — never behind an `if` — and coerced
        // to a real boolean for the reason `contributionRecordedAsExpense`
        // records below: `JSON.stringify` DROPS an `undefined`-valued key and
        // `updateEntity` does a PARTIAL `.set()`, so an unstamped row would
        // leave the previous server value in place. The user unticks the box,
        // the local figure corrects, and every other device goes on excluding
        // the expense from their retirement target. Forever, with no error.
        //
        // ⚠️ Rows persisted before this story carry no key at all (the client
        // type declares it optional and no persist migration backfills it), so
        // the coercion is the ordinary path here, not a defensive edge.
        //
        // ⚠️⚠️ `=== true`, NOT `?? false` — corrected by code review 65.2. Every
        // READ path in the app insists on `=== true` because localStorage is
        // user-editable and a persisted `"false"` STRING is truthy. `?? false`
        // only coerces null/undefined, so it forwarded such a string UNCHANGED —
        // and the client queue gate (`syncOperationDataSchema`, `z.boolean()`)
        // then rejected the whole operation inside `validateOperationData`,
        // BEFORE `queue.add`. The row showed as unmarked in the UI while every
        // edit to it — including a rename or a reorder that merely spreads the
        // bad value through — silently stopped syncing. `=== true` makes the
        // write path agree with every read path.
        endsBeforeRetirement: entity['endsBeforeRetirement'] === true,
      }
    case 'savingsGoal':
      return {
        name: entity['name'],
        targetAmount: entity['targetAmount'],
        currentBalance: entity['currentBalance'],
        // Story 26.1: forward the allocation mode (default 'automatic'), else a
        // paid-tier sync silently drops it and the server defaults every account.
        allocationMode: entity['allocationMode'] ?? 'automatic',
        // Forward the manual amount ALWAYS, including null. This field's gates are
        // both `.nullable()`, and null is a reachable state:
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
        // Story 45.1 (FR72): forward the "already recorded as an expense" flag.
        // ⚠️ `?? false` is load-bearing, not defensive noise: `JSON.stringify`
        // DROPS an `undefined`-valued key, and `updateEntity` does a PARTIAL
        // `.set()`, so an unstamped row would leave the previous server value in
        // place — the user unticks the box and the change never lands. Coercing
        // to `false` here means the key is always on the wire.
        contributionRecordedAsExpense: entity['contributionRecordedAsExpense'] ?? false,
        // Story 102.1 (FR169): the expense that pays a debt. Emitted
        // UNCONDITIONALLY, as `null` when unlinked: `updateEntity` does a PARTIAL
        // `.set()`, so an omitted key would leave the old link on every other
        // device and an unlink would never land.
        // ⚠️ Only a uuid is forwarded; anything else (a hand-edited localStorage
        // value) becomes `null`. Forwarded unchanged, it would fail the client
        // queue gate's uuid check and drop the WHOLE operation, rename and balance
        // included (the 65.2 `"false"`-string lesson). Every reader already treats
        // such a value as not linked, so `null` loses nothing. The check is the
        // queue gate's own `z.string().uuid()`, so the two cannot disagree.
        paymentExpenseId: UUID_SCHEMA.safeParse(entity['paymentExpenseId']).success
          ? entity['paymentExpenseId']
          : null,
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
      // Story 54.2 (FR78): the chosen avatar emoji.
      //
      // ⚠️ OMITTED when unset, deliberately — the same conditional shape as
      // `description` above, and the opposite of `sortOrder`'s always-send rule.
      // `updateEntity` does a partial `.set()`, so omitting the key leaves the
      // server's value alone, which is exactly right for a profile that has never
      // had an icon chosen. Story 54.2 ships no "clear my icon" affordance, so
      // nothing ever needs to transmit an explicit null; if one is ever added,
      // this condition is what has to change.
      if (entity['icon'] != null) {
        payload['icon'] = entity['icon']
      }
      return payload
    }
    case 'retirementPlan':
      // Story 99.2 (FR161): the account's WHOLE plan, every field, every time (D2;
      // whole-plan last-writer-wins, Q5). Coerced through the same function the
      // store's `merge` uses, so a field the type says exists is always on the
      // wire: `''` (cleared) and `null` (never adopted) survive `JSON.stringify`,
      // where an `undefined` would drop the key. `entity.id` is the user's id (D3).
      // Queued ONLY by `lib/sync/retirementPlanPush.ts` (story 99.3): user edits and
      // re-sends as `update`, and the first-sign-in seed as `create`.
      return { plan: sanitizePlanStrings(coerceRetirementPlan(entity['plan'])), userId }
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
 *
 * `options.dependsOn` names an op this update only makes sense after (story
 * 76.2): if a pull drops that op by last-writer-wins, it drops this one too.
 */
export function syncEntityUpdate(
  entityType: SyncEntityType,
  entity: ClientEntity,
  previous?: ClientEntity,
  options: { dependsOn?: SyncOperation['dependsOn'] } = {}
): void {
  const queued = enqueueUpdate(entityType, entity, previous, options)
  if (queued) {
    queued.catch((error) => onQueueError(`update ${entityType}`, error))
  }
}

/**
 * Raw update enqueue: the queue's durable-add promise, or `null` when no paid
 * session is active, WITHOUT swallowing rejections (story 99.3: the retirement
 * plan push must know when the add has settled, and whether it failed).
 */
export function enqueueUpdate(
  entityType: SyncEntityType,
  entity: ClientEntity,
  previous?: ClientEntity,
  options: { dependsOn?: SyncOperation['dependsOn'] } = {}
): Promise<void> | null {
  if (!handle) {
    return null
  }
  const payload = toServerPayload(entityType, entity, handle.userId)
  const baseVersion = toBaseVersion(previous?.updatedAt ?? entity.updatedAt)
  return handle.queueUpdate(
    entityType,
    entity.id,
    payload,
    undefined,
    baseVersion,
    options.dependsOn
  )
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
