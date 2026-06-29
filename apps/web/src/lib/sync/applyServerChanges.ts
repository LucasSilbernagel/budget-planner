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

import type { ServerChange, SyncEntityType } from '@budget-planner/core/sync'
import { useBalanceStore } from '../../stores/balanceStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { useProfileStore } from '../../stores/profileStore'
import { useSavingsStore } from '../../stores/savingsStore'

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
}

/**
 * Apply a single pulled change to its store: remove on tombstone, otherwise
 * replace-or-insert by the shared uuid id.
 */
function applyOne(change: ServerChange): void {
  const binding = ENTITY_BINDINGS[change.entityType]
  if (!binding) {
    // Unknown entity type — ignore defensively rather than throw (a future
    // server-side type should not crash an older client).
    return
  }

  const { store, collection } = binding
  const id = change.entityId

  // Defensive guard (Story 5-14 review P3): a change with a missing/empty id can
  // neither be matched (to replace/tombstone) nor safely inserted — `{ id: '' }`
  // would be an orphan that no later change can ever target. Skip it rather than
  // corrupt the store. (Replaces the old numeric NaN guard, which is now moot.)
  if (!id) {
    return
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
    return
  }

  // Insert the authoritative server row keyed by its shared uuid id.
  const entity = { ...change.data, id }
  store.setState({ [collection]: [...without, entity] })
}

/**
 * Apply a batch of pulled server changes to the domain stores. Safe to call with
 * an empty array (no-op). Each change is applied independently so one malformed
 * change cannot block the rest.
 */
export function applyServerChangesToStores(changes: ServerChange[]): void {
  for (const change of changes) {
    try {
      applyOne(change)
    } catch {
      // Never let one bad change abort the batch; the next pull will retry.
    }
  }
}
