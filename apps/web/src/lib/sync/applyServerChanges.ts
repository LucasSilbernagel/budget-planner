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
 */

import type { ServerChange, SyncEntityType } from '@budget-planner/core'
import { useBalanceStore } from '../../stores/balanceStore'
import { useCategoryStore } from '../../stores/categoryStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { useProfileStore } from '../../stores/profileStore'
import { useSavingsStore } from '../../stores/savingsStore'
import { stampMissingSortOrder } from '../ordering'

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
  incomeSource: { store: useIncomeStore as unknown as StoreApi, collection: 'incomeSources' },
  expense: { store: useExpenseStore as unknown as StoreApi, collection: 'expenses' },
  savingsGoal: { store: useSavingsStore as unknown as StoreApi, collection: 'savingsGoals' },
  balanceTracking: { store: useBalanceStore as unknown as StoreApi, collection: 'entries' },
  userProfile: { store: useProfileStore as unknown as StoreApi, collection: 'profiles' },
  category: { store: useCategoryStore as unknown as StoreApi, collection: 'categories' },
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
    return true
  }

  // Insert the authoritative server row keyed by its shared uuid id.
  const entity = { ...change.data, id }
  store.setState({ [collection]: [...without, entity] })
  return true
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

  // Drop un-synced bootstrap placeholders now that real profiles exist (keeps the
  // profile list authoritative). setProfiles repoints active to the first entry,
  // so we re-assert the intended active id immediately after.
  if (realProfiles.length !== profiles.length) {
    state.setProfiles(realProfiles)
  }

  const active = realProfiles.find((p) => p.id === activeProfileId)
  if (active) {
    // User is already on a real profile — preserve their selection.
    state.setActiveProfileId(active.id)
    return
  }
  // realProfiles is non-empty here (guarded above), so the fallback is defined.
  const target = realProfiles.find((p) => p.isDefault) ?? realProfiles[0]
  if (target) {
    state.setActiveProfileId(target.id)
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
