/**
 * Apply pulled server changes to the Zustand domain stores (Story 4-18).
 *
 * The core SynchronizationService is transport- and store-agnostic: it emits the
 * applied {@link ServerChange}s via `onChangesPulled`, and THIS web-layer module
 * writes them into the UI stores so pulled data is reflected. Core never imports
 * the stores; the dependency only ever points web → core.
 *
 * Reconciliation is keyed by the entity's uuid id (Story 5-14): every syncable
 * entity now has a client-generatable uuid PK, so a row created on one device
 * carries the SAME id everywhere. Each change is a replace-or-insert by that
 * shared id; a tombstone (`isDeleted: true`) removes the entity locally. This is
 * what eliminates the old client-temp-id ↔ server-serial-id duplicate-on-create
 * gap (DN1): there is no longer a numeric/string id split to bridge.
 *
 * NOTE: the client store item types still model the free-tier `userId` as a
 * number while a pulled row carries a uuid `userId`. That is harmless at runtime
 * (the value is only read back for display/aggregation) and is a separate concern
 * from the id unification this story delivers — out of scope here.
 *
 * ## Validation (Story 66.2, FR103)
 *
 * Every non-tombstone row is validated against its entity schema before it is
 * written; a row that fails is refused and reported instead. ⚠️⚠️ This is the
 * ONLY validation anywhere on the server → client direction. The gate it uses —
 * core's per-entity mirrors — is one of six; the OTHER FIVE
 * (`syncOperationDataSchema`, the server ingest schemas, the syncBridge payload
 * whitelist, the DB columns, the client types) all sit on the PUSH path or at
 * rest, so until 66.2 the authoritative server payload was trusted completely and
 * written in verbatim.
 *
 * ⚠️ Three rules the guard depends on, each with a test that fails if it is
 * broken (`__tests__/server-row-validation.test.ts`):
 *
 *   1. It runs AFTER the tombstone return. A tombstone is rebuilt from a
 *      soft-deleted ROW and carries no meaningful payload; validating one would
 *      stop deletes propagating — silent data resurrection.
 *   2. It supplies a VERDICT ONLY. `change.data` is still written unchanged,
 *      because `z.object` strips undeclared keys and the schemas declare neither
 *      `profileId` nor `sortOrder`.
 *   3. A refusal returns `false`, reusing the existing contract below, so a
 *      rejected row cannot mark a collection touched (triggering a re-sort) nor
 *      set `appliedProfile` (triggering an active-profile reconcile).
 *
 * ⚠️ The pull CURSOR is unaffected and cannot be affected from here: core
 * persists it before calling this module, and the callback returns `void`. That
 * is a deliberate, argued choice — see `__tests__/refused-row-cursor.test.ts`.
 */

import type { ServerChange, SyncEntityType } from '@budget-planner/core'
import {
  balanceTrackingSchema,
  categorySchema,
  expenseSchema,
  incomeSourceSchema,
  savingsGoalSchema,
  userProfileSchema,
} from '@budget-planner/core/sync/types'
import type { ZodTypeAny } from 'zod'
import { useBalanceStore } from '../../stores/balanceStore'
import { useCategoryStore } from '../../stores/categoryStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { useProfileStore } from '../../stores/profileStore'
import { useSavingsStore } from '../../stores/savingsStore'
import { stampMissingSortOrder } from '../ordering'
import { cascadeProfileRowRemoval } from '../profile-cascade'

/** Minimal structural view of a Zustand vanilla store used here. */
interface StoreApi {
  getState: () => Record<string, unknown>
  setState: (partial: Record<string, unknown>) => void
}

interface EntityBinding {
  /** The store holding this entity type. */
  store: StoreApi
  /** The state field that holds the entity array. */
  collection: string
  /**
   * The schema a PULLED row must satisfy before it is written (Story 66.2, FR103).
   *
   * These are core's per-entity mirrors. They were declared for parity and, until
   * this story, imported by no PRODUCTION code (one spec already reached
   * `expenseSchema` through a dynamic `await import` — the story first recorded
   * the stronger "nothing", and its review corrected it); every other sync gate
   * (`syncOperationDataSchema`, the server ingest schemas, the syncBridge
   * whitelist) sits on the PUSH path or at rest, so before 66.2 no validation of
   * any kind ran on the server → client direction.
   *
   * ⚠️ Why these and not `syncOperationDataSchema`: that schema models a PARTIAL
   * operation payload — every field is `.optional()`, so it accepts `{}`. It
   * cannot express "this row is complete", which is exactly what a pulled row
   * has to be. See `packages/core/src/sync/types.ts` for the full note.
   */
  schema: ZodTypeAny
}

/**
 * Map each syncable entity type to its store + collection. Every entity id is a
 * uuid string now (Story 5-14), so no per-entity id-kind flag is needed.
 */
const ENTITY_BINDINGS: Record<SyncEntityType, EntityBinding> = {
  incomeSource: {
    store: useIncomeStore as unknown as StoreApi,
    collection: 'incomeSources',
    schema: incomeSourceSchema,
  },
  expense: {
    store: useExpenseStore as unknown as StoreApi,
    collection: 'expenses',
    schema: expenseSchema,
  },
  savingsGoal: {
    store: useSavingsStore as unknown as StoreApi,
    collection: 'savingsGoals',
    schema: savingsGoalSchema,
  },
  balanceTracking: {
    store: useBalanceStore as unknown as StoreApi,
    collection: 'entries',
    schema: balanceTrackingSchema,
  },
  userProfile: {
    store: useProfileStore as unknown as StoreApi,
    collection: 'profiles',
    schema: userProfileSchema,
  },
  category: {
    store: useCategoryStore as unknown as StoreApi,
    collection: 'categories',
    schema: categorySchema,
  },
}

/**
 * Apply a single pulled change to its store: remove on tombstone, otherwise
 * replace-or-insert by the shared uuid id.
 */
function applyOne(change: ServerChange): boolean {
  const binding = ENTITY_BINDINGS[change.entityType]
  if (!binding) {
    // Unknown entity type — ignore defensively rather than throw (a future
    // server-side type should not crash an older client).
    return false
  }

  const { store, collection } = binding
  const id = change.entityId

  // Defensive guard (Story 5-14 review P3): a change with a missing/empty id can
  // neither be matched (to replace/tombstone) nor safely inserted — `{ id: '' }`
  // would be an orphan that no later change can ever target. Skip it rather than
  // corrupt the store. (Replaces the old numeric NaN guard, which is now moot.)
  if (!id) {
    // ⚠️ Reported like any other refusal (code review 66.2): this path returned
    // silently, so a row dropped for a missing id was invisible while a row
    // dropped for a bad amount was not — an inconsistency in the one channel
    // AC-5 asked for. `entityId` is the empty string here, so nothing
    // identifying is lost by naming it.
    reportRefusedRow(change, [{ path: ['entityId'], code: 'too_small' }])
    return false
  }

  const state = store.getState()
  // Element type carries an explicit `id` (alongside the open record) so the
  // filter below uses real property access — not an index-signature lookup,
  // which would trip both TS4111 and Biome's literal-keys rule.
  const current = (state[collection] as (Record<string, unknown> & { id: string })[]) ?? []

  // Remove any existing row with this id (the "replace" half of upsert, and the
  // whole job for a tombstone).
  const without = current.filter((item) => item.id !== id)

  if (change.isDeleted) {
    store.setState({ [collection]: without })
    // ⚠️⚠️ A PULLED profile tombstone cascades locally too (story 66.3, AC-8).
    //
    // Without this, the SECOND device is where the defect survives the fix. The
    // device that pressed Delete cascades in `profileStore.removeProfile`, and
    // the server cascades in `deleteProfileWithChildren` — but every OTHER device
    // only ever sees this tombstone, because `getSyncChanges` filters each child
    // table by the CLIENT's active `profileId` (strict equality,
    // `server/api/sync.ts:getSyncChanges`). A device sitting on a different
    // profile therefore NEVER pulls the child tombstones, and once the profile
    // row is gone it can never make that profile active to ask for them: the rows
    // would sit in its localStorage permanently, invisible only because
    // `scopeToActiveProfile` hides them.
    //
    // So the tombstone is treated as the instruction it is — "this profile is
    // gone" — and the same strict-equality cascade runs against local state. No
    // child tombstones are needed, and none are pulled.
    if (change.entityType === 'userProfile') {
      // ⚠⚠ GUARDED, and the guard is not defensive padding (code review). The
      // cascade writes FIVE persisted stores in a loop, and zustand's
      // `createJSONStorage` does not wrap `setItem`, so a QuotaExceededError or a
      // Safari-private SecurityError propagates out of `setState`. Unguarded, that
      // throw escaped before `return true`, the batch loop's bare `catch` swallowed
      // it, `appliedProfile` stayed FALSE and `reconcileActiveProfile` never ran —
      // leaving stores 1..k cleared, k+1..5 intact, the profile row already gone
      // and `activeProfileId` pointing at a profile that no longer exists, which
      // `scopeToActiveProfile` then renders as an empty app. The pull cursor is
      // persisted BEFORE the applier runs (`synchronization.ts:1631` then `:1635`),
      // so the tombstone is never redelivered and nothing retries.
      //
      // Reporting the tombstone as applied is the right call even on failure: the
      // profile row IS gone from the store above, so the active-profile repoint
      // must happen regardless of how far the row cascade got.
      try {
        cascadeProfileRowRemoval(id)
      } catch (error) {
        console.error('[applyServerChanges] profile cascade failed', error)
      }
    }
    return true
  }

  // ⚠️⚠️ Validate the server row BEFORE it enters the store (Story 66.2, FR103).
  //
  // Placed here deliberately — AFTER the `!id` guard and AFTER the tombstone
  // return above. A tombstone is reconstructed from a soft-deleted ROW and is not
  // required to carry a well-formed payload; validating one would stop deletes
  // propagating across devices, which is a silent data-resurrection bug.
  //
  // ⚠️ The failure this stops is NOT a crash. A persisted STRING amount makes `+`
  // a CONCATENATION, so the totals come out large, finite and entirely plausible
  // with no `NaN` to flag them: `stores/savingsStore.ts` and
  // `stores/balanceStore.ts` both sum raw persisted rows, and `useNetWorth` feeds
  // the result straight to `netWorthFromTotals`. A finiteness check is not enough
  // — the guard has to test `typeof === 'number'`, which `z.number()` does.
  // (deferred-work.md:1031.)
  const validation = binding.schema.safeParse(change.data)
  if (!validation.success) {
    reportRefusedRow(change, validation.error.issues)
    return false
  }

  // Insert the authoritative server row keyed by its shared uuid id. Deliberately
  // NOT profile-scoped (story 54.4): the server row carries its own `profileId`,
  // and reads — not writes — decide what is visible under the active profile.
  //
  // ⚠️⚠️ `change.data` is written UNCHANGED — the schema above supplies a VERDICT
  // and nothing else. `z.object` STRIPS undeclared keys, and the entity schemas
  // declare none of `profileId`, `sortOrder`, `categoryId`, `isDeleted`,
  // `createdAt` or `updatedAt`. Writing `safeParse().data` instead would delete
  // every synced row's profile scope (story 54.4) and its display position
  // (story 34.1a) on the very next pull. Pinned by
  // `__tests__/server-row-validation.test.ts`.
  const entity = { ...change.data, id }
  store.setState({ [collection]: [...without, entity] })
  return true
}

/**
 * Report a server row that failed validation (Story 66.2, AC-5).
 *
 * ⚠️⚠️ This is a DEVELOPER channel and the story says so rather than pretending
 * otherwise. There is no sync-status UI in this product: the whole of
 * `useSync`'s return — `lastError`, `conflictCount`, `failedCount` — is consumed
 * by `components/sync/ActiveSync.tsx`, which renders `null`. `useProfileError`
 * has no renderer either, and `captureError` no-ops because `initErrorTracking`
 * is called from nowhere. Routing a refusal into any of those would be a THIRD
 * write-only channel, which is exactly what AC-5 forbids. A user-facing surface
 * for "your device and the server disagree" does not exist and building one is
 * out of this story's scope.
 *
 * ⚠️ `console.warn`, matching the established client-side idiom in
 * `syncBridge.ts`'s `onQueueError` — NOT `lib/logger.ts`, which is server-only in
 * practice and statically imports `@budget-planner/config` (dragging it into the
 * client bundle is the 5-12 hazard).
 *
 * ⚠️ The row's VALUES are never logged — only its type, id and the failing field
 * paths. `lib/logger.ts` redacts financial keys by name on the server; a
 * client-side `console.warn` has no redaction pass at all, so money must not be
 * put into the message in the first place. Issue `message` strings are dropped
 * for the same reason: a future zod version or a custom refinement could embed
 * the received value in one.
 */
/** The only part of a zod issue this reporter uses — see the no-values note above. */
interface RefusalIssue {
  path: readonly (string | number)[]
  code: string
}

function reportRefusedRow(change: ServerChange, issues: readonly RefusalIssue[]): void {
  console.warn('[applyServerChanges] refused a malformed server row', {
    entityType: change.entityType,
    entityId: change.entityId,
    fields: issues.map((issue) => `${issue.path.join('.') || '(root)'}:${issue.code}`),
  })
}

/**
 * The entity types that carry an explicit `sortOrder` (Story 34.1a, FR60).
 * `userProfile` and `category` have no user-arrangeable order and are excluded.
 */
const ORDERED_ENTITY_TYPES: ReadonlySet<SyncEntityType> = new Set<SyncEntityType>([
  'incomeSource',
  'expense',
  'savingsGoal',
  'balanceTracking',
])

/**
 * Restore a collection's canonical display order after a pull (Story 34.1a, AC-5).
 *
 * ⚠️ THIS FIXES A LIVE, PRE-EXISTING ORDERING BUG, not just a hypothetical one.
 * {@link applyOne} merges by REMOVE-THEN-APPEND, and nothing here used to re-sort.
 * For income and expenses — whose array order simply IS their display order —
 * that meant a pulled UPDATE to an existing row silently moved that row to the
 * BOTTOM of the user's list, on every pull. For savings and balances it left the
 * array in raw append order, contradicting the ordering the same store enforced
 * on every local edit.
 *
 * Without this step `sortOrder` would be persisted correctly and then ignored on
 * the very next pull — the field would look right in storage and wrong on screen.
 */
function resortCollection(entityType: SyncEntityType): void {
  const binding = ENTITY_BINDINGS[entityType]
  if (!binding) {
    return
  }
  const { store, collection } = binding
  const current =
    (store.getState()[collection] as (Record<string, unknown> & { id: string })[]) ?? []
  // `stampMissingSortOrder` sorts AND gives a position to any row that arrived
  // without one — which every server row does until migration 0013 is applied.
  // Without the stamping half, a list of unpositioned pulled rows makes the next
  // locally-added row land at the TOP (code review 34.1a; see the helper's note).
  store.setState({ [collection]: stampMissingSortOrder(current) })
}

/**
 * After a pull that delivered profiles, make sure the active profile points at a
 * REAL (server-backed) profile (Story 5-15). A paid client starts with a
 * locally-generated default-profile placeholder (`userId === ''`, never synced);
 * once the server's profiles arrive, profile-scoped push/pull must be stamped with
 * a profile id that actually exists server-side, not that placeholder.
 *
 * Server-backed profiles are identified by a non-empty `userId`. When real
 * profiles exist we (1) drop the un-synced bootstrap placeholder(s) so the
 * switcher doesn't show a phantom "Main Profile", and (2) repoint `activeProfileId`
 * to the server's default (or first) profile UNLESS the user is already on a real
 * profile (a deliberate switch is preserved).
 */
function reconcileActiveProfile(): void {
  const state = useProfileStore.getState() as unknown as {
    profiles: { id: string; userId?: string; isDefault?: boolean }[]
    activeProfileId: string | null
    setProfiles: (profiles: { id: string; userId?: string; isDefault?: boolean }[]) => void
    setActiveProfileId: (id: string | null) => void
  }
  const { profiles, activeProfileId } = state
  const realProfiles = profiles.filter((p) => p.userId !== undefined && p.userId !== '')
  if (realProfiles.length === 0) {
    // No server-backed profile pulled yet — leave the free-tier bootstrap alone.
    return
  }

  // Placeholders are identified by ID, not object identity (code review 54.4):
  // `realProfiles` must stay a subset of `profiles` for an identity check to be
  // safe, and a future `.map` would silently re-home a REAL profile's rows.
  const realProfileIds = new Set(realProfiles.map((p) => p.id))
  const droppedPlaceholderIds = new Set(
    profiles.filter((p) => !realProfileIds.has(p.id)).map((p) => p.id)
  )

  const active = realProfiles.find((p) => p.id === activeProfileId)
  // realProfiles is non-empty here (guarded above), so the fallback is defined.
  // An already-real active profile is preserved (a deliberate switch); otherwise
  // repoint to the server's default (or first) profile.
  const target = active ?? realProfiles.find((p) => p.isDefault) ?? realProfiles[0]
  if (!target) {
    return
  }

  // Re-home BEFORE dropping the placeholders (code review 54.4). If a store write
  // throws partway (e.g. a localStorage quota error), the placeholders are still
  // in the list, so the next reconcile recomputes the same set and finishes the
  // job; dropping first would leave the un-re-homed rows hidden for good.
  rehomePlaceholderRows(droppedPlaceholderIds, target.id)

  // Drop un-synced bootstrap placeholders now that real profiles exist (keeps the
  // profile list authoritative). setProfiles repoints active to the first entry,
  // so we re-assert the intended active id immediately after.
  if (realProfiles.length !== profiles.length) {
    state.setProfiles(realProfiles)
  }
  state.setActiveProfileId(target.id)
}

/**
 * Move rows stamped with a dropped bootstrap placeholder onto the profile that is
 * now active (story 54.4, FR79, AC-6).
 *
 * ⚠️ WHY. Reads are profile-scoped, and every locally-created row is stamped with
 * the active profile at create time. A paid device's first rows can therefore
 * carry the LOCAL placeholder's id — which {@link reconcileActiveProfile} is about
 * to delete — so without this they would vanish from the screen until a seed push
 * and a pull round-tripped them back with the server's id. The target matches
 * where the server receives them: seeded ops carry the post-reconcile
 * `config.profileId` (`ActiveSync.tsx`).
 *
 * A plain `setState`, deliberately NOT the stores' `update*` actions: this is a
 * local re-labelling to the id the server will assign anyway, and routing it
 * through the actions would enqueue a sync update per row.
 *
 * Categories are included: they were the first profile-stamped store and had the
 * same latent disappearance on the placeholder → server transition.
 */
function rehomePlaceholderRows(placeholderIds: ReadonlySet<string>, targetId: string): void {
  if (placeholderIds.size === 0) {
    return
  }
  const bindings = Object.values(ENTITY_BINDINGS).filter(
    (binding) => binding.collection !== 'profiles'
  )
  for (const { store, collection } of bindings) {
    const current = (store.getState()[collection] as Record<string, unknown>[] | undefined) ?? []
    let changed = false
    const next = current.map((row) => {
      const profileId = row['profileId']
      if (typeof profileId === 'string' && placeholderIds.has(profileId)) {
        changed = true
        return { ...row, profileId: targetId }
      }
      return row
    })
    if (changed) {
      store.setState({ [collection]: next })
    }
  }
}

/**
 * Apply a batch of pulled server changes to the domain stores. Safe to call with
 * an empty array (no-op). Each change is applied independently so one malformed
 * change cannot block the rest.
 */
export function applyServerChangesToStores(changes: ServerChange[]): void {
  let appliedProfile = false
  // Story 34.1a: which ordered collections this batch actually touched.
  const touchedOrdered = new Set<SyncEntityType>()
  for (const change of changes) {
    try {
      const applied = applyOne(change)
      if (!applied) {
        // Skipped defensively (unknown entity type, or a change with no id).
        // Must NOT count as touched, or a batch that changed nothing still
        // triggers a re-sort and the comment below would be false.
        continue
      }
      if (change.entityType === 'userProfile') {
        appliedProfile = true
      }
      if (ORDERED_ENTITY_TYPES.has(change.entityType)) {
        touchedOrdered.add(change.entityType)
      }
    } catch {
      // Never let one bad change abort the batch; the next pull will retry.
    }
  }

  // Story 34.1a (AC-5): re-sort ONCE per touched collection, after the whole loop.
  // Deliberately not inside `applyOne` — that would be O(n²) across a large pull,
  // and it would also obscure which collections were genuinely touched.
  for (const entityType of touchedOrdered) {
    try {
      resortCollection(entityType)
    } catch {
      // A re-sort failure must not discard changes that were applied successfully.
    }
  }
  // Only touch the active-profile pointer when profiles actually changed, so an
  // ordinary income/expense pull never perturbs the user's selected profile.
  if (appliedProfile) {
    try {
      reconcileActiveProfile()
    } catch {
      // Reconciliation is best-effort; a failure here must not drop the changes.
    }
  }
}
