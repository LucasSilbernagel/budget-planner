import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { type SortState, nextSortState } from '../lib/table-sort'

/**
 * Persisted column-sort selection for the four financial tables (Story 42.1, FR67).
 *
 * ## What this stores, and what it deliberately does not
 *
 * One `{ key, direction }` per table, or `null` for the default (unsorted) order.
 * It is a per-device VIEW preference: it never writes `sortOrder` and never
 * enqueues a sync operation. `lib/ordering.ts` still owns the default order, and
 * `lib/table-sort.ts`'s module boundary is unchanged — this store persists which
 * projection to apply, not the underlying order. (Story 48.2 removed the `move*`
 * actions this note used to name; see `lib/table-sort.ts` for the vocabulary.)
 *
 * ## Shape validation only — the store does not know your columns
 *
 * A slice is accepted if it LOOKS like a sort (`key` a non-empty string,
 * `direction` exactly `asc` or `desc`), and rejected otherwise. It cannot judge
 * whether `key` names a column that exists, still less one the user's tier can
 * see: the Category column is Premium-only and its very availability is a
 * runtime entitlement check. Resolving an unavailable column is `useTableSort`'s
 * job, via the `effectiveState` derivation that degrades an unresolvable key to
 * manual order. Storing the raw value here is what lets the sort RETURN when
 * entitlement returns.
 *
 * ## ⚠️ `merge` is the load-bearing coercion, NOT `migrate`
 *
 * `migrate` runs only when the persisted `version` differs from
 * {@link TABLE_SORT_VERSION}. A corrupt blob written at the CURRENT version —
 * a truncated write, hand-edited storage, another build — never reaches it and
 * would land straight in state. `merge` runs on every rehydrate, so it is what
 * actually guarantees the fallback to manual order.
 *
 * `migrate` is kept because it is the seam a future shape change needs, and
 * because a versioned store without one silently reinterprets an old payload.
 * But do not mistake it for the guard: deleting it alone leaves this store's
 * behaviour unchanged today, which is precisely why the corrupt-payload tests
 * seed at BOTH versions rather than trusting either hook alone.
 */

/** The four sortable financial tables. There is no fifth: `/balance` renders one
 * table since story 43.1 removed the Investment Accounts breakdown. */
export type TableSortId = 'income' | 'expenses' | 'savings' | 'balance'

/** localStorage key for the persisted per-table sort selection. */
export const TABLE_SORT_STORAGE_KEY = 'budget-planner-table-sort-v1'

/** Persisted payload version. Bumping this routes the old blob through `migrate`. */
export const TABLE_SORT_VERSION = 1

/**
 * The default: every table opens in manual order.
 *
 * ⚠️ THE SINGLE SOURCE OF TRUTH FOR THE VALID TABLE SET. {@link TABLE_SORT_IDS}
 * is DERIVED from these keys rather than written out a second time — the same
 * discipline `overviewDurationStore`'s `VALID_DURATIONS` records, and for the
 * same reason: a hand-written second list accepts a subset without complaint, so
 * adding a table to the union alone would type-check, leave every test green,
 * and make the coercion below silently drop the new table on every rehydrate.
 */
const DEFAULT_SORTS: Record<TableSortId, SortState<string> | null> = {
  income: null,
  expenses: null,
  savings: null,
  balance: null,
}

/** Every table that can carry a persisted sort. Derived — never hand-written. */
export const TABLE_SORT_IDS = Object.keys(DEFAULT_SORTS) as readonly TableSortId[]

interface TableSortStoreState {
  /** The active sort per table; `null` means manual order (FR60). */
  sorts: Record<TableSortId, SortState<string> | null>
  /** Replace one table's sort outright. */
  setTableSort: (table: TableSortId, state: SortState<string> | null) => void
  /** Return one table to manual order. */
  clearTableSort: (table: TableSortId) => void
  /** Advance one table's column through `none -> asc -> desc -> none`. */
  toggleTableSort: (table: TableSortId, key: string) => void
}

/**
 * Accept a persisted slice only if it has the SHAPE of a sort.
 *
 * Anything else — a string, a number, an array, a missing or non-string `key`,
 * an empty `key`, a direction that is not exactly `asc`/`desc` — becomes `null`,
 * i.e. manual order. `'ASC'` is rejected on purpose: nothing in the app writes
 * it, so its presence means the payload came from somewhere that is not this
 * store, and guessing at its intent is how a corrupt blob becomes a live sort.
 */
export function coerceSortState(value: unknown): SortState<string> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const candidate = value as { key?: unknown; direction?: unknown }
  if (typeof candidate.key !== 'string' || candidate.key.length === 0) {
    return null
  }
  if (candidate.direction !== 'asc' && candidate.direction !== 'desc') {
    return null
  }
  return { key: candidate.key, direction: candidate.direction }
}

/**
 * Rebuild the whole record from {@link TABLE_SORT_IDS}, reading each slice
 * defensively.
 *
 * Building FROM the known ids rather than from the payload's own keys is what
 * drops an unknown table id, and the own-property check is what stops a
 * `__proto__` entry in the parsed JSON reaching a slice (`lib/table-sort-keys.ts`
 * records the same discipline for its rank lookup).
 */
export function coerceSorts(value: unknown): Record<TableSortId, SortState<string> | null> {
  const record =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}

  const next = {} as Record<TableSortId, SortState<string> | null>
  for (const id of TABLE_SORT_IDS) {
    // `hasOwnProperty.call`, not `Object.hasOwn`: the app's tsconfig `lib` is
    // below es2022. Not a style choice — `Object.hasOwn` type-checks red here.
    next[id] = Object.prototype.hasOwnProperty.call(record, id) ? coerceSortState(record[id]) : null
  }
  return next
}

export const useTableSortStore = create<TableSortStoreState>()(
  persist(
    (set) => ({
      // Deterministic default, identical on the server and on the first client
      // paint. The persisted selection is applied after client rehydration (see
      // `lib/store-hydration`).
      sorts: { ...DEFAULT_SORTS },

      setTableSort: (table, state) => {
        set((current) => ({ sorts: { ...current.sorts, [table]: state } }))
      },

      clearTableSort: (table) => {
        set((current) => ({ sorts: { ...current.sorts, [table]: null } }))
      },

      toggleTableSort: (table, key) => {
        // The `none -> asc -> desc -> none` cycle stays single-sourced in
        // `lib/table-sort` (story 34.2, decision 5). Moving it here rather than
        // into the hook keeps the hook's `toggle` callback identity stable.
        set((current) => ({
          sorts: { ...current.sorts, [table]: nextSortState(current.sorts[table], key) },
        }))
      },
    }),
    {
      name: TABLE_SORT_STORAGE_KEY,
      // SSR-safe: defer the localStorage read to client-side rehydration (see
      // lib/store-hydration).
      skipHydration: true,
      partialize: (state) => ({ sorts: state.sorts }),
      version: TABLE_SORT_VERSION,
      // The seam for a future shape change. See the module docblock: this is NOT
      // the corrupt-payload guard, because it does not run at the current version.
      migrate: (persisted) => ({
        sorts: coerceSorts((persisted as { sorts?: unknown } | undefined)?.sorts),
      }),
      // Runs on EVERY rehydrate. This is the guard: a corrupt, absent or
      // foreign payload resolves to manual order rather than throwing or
      // leaving a table sorted by something that is not a sort.
      merge: (persisted, current) => ({
        ...current,
        sorts: coerceSorts((persisted as { sorts?: unknown } | undefined)?.sorts),
      }),
    }
  )
)

/**
 * One table's persisted sort.
 *
 * ⚠️ Derives from the state argument and calls no state method — the rule
 * `lib/store-hydration.tsx` records (BUG-F) and
 * `stores/__tests__/no-method-selectors.guard.test.ts` sweeps for.
 */
export const useTableSortSelection = (table: TableSortId) =>
  useTableSortStore((state) => state.sorts[table])

export const useSetTableSort = () => useTableSortStore((state) => state.setTableSort)

export const useClearTableSort = () => useTableSortStore((state) => state.clearTableSort)

export const useToggleTableSort = () => useTableSortStore((state) => state.toggleTableSort)
