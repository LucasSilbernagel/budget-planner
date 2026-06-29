/**
 * Apply pulled server changes to the Zustand domain stores (Story 4-18).
 *
 * The core SynchronizationService is transport- and store-agnostic: it emits the
 * applied {@link ServerChange}s via `onChangesPulled`, and THIS web-layer module
 * writes them into the UI stores so pulled data is reflected. Core never imports
 * the stores; the dependency only ever points web → core.
 *
 * Reconciliation is state-snapshot based (the story's recommended v1): each
 * change is a replace-or-insert keyed by the SERVER id; a tombstone
 * (`isDeleted: true`) removes the entity locally. This sidesteps the
 * client-temp-id ↔ server-serial-id gap (DN1 debt, deferred) by treating the
 * server row as authoritative for cross-device convergence.
 *
 * KNOWN DN1 type debt: the client store item types model the free tier
 * (`userId: number`, negative temp `id`), while pulled rows carry a uuid
 * `userId` and a positive server `id`. At runtime this is harmless (the stored
 * value is only read back for display/aggregation), so the pulled row is written
 * through with its server fields. Unifying the client/server identity types is
 * the deferred DN1 uuid-PK migration — out of scope here.
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
  /** Whether the entity id is a number (serial PK) vs a string (uuid). */
  idIsNumeric: boolean
}

/**
 * Map each syncable entity type to its store + collection + id kind.
 * Kept as a single table so the apply logic below stays generic.
 */
const ENTITY_BINDINGS: Record<SyncEntityType, EntityBinding> = {
  incomeSource: {
    store: useIncomeStore as unknown as StoreApi,
    collection: 'incomeSources',
    idIsNumeric: true,
  },
  expense: {
    store: useExpenseStore as unknown as StoreApi,
    collection: 'expenses',
    idIsNumeric: true,
  },
  savingsGoal: {
    store: useSavingsStore as unknown as StoreApi,
    collection: 'savingsGoals',
    idIsNumeric: true,
  },
  balanceTracking: {
    store: useBalanceStore as unknown as StoreApi,
    collection: 'entries',
    idIsNumeric: true,
  },
  userProfile: {
    store: useProfileStore as unknown as StoreApi,
    collection: 'profiles',
    idIsNumeric: false,
  },
}

/**
 * Apply a single pulled change to its store: remove on tombstone, otherwise
 * replace-or-insert by server id.
 */
function applyOne(change: ServerChange): void {
  const binding = ENTITY_BINDINGS[change.entityType]
  if (!binding) {
    // Unknown entity type — ignore defensively rather than throw (a future
    // server-side type should not crash an older client).
    return
  }

  const { store, collection, idIsNumeric } = binding
  const id: number | string = idIsNumeric ? Number(change.entityId) : change.entityId

  // Guard a non-numeric id for a numeric-id store (review P6): `Number(...)`
  // would yield NaN, `item.id !== NaN` is always true (so a tombstone removes
  // nothing) and an insert would store a `{ id: NaN }` orphan that can never be
  // replaced or removed. Skip the change rather than corrupt the store.
  if (typeof id === 'number' && Number.isNaN(id)) {
    return
  }

  const state = store.getState()
  // Element type carries an explicit `id` (alongside the open record) so the
  // filter below uses real property access — not an index-signature lookup,
  // which would trip both TS4111 and Biome's literal-keys rule.
  const current = (state[collection] as (Record<string, unknown> & { id: number | string })[]) ?? []

  // Remove any existing row with this id (the "replace" half of upsert, and the
  // whole job for a tombstone).
  const without = current.filter((item) => item.id !== id)

  if (change.isDeleted) {
    store.setState({ [collection]: without })
    return
  }

  // Insert the authoritative server row, normalizing the id to the store's kind.
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
