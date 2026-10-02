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
 * NOTE: a locally created row carries the free-tier `userId` (`0`) while a pulled
 * row carries the server's uuid `userId`, and so, since story 86.3, does a row
 * whose push the server accepted ({@link stampSyncedOwner}). The value is NOT
 * only cosmetic:
 * `seedLocalData.needsSeeding` compares `String(row.userId ?? '')` with the session
 * uuid to decide whether a row is already server-backed, so a pulled row's uuid is
 * what keeps it from being re-created. Since story 78.2 the income/expense client
 * types say so (`userId: number | string`); before that they claimed `number`
 * alone, and the pull tests that seed realistic rows could not type-check.
 *
 * ## Validation (Story 66.2, FR103; moved into core by story 75.4, FR123)
 *
 * ⚠️⚠️ THIS MODULE NO LONGER VALIDATES AN ENTITY ROW. Core does, in
 * `SynchronizationService.pull()` (`validateServerRow`, over the same per-entity
 * schemas this module used to call), BEFORE the row can win last-writer-wins.
 * It used to happen here, and that was the defect 75.4 closes: core had already
 * removed the user's queued edit by the time this module refused the row, so the
 * edit was lost and nothing ever pushed it.
 *
 * So a row that reaches {@link applyServerChangesToStores} through a pull has
 * already passed. The only other caller is story 75.2's `refusedEdits.ts`, which
 * applies synthetic TOMBSTONES, and tombstones are never validated anywhere. There
 * is deliberately no second check here: one that production could no longer
 * reach, kept green by tests that call this function directly, would be a copy
 * asserted against itself. Pinned by `__tests__/server-row-validation.test.ts`.
 *
 * Core reports what it refused through `onServerChangesRefused`, which
 * `hooks/useSync.ts` wires to {@link reportRefusedServerChanges}, the one reporter.
 *
 * ⚠️ Two guards DO stay in `applyOne`, and neither is a second validator. The
 * `!binding` guard skips an entity type this client does not know (a server newer
 * than the client; not a corrupt row). The `!id` guard refuses a change whose
 * ENVELOPE has an empty `entityId`, which no entity schema declares and which the
 * store write would turn into an untargetable orphan.
 *
 * ⚠️ Two of 66.2's rules still hold, now in core, each with a test:
 *
 *   1. A tombstone is never validated. It is rebuilt from a soft-deleted ROW and
 *      carries no meaningful payload; validating one would stop deletes
 *      propagating — silent data resurrection.
 *   2. The schema supplies a VERDICT ONLY. `change.data` is written here
 *      unchanged, because `z.object` strips undeclared keys and the schemas
 *      declare neither `profileId` nor `sortOrder`.
 *
 * ⚠️ The pull CURSOR advances past a refused row (66.2's decision, re-read in
 * 75.4). It lives in core's in-memory state and is never persisted; core sets it
 * before calling this module, and the callback returns `void`, so nothing here
 * can move it. See `__tests__/refused-row-cursor.test.ts`.
 */

import type { ServerChange, SyncEntityType, SyncOperation } from '@budget-planner/core'
import type { RefusedServerChange } from '@budget-planner/core/sync'
import { useBalanceStore } from '../../stores/balanceStore'
import { useCategoryStore } from '../../stores/categoryStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { useProfileStore } from '../../stores/profileStore'
import { useSavingsStore } from '../../stores/savingsStore'
import { stampMissingSortOrder } from '../ordering'
import { cascadeProfileRowRemoval } from '../profile-cascade'
import { isOwnedByAnotherAccount, isPlaceholderOwner } from './accountOwner'

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
}

/**
 * Map each syncable entity type to its store + collection. Every entity id is a
 * uuid string now (Story 5-14), so no per-entity id-kind flag is needed.
 */
const ENTITY_BINDINGS: Record<SyncEntityType, EntityBinding> = {
  incomeSource: {
    store: useIncomeStore as unknown as StoreApi,
    collection: 'incomeSources',
  },
  expense: {
    store: useExpenseStore as unknown as StoreApi,
    collection: 'expenses',
  },
  savingsGoal: {
    store: useSavingsStore as unknown as StoreApi,
    collection: 'savingsGoals',
  },
  balanceTracking: {
    store: useBalanceStore as unknown as StoreApi,
    collection: 'entries',
  },
  userProfile: {
    store: useProfileStore as unknown as StoreApi,
    collection: 'profiles',
  },
  category: {
    store: useCategoryStore as unknown as StoreApi,
    collection: 'categories',
  },
}

/**
 * Read one local row by entity type and id, through the same store/collection
 * map the applier writes with (story 75.2 — naming a refused entry). Returns
 * `undefined` when the row is not on this device.
 */
export function findLocalRow(
  entityType: SyncEntityType,
  id: string
): Record<string, unknown> | undefined {
  const binding = ENTITY_BINDINGS[entityType]
  if (!binding) {
    return undefined
  }
  const rows = (binding.store.getState()[binding.collection] ?? []) as (Record<string, unknown> & {
    id: string
  })[]
  return rows.find((row) => row.id === id)
}

/**
 * Mark the rows this session pushed as its own, the moment the server accepts
 * them (story 86.3). `hooks/useSync.ts` subscribes it to core's
 * `onOperationsSynced`.
 *
 * A row made in a paid session carries a placeholder owner (`0`, `'temp-user'`
 * or none, `accountOwner.ts`) until a pull replaces it with the server's row, up
 * to one poll interval later. Signing out inside that window used to leave it
 * looking like a free-tier row: the next account on this browser adopted it,
 * landed on a profile it could not write to, and re-uploaded ids another account
 * holds (23505 / "Profile not found", kept queued, for ever).
 *
 * Only `create` and `update` (86.3 D3): an accepted one means the server holds
 * that id under the session's user (both paths are scoped by `userId`
 * server-side). A delete leaves nothing to stamp. A create acknowledged because
 * the id is already tombstoned is stamped too: usually the next pull removes the
 * row, but not when an earlier pull let the queued create win over that
 * tombstone (LWW) and moved the cursor past it. The row then stays on this device
 * with no server row either way, a pre-existing ghost (deferred-work, 86.3
 * review); the stamp only changes which owner it shows.
 *
 * Changes ONLY `userId`, and only on a row that is still here and still carries
 * a placeholder: a row a pull already restamped, or one carrying any other real
 * id, is left alone, and a row deleted locally since is not brought back. A plain
 * `setState`, never a store action, which would queue a sync op per row.
 */
export function stampSyncedOwner(
  operations: readonly SyncOperation[],
  sessionUserId: string
): void {
  const idsByType = new Map<SyncEntityType, Set<string>>()
  for (const operation of operations) {
    if (operation.type !== 'create' && operation.type !== 'update') {
      continue
    }
    // An op queued under another id (a leftover of another session) proves
    // nothing about the session's account.
    if (operation.userId !== sessionUserId) {
      continue
    }
    const ids = idsByType.get(operation.entityType) ?? new Set<string>()
    ids.add(String(operation.entityId))
    idsByType.set(operation.entityType, ids)
  }
  for (const [entityType, ids] of idsByType) {
    const binding = ENTITY_BINDINGS[entityType]
    if (!binding) {
      continue
    }
    const { store, collection } = binding
    try {
      const current = (store.getState()[collection] as Record<string, unknown>[] | undefined) ?? []
      let changed = false
      const next = current.map((row) => {
        const id = row['id']
        if (typeof id === 'string' && ids.has(id) && isPlaceholderOwner(row['userId'])) {
          changed = true
          return { ...row, userId: sessionUserId }
        }
        return row
      })
      if (changed) {
        store.setState({ [collection]: next })
      }
    } catch (error) {
      // One store's write failing (quota) must not stop the others.
      console.error('[stampSyncedOwner] could not mark synced rows', error)
    }
  }
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
  //
  // ⚠️ Kept HERE when entity validation moved into core (story 75.4), and that is
  // not a second validator: this guards the ENVELOPE's id, which no entity schema
  // declares, and the store write below is what an empty id would corrupt. The
  // `!binding` guard above is the same kind of thing: an entity type this client
  // does not know, not a malformed row.
  if (!id) {
    // ⚠️ Reported like any other refusal (code review 66.2): this path returned
    // silently, so a row dropped for a missing id was invisible while a row
    // dropped for a bad amount was not — an inconsistency in the one channel
    // AC-5 asked for. `entityId` is the empty string here, so nothing
    // identifying is lost by naming it.
    reportRefusedRow(change.entityType, change.entityId, ['entityId:too_small'])
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
    //
    // ⚠️ The QUEUE half is not here (story 76.2). The rows' pending edits were
    // dropped by core's `pull()` before this module was called, in the same pass
    // that applied this tombstone (see `isStrandedByDeletedProfile`).
    if (change.entityType === 'userProfile') {
      // ⚠⚠ GUARDED, and the guard is not defensive padding (code review). The
      // cascade writes FIVE persisted stores in a loop, and zustand's
      // `createJSONStorage` does not wrap `setItem`, so a QuotaExceededError or a
      // Safari-private SecurityError propagates out of `setState`. Unguarded, that
      // throw escaped before `return true`, the batch loop's bare `catch` swallowed
      // it, `appliedProfile` stayed FALSE and `reconcileActiveProfile` never ran —
      // leaving stores 1..k cleared, k+1..5 intact, the profile row already gone
      // and `activeProfileId` pointing at a profile that no longer exists, which
      // `scopeToActiveProfile` then renders as an empty app. Core has already
      // advanced the pull cursor past the tombstone before calling this module
      // (`SynchronizationService.pull()`), so it is not redelivered this session
      // and nothing retries.
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

  // ⚠️ NOT validated here (story 75.4): core validated this row before letting it
  // win LWW, and refused it there if it was malformed. See the module docblock.
  //
  // The failure that validation stops is NOT a crash, which is why it must not be
  // lost in a refactor: a persisted STRING amount makes `+` a CONCATENATION, so
  // `stores/savingsStore.ts` and `stores/balanceStore.ts` (which sum raw persisted
  // rows) produce large, finite, plausible totals with no `NaN` to flag them.

  // Insert the authoritative server row keyed by its shared uuid id. Deliberately
  // NOT profile-scoped (story 54.4): the server row carries its own `profileId`,
  // and reads — not writes — decide what is visible under the active profile.
  //
  // ⚠️⚠️ `change.data` is written UNCHANGED — core's schema supplied a VERDICT
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
 * Report a server row that was refused (Story 66.2, AC-5): by core's validation
 * (story 75.4, through {@link reportRefusedServerChanges}) or by the empty-id
 * guard in `applyOne`.
 *
 * ⚠️⚠️ This is a DEVELOPER channel and the story says so rather than pretending
 * otherwise. There is no sync-status UI in this product: the whole of
 * `useSync`'s return — `lastError`, `conflictCount`, `failedCount` — is read by
 * nothing that displays it. `useProfileError` has no renderer either, and
 * `captureError` no-ops because `initErrorTracking` is called from nowhere.
 * Routing a refusal into any of those would be a THIRD write-only channel, which
 * is exactly what AC-5 forbids.
 *
 * ⚠️ Story 75.2 added ONE user-facing surface, and it does NOT cover this path:
 * `components/sync/RefusedEditNotice.tsx` names edits the server refused on the
 * PUSH side. A server row refused on the PULL side still reaches only the
 * console, and the user is not told. Story 75.4 changed what such a refusal
 * COSTS (the user's queued edit now survives it), not who hears about it; a
 * pull-side notice was left as an open product question.
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
 * the received value in one. Core builds `fields` from path and code only
 * (`validateServerRow`), so what arrives here is already value-free.
 */
function reportRefusedRow(entityType: string, entityId: string, fields: readonly string[]): void {
  console.warn('[applyServerChanges] refused a malformed server row', {
    entityType,
    entityId,
    fields: [...fields],
  })
}

/**
 * Report the rows core refused in one pull (story 75.4). `hooks/useSync.ts`
 * subscribes this to `SynchronizationService.onServerChangesRefused`: one
 * `console.warn` per refused row, through the same reporter as the empty-id guard.
 */
export function reportRefusedServerChanges(refused: readonly RefusedServerChange[]): void {
  for (const row of refused) {
    reportRefusedRow(row.entityType, row.entityId, row.fields)
  }
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
 *
 * ⚠️ "Real" means THIS session's (story 86.2, FR140). The profile store is shared
 * by whoever uses the browser, so after A signs out and B signs in it still holds
 * A's profiles, each with A's uuid. Counting them as real kept an active profile
 * of A's as "a deliberate switch", and B's new rows were stamped with A's
 * `profileId`. Another account's profiles are now dropped here like the
 * placeholders, but their rows are NOT re-homed: re-homing would move A's rows
 * into B's profile. (`ActiveSync` removes A's rows and profiles before sync
 * starts; this is the same rule where pulled profiles land.)
 */
function reconcileActiveProfile(sessionUserId: string): void {
  const state = useProfileStore.getState() as unknown as {
    profiles: { id: string; userId?: string; isDefault?: boolean }[]
    activeProfileId: string | null
    setProfiles: (profiles: { id: string; userId?: string; isDefault?: boolean }[]) => void
    setActiveProfileId: (id: string | null) => void
  }
  const { profiles, activeProfileId } = state
  const isPlaceholder = (p: { userId?: string }) => p.userId === undefined || p.userId === ''
  const realProfiles = profiles.filter(
    (p) => !isPlaceholder(p) && !isOwnedByAnotherAccount(p.userId, sessionUserId)
  )
  if (realProfiles.length === 0) {
    // No server-backed profile pulled yet — leave the free-tier bootstrap alone.
    return
  }

  // Placeholders are identified by ID, not object identity (code review 54.4): a
  // future `.map` would silently re-home a REAL profile's rows. Only a
  // PLACEHOLDER's rows are re-homed, never another account's (story 86.2).
  const droppedPlaceholderIds = new Set(profiles.filter(isPlaceholder).map((p) => p.id))

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

  // Drop un-synced bootstrap placeholders, and another account's profiles (story
  // 86.2), now that real profiles exist (keeps the profile list authoritative).
  // setProfiles repoints active to the first entry, so we re-assert the intended
  // active id immediately after.
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
 *
 * `sessionUserId` is the signed-in account (story 86.2): a profile owned by any
 * other account is never made active (`reconcileActiveProfile`). Required, so a
 * new caller cannot forget it.
 */
export function applyServerChangesToStores(changes: ServerChange[], sessionUserId: string): void {
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
      reconcileActiveProfile(sessionUserId)
    } catch {
      // Reconciliation is best-effort; a failure here must not drop the changes.
    }
  }
}
