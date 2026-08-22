import { calculateTotalMonthlyNormalized } from '@budget-planner/core'
import type { Frequency } from '@budget-planner/db'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  type RowMoveDirection,
  applyRowMove,
  backfillSortOrder,
  nextSortOrder,
  sortByDisplayOrder,
} from '../lib/ordering'
import { countUnreadableRows, toNormalizableItems } from '../lib/readable-rows'
import { syncEntityCreate, syncEntityDelete, syncEntityUpdate } from '../lib/sync/syncBridge'
import { generateUUID, withUuidIds } from '../lib/uuid'

// Client-side type for expense (with string timestamps for localStorage)
// For free tier without auth, userId defaults to 0
interface ClientExpense {
  // Client-generatable uuid PK (Story 5-14): the row carries the SAME id on every
  // device, so a server pull reconciles by this id with no duplicates. Replaces
  // the old negative-integer temp id.
  id: string
  userId: number
  name: string
  amount: number
  frequency: Frequency
  // User-defined category (Story 30.4a, FR54). NULL/absent = uncategorized,
  // which is a permanently valid state — no form gains a required field.
  categoryId: string | null
  // Explicit display order (Story 34.1a, FR60). Zero-based integer assigned by the
  // store as max+1 on insert; the server never computes or reshuffles it. NOT
  // contiguous — deletes leave gaps on purpose, so this is an ORDER, not an index.
  //
  // ⚠️ OPTIONAL for the same structural reason as core's ClientSavingsGoal: the
  // `toClientExpense` factory below is a pure function of its input with no access
  // to the list, so it cannot compute a position (story 34.1a §2). A store that
  // forgot to stamp it is therefore NOT a compile error — the store tests pin
  // insert-at-bottom for each of the four lists individually instead.
  sortOrder?: number
  createdAt: string // ISO string for localStorage serialization
  updatedAt: string // ISO string for localStorage serialization
}

interface ClientNewExpense {
  userId?: number // Optional for free tier (no auth yet)
  name: string
  amount: number
  frequency: Frequency
  categoryId?: string | null
}

// Define the type for our store state
interface ExpenseState {
  expenses: ClientExpense[]
  addExpense: (expense: ClientNewExpense) => void
  updateExpense: (id: string, updates: Partial<ClientNewExpense>) => void
  /**
   * Move a row one place up or down (Story 34.1b, FR60). Takes a direction, not
   * a position: `sortOrder` is absent from `ClientNewExpense`, so a reorder
   * cannot be expressed through `updateExpense`, and the caller has no business
   * knowing the numbering scheme. A boundary move is a silent no-op.
   */
  moveExpense: (id: string, direction: RowMoveDirection) => void
  deleteExpense: (id: string) => void
  getExpenseById: (id: string) => ClientExpense | undefined
  getExpensesByFrequency: (frequency: Frequency) => ClientExpense[]
  /** Monthly-normalized cents (story 32.1) — denormalize for display. */
  getTotalExpenses: () => number
  /** Rows excluded from `getTotalExpenses` because core could not read them. */
  getUnreadableExpenseCount: () => number
}

// Convert ClientNewExpense to ClientExpense (add id, userId, and timestamps as ISO strings)
// For free tier without auth, userId defaults to 0. The id is a client-generated
// uuid (Story 5-14) so an offline-created row keeps the SAME id once synced.
const toClientExpense = (newExpense: ClientNewExpense): ClientExpense => ({
  ...newExpense,
  // Explicitly null rather than undefined so the persisted shape matches the
  // v2 migration's backfill and the sync payload never carries `undefined`.
  categoryId: newExpense.categoryId ?? null,
  userId: newExpense.userId ?? 0, // Default to 0 for free tier (no auth)
  id: generateUUID(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})

/**
 * ⚠️ PURE DERIVATIONS — READ BEFORE ADDING A SELECTOR HOOK BELOW (story 38.1, BUG-F).
 *
 * These take the rows array as an ARGUMENT and are shared by the store methods and
 * the selector hooks, so the two can never drift.
 *
 * A selector hook must call one of these with `state.expenses`. It must NOT call the
 * equivalent store METHOD. React hands a selector the server snapshot during
 * hydration (zustand passes `getInitialState` as `getServerSnapshot`), but that
 * snapshot's methods still close over `get()` and return LIVE state — so a
 * `useStore((s) => s.getTotalExpenses())` selector reads rehydrated data while the server
 * rendered the default, and React discards the tree. Measured on six routes, in dev
 * and in a production build (React #418).
 *
 * The methods stay: `getState().getTotalExpenses()` callers outside React are unaffected by
 * hydration and read live state on purpose.
 *
 * ⚠️ `totalExpenseFrom` MUST return a `number`. It is called inside a zustand
 * selector, and a selector returning a fresh object or array fails v4's `Object.is`
 * check on every store update.
 *
 * ⚠️ CORRECTED IN CODE REVIEW: the sentence this replaces (inherited from the
 * pre-existing `getTotalIncome` docblock) said such a return would "spin an
 * infinite re-render loop". That is **not** true of zustand 4.5.7, which builds on
 * `useSyncExternalStoreWithSelector` (`zustand/esm/index.mjs:4,7,17`) and memoises
 * the selection per snapshot — the real cost is one extra re-render per update.
 * The infinite-loop failure mode belongs to a bare `useSyncExternalStore` with an
 * uncached `getSnapshot`. Kept accurate rather than scary, because a maintainer
 * upgrading to v5 needs to know where the hazard actually lives.
 */
function totalExpenseFrom(rows: readonly ClientExpense[]): number {
  return calculateTotalMonthlyNormalized(toNormalizableItems(rows))
}

function expensesByFrequencyFrom(
  rows: readonly ClientExpense[],
  frequency: Frequency
): ClientExpense[] {
  return rows.filter((row) => row.frequency === frequency)
}

function unreadableExpenseCountFrom(rows: readonly ClientExpense[]): number {
  return countUnreadableRows(rows)
}
export const useExpenseStore = create<ExpenseState>()(
  persist(
    (set, get) => ({
      // Initial state
      expenses: [],

      // Add a new expense
      addExpense: (newExpense) => {
        // Story 34.1a: the position is max+1 over the CURRENT list, so it must be
        // computed here (the factory has no list access) and BEFORE the set().
        const expense: ClientExpense = {
          ...toClientExpense(newExpense),
          sortOrder: nextSortOrder(get().expenses),
        }
        set((state) => ({
          expenses: sortByDisplayOrder([...state.expenses, expense]),
        }))
        // Paid tier: also push to the server (no-op for the free tier).
        syncEntityCreate('expense', expense)
      },

      // Update an existing expense
      updateExpense: (id, updates) => {
        const previous = get().expenses.find((expense) => expense.id === id)
        if (!previous) {
          return
        }
        const updated = { ...previous, ...updates, updatedAt: new Date().toISOString() }
        set((state) => ({
          // Story 34.1a (AC-7): re-sort on update too, so `sortOrder` is the single
          // ordering authority at every write path. Today an in-place map would
          // preserve position anyway; keeping the collection canonically sorted is
          // what lets 34.1b change a row's position through this same path.
          expenses: sortByDisplayOrder(
            state.expenses.map((expense) => (expense.id === id ? updated : expense))
          ),
        }))
        // Paid tier: queue the update with the pre-edit row as the baseVersion.
        syncEntityUpdate('expense', updated, previous)
      },

      // Move a row one place up or down (Story 34.1b)
      moveExpense: (id, direction) => {
        const result = applyRowMove(get().expenses, id, direction)
        if (!result) {
          // Boundary, unknown id, or empty list: change nothing, queue nothing.
          return
        }
        set(() => ({ expenses: result.rows }))
        // One update per affected row. Both are queued in the SAME synchronous
        // turn, which is why SyncQueue.add had to be made re-entrancy safe —
        // before that fix the second enqueue clobbered the first and half of
        // every reorder was silently lost on the paid tier.
        for (const { previous, updated } of result.changes) {
          syncEntityUpdate('expense', updated, previous)
        }
      },

      // Delete an expense
      deleteExpense: (id) => {
        const existing = get().expenses.find((expense) => expense.id === id)
        set((state) => ({
          expenses: state.expenses.filter((expense) => expense.id !== id),
        }))
        // Paid tier: queue a tombstone so the delete propagates to other devices.
        if (existing) {
          syncEntityDelete('expense', existing)
        }
      },

      // Get expense by ID
      getExpenseById: (id) => {
        return get().expenses.find((expense) => expense.id === id)
      },

      // Get expenses filtered by frequency
      getExpensesByFrequency: (frequency) => {
        return expensesByFrequencyFrom(get().expenses, frequency)
      },

      /**
       * Total expenses as MONTHLY-NORMALIZED cents (story 32.1, FR58).
       *
       * See `incomeStore.getTotalIncome` for the full rationale — this is the
       * expenses half of the same defect: a raw `reduce` added a weekly $50 to a
       * monthly $900 as if the units matched. Delegating to core makes it equal
       * to the Overview's `calculateNetIncomeResult(...).totalExpenses` by
       * construction.
       *
       * ⚠️ Returns MONTHLY cents — denormalize for display. ⚠️ MUST stay a
       * `number` (called inside the `useTotalExpenses` selector).
       */
      getTotalExpenses: () => {
        return totalExpenseFrom(get().expenses)
      },

      /**
       * How many persisted rows `getTotalExpenses` had to exclude because core
       * could not read them. Surfaced in the UI so the omission is disclosed
       * rather than silently under-reported.
       */
      getUnreadableExpenseCount: () => {
        return unreadableExpenseCountFrom(get().expenses)
      },
    }),
    {
      name: 'budget-planner-expenses-v1',
      // SSR-safe: defer the localStorage read until client-side rehydration (see lib/store-hydration)
      skipHydration: true,
      // v1 (Story 5-14): entity ids became uuid strings — convert any legacy
      // negative-integer ids persisted under v0 to fresh uuids so they don't
      // break sync push (uuid column) / pull reconciliation.
      // v2 (Story 30.4a): backfill `categoryId: null` so a row written before
      // categories existed is explicitly uncategorized rather than carrying an
      // absent key. Both steps run for a v0/v1 payload.
      //
      // ⚠️ `migrate` runs on ANY version MISMATCH, not only on an upgrade
      // (correction by code review 30.4a — the previous comment claimed
      // "only ... BELOW version", which is false). zustand 4.5.7 gates on
      // `deserializedStorageValue.version !== options.version`, so a payload
      // written by a NEWER build (a downgrade) is put through this same function.
      // Both steps here are idempotent, which is the only reason that is safe
      // today — a future v3 must not assume it is only ever called upward.
      // Note also that when `version` is absent or non-numeric zustand skips
      // `migrate` entirely and uses the raw state, so `categoryId` stays
      // undefined rather than null on such a payload.
      //
      // ⚠️ The persist KEY is unchanged. The `-v1` suffix in the name is part of
      // the storage key, NOT the numeric `version` — renaming it would orphan
      // every existing row instead of migrating it (see profileStore's note).
      // v3 (Story 34.1a, FR60): backfill an explicit `sortOrder` — dense 0..n-1
      // assigned by createdAt ASC with id ASC as the tiebreaker.
      //
      // ⚠️ SCOPE OF THE "same rule as the SQL" CLAIM, narrowed by code review 34.1a.
      // The SQL in migrations/0013_purple_retro_girl.sql numbers
      // `PARTITION BY "userId","profileId"`; this backfill numbers the whole
      // persisted array with NO partition. The two therefore agree only for a
      // SINGLE-PROFILE array — which is the only coherent state, since this array is
      // rendered as one list and a multi-profile array would already be showing the
      // user two profiles' rows interleaved.
      //
      // That multi-profile state IS currently reachable: pulled rows carry
      // `profileId` (getSyncChanges sends whole rows) and `switchProfile` does not
      // clear these arrays. That is a PRE-EXISTING defect, logged in
      // deferred-work.md; fixing it makes every array single-profile by
      // construction and makes the two rules identical without any partition logic
      // here. Do not add partitioning to this function — it would encode agreement
      // with the SQL for a state in which the list is already wrong on screen.
      version: 3,
      migrate: (persisted) => {
        const state = persisted as { expenses?: unknown }
        // ⚠️ Sanitize BEFORE anything dereferences a row (code review 30.4a).
        // The persisted array is untrusted JSON, not `ClientExpense[]` — the cast
        // asserts a shape nobody verified. A single null/non-object entry
        // (truncated write, hand-edited storage, an older bug) made both
        // `withUuidIds`' `item.id` and the `categoryId` backfill throw, and a
        // throwing `migrate` fails rehydration entirely: the store keeps its
        // empty default and the user's whole expense list silently disappears.
        // `withUuidIds` must therefore receive an already-clean array.
        const raw = Array.isArray(state?.expenses) ? state.expenses : []
        const rows = raw.filter(
          (row): row is ClientExpense => typeof row === 'object' && row !== null
        )
        return {
          // v3 backfill runs LAST, over rows that already have their uuid ids —
          // the `id` tiebreaker must see the final ids, not the legacy ones it
          // would otherwise sort by and then discard.
          expenses: backfillSortOrder(
            withUuidIds(rows).map((row) => ({
              ...row,
              categoryId: row.categoryId ?? null,
            }))
          ),
        }
      },
      partialize: (state) => ({
        expenses: state.expenses,
      }),
    }
  )
)

// Selector hooks for better performance
export const useExpenses = () => useExpenseStore((state) => state.expenses)

/** Monthly-normalized cents (story 32.1) — denormalize before display. */
export const useTotalExpenses = () => useExpenseStore((state) => totalExpenseFrom(state.expenses))

export const useUnreadableExpenseCount = () =>
  useExpenseStore((state) => unreadableExpenseCountFrom(state.expenses))

/**
 * ⚠️ Returns a NEW array on every store update, so it fails zustand v4's `Object.is`
 * check and costs one extra re-render per update (not an infinite loop — see the
 * correction above). Pre-existing: the method-selector form it replaced had the
 * identical property. It has no consumers today; adopting it needs an equality fn
 * (`useShallow`) or memoisation at the call site.
 */
export const useExpenseByFrequency = (frequency: Frequency) =>
  useExpenseStore((state) => expensesByFrequencyFrom(state.expenses, frequency))

// Client-side persistence enabled via Zustand persist middleware
// Data persists in localStorage across page refreshes
// Dates are stored as ISO strings for proper serialization
