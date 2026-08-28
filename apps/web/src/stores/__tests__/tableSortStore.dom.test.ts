/**
 * Persisted column-sort state for the four financial tables (Story 42.1, FR67).
 *
 * ⚠️ WHY THE CORRUPT-PAYLOAD TESTS SEED AT THE **CURRENT** VERSION.
 *
 * `migrate` runs ONLY on a version mismatch. A corrupt blob written at the
 * current version never reaches it and lands straight in state. A corrupt-payload
 * suite that only seeds `version: 0` therefore exercises `migrate` and proves
 * nothing about the path a real corrupt payload takes — which is `merge`, the
 * one hook that runs on EVERY rehydrate. Every coercion case below is asserted
 * at BOTH versions for exactly that reason.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  TABLE_SORT_IDS,
  TABLE_SORT_STORAGE_KEY,
  TABLE_SORT_VERSION,
  type TableSortId,
  useTableSortStore,
} from '../tableSortStore'

/** Seed a raw persisted blob, bypassing the store's own writer. */
function seed(sorts: unknown, version: number = TABLE_SORT_VERSION): void {
  localStorage.setItem(TABLE_SORT_STORAGE_KEY, JSON.stringify({ state: { sorts }, version }))
}

function read(table: TableSortId) {
  return useTableSortStore.getState().sorts[table]
}

const EMPTY = { income: null, expenses: null, savings: null, balance: null }

beforeEach(() => {
  localStorage.clear()
  // zustand stores are module singletons shared across every test file in the
  // process — reset the in-memory state, not just storage.
  useTableSortStore.setState({ sorts: { ...EMPTY } })
  // ⚠️ ORDER MATTERS. `setState` WRITES through the persist path, so the line
  // above re-creates the storage key `localStorage.clear()` just removed. Left
  // as-is, the "absent key" test below rehydrates a PRESENT, valid, empty blob
  // and cannot fail against an absent-path defect. Remove it last.
  localStorage.removeItem(TABLE_SORT_STORAGE_KEY)
})

describe('tableSortStore — defaults and writes', () => {
  it('defaults every table to null (manual order)', () => {
    // FR67 makes "manual order is the default" a RULE rather than something
    // true by construction (story 34.2, decision 4). This is that rule.
    expect(useTableSortStore.getState().sorts).toEqual(EMPTY)
  })

  it('exposes exactly the four sortable tables', () => {
    expect([...TABLE_SORT_IDS]).toEqual(['income', 'expenses', 'savings', 'balance'])
  })

  it('setTableSort writes one table and leaves the others alone (AC-4)', () => {
    useTableSortStore.getState().setTableSort('income', { key: 'amount', direction: 'desc' })

    expect(read('income')).toEqual({ key: 'amount', direction: 'desc' })
    // The scoping claim is about the OTHER tables. Asserting only `income`
    // stays green under a single shared key and proves nothing.
    expect(read('expenses')).toBeNull()
    expect(read('savings')).toBeNull()
    expect(read('balance')).toBeNull()
  })

  it('clearTableSort returns one table to manual order without touching the others', () => {
    useTableSortStore.getState().setTableSort('income', { key: 'amount', direction: 'asc' })
    useTableSortStore.getState().setTableSort('expenses', { key: 'name', direction: 'desc' })

    useTableSortStore.getState().clearTableSort('income')

    expect(read('income')).toBeNull()
    expect(read('expenses')).toEqual({ key: 'name', direction: 'desc' })
  })

  it('toggleTableSort cycles none -> asc -> desc -> none (decision 5, unchanged)', () => {
    const { toggleTableSort } = useTableSortStore.getState()

    toggleTableSort('savings', 'target')
    expect(read('savings')).toEqual({ key: 'target', direction: 'asc' })

    toggleTableSort('savings', 'target')
    expect(read('savings')).toEqual({ key: 'target', direction: 'desc' })

    toggleTableSort('savings', 'target')
    expect(read('savings')).toBeNull()
  })

  it('toggleTableSort on a different column restarts at ascending', () => {
    const { toggleTableSort } = useTableSortStore.getState()

    toggleTableSort('balance', 'name')
    toggleTableSort('balance', 'name')
    expect(read('balance')).toEqual({ key: 'name', direction: 'desc' })

    toggleTableSort('balance', 'currentBalance')
    expect(read('balance')).toEqual({ key: 'currentBalance', direction: 'asc' })
  })

  it('persists only the sorts record under the versioned key', () => {
    useTableSortStore.getState().setTableSort('balance', { key: 'type', direction: 'asc' })

    const raw = localStorage.getItem(TABLE_SORT_STORAGE_KEY)
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw as string)

    expect(parsed.version).toBe(TABLE_SORT_VERSION)
    // partialize keeps the payload to just `sorts` — no action functions.
    expect(Object.keys(parsed.state)).toEqual(['sorts'])
    expect(parsed.state.sorts.balance).toEqual({ key: 'type', direction: 'asc' })
  })
})

describe('tableSortStore — rehydrate restores a persisted sort (AC-1)', () => {
  it.each([...TABLE_SORT_IDS])('restores a valid persisted sort for %s', async (table) => {
    seed({ ...EMPTY, [table]: { key: 'name', direction: 'desc' } })

    await useTableSortStore.persist.rehydrate()

    expect(read(table)).toEqual({ key: 'name', direction: 'desc' })
    for (const other of TABLE_SORT_IDS) {
      if (other !== table) {
        expect(read(other), `${other} must not inherit ${table}'s sort`).toBeNull()
      }
    }
  })

  it('restores four independent sorts at once', async () => {
    seed({
      income: { key: 'amount', direction: 'asc' },
      expenses: { key: 'frequency', direction: 'desc' },
      savings: { key: 'progress', direction: 'asc' },
      balance: { key: 'type', direction: 'desc' },
    })

    await useTableSortStore.persist.rehydrate()

    expect(useTableSortStore.getState().sorts).toEqual({
      income: { key: 'amount', direction: 'asc' },
      expenses: { key: 'frequency', direction: 'desc' },
      savings: { key: 'progress', direction: 'asc' },
      balance: { key: 'type', direction: 'desc' },
    })
  })
})

describe('tableSortStore — corrupt, absent and unknown payloads (AC-5)', () => {
  it('an absent key leaves every table in manual order', async () => {
    expect(localStorage.getItem(TABLE_SORT_STORAGE_KEY)).toBeNull()
    // Seed a live sort first, so "still EMPTY afterwards" is a real transition
    // rather than the state `beforeEach` already left behind.
    useTableSortStore.setState({ sorts: { ...EMPTY, income: { key: 'name', direction: 'asc' } } })
    localStorage.removeItem(TABLE_SORT_STORAGE_KEY)

    await expect(useTableSortStore.persist.rehydrate()).resolves.not.toThrow()

    expect(useTableSortStore.getState().sorts).toEqual(EMPTY)
  })

  it('non-JSON in the storage slot does not throw and leaves manual order', async () => {
    localStorage.setItem(TABLE_SORT_STORAGE_KEY, 'not json at all{{{')

    await expect(useTableSortStore.persist.rehydrate()).resolves.not.toThrow()

    expect(useTableSortStore.getState().sorts).toEqual(EMPTY)
  })

  // ⚠️ Every case runs at BOTH versions. At `TABLE_SORT_VERSION` the blob
  // bypasses `migrate` entirely — that is the path a real corrupt payload takes.
  const CORRUPT_CASES: ReadonlyArray<readonly [string, unknown]> = [
    ['sorts is a string', 'income'],
    ['sorts is an array', [{ key: 'name', direction: 'asc' }]],
    ['sorts is null', null],
    ['a slice is a string', { ...EMPTY, income: 'amount' }],
    ['a slice is a number', { ...EMPTY, income: 7 }],
    ['a slice is an array', { ...EMPTY, income: ['amount', 'asc'] }],
    ['a slice has no key', { ...EMPTY, income: { direction: 'asc' } }],
    ['a slice has an empty key', { ...EMPTY, income: { key: '', direction: 'asc' } }],
    ['a slice has a non-string key', { ...EMPTY, income: { key: 3, direction: 'asc' } }],
    ['a slice has no direction', { ...EMPTY, income: { key: 'amount' } }],
    [
      'a slice has an unknown direction',
      { ...EMPTY, income: { key: 'amount', direction: 'sideways' } },
    ],
    ['a slice direction is uppercase', { ...EMPTY, income: { key: 'amount', direction: 'ASC' } }],
  ]

  describe.each([TABLE_SORT_VERSION, 0])('at version %i', (version) => {
    it.each(CORRUPT_CASES)('%s falls back to manual order', async (_label, sorts) => {
      seed(sorts, version)

      await expect(useTableSortStore.persist.rehydrate()).resolves.not.toThrow()

      expect(read('income')).toBeNull()
    })
  })

  it('an unknown table id is dropped and the known tables still load', async () => {
    seed({
      ...EMPTY,
      income: { key: 'amount', direction: 'asc' },
      projections: { key: 'name', direction: 'desc' },
    })

    await useTableSortStore.persist.rehydrate()

    expect(read('income')).toEqual({ key: 'amount', direction: 'asc' })
    expect(Object.keys(useTableSortStore.getState().sorts).sort()).toEqual(
      [...TABLE_SORT_IDS].sort()
    )
  })

  it('an UNKNOWN COLUMN is stored as-is — the hook, not the store, degrades it', async () => {
    // The store cannot know which columns a table has, still less which of them
    // a user's tier can see. It validates SHAPE only. `useTableSort`'s
    // `effectiveState` derivation is what turns an unresolvable key into manual
    // order, and leaving the raw value here is what lets an entitled user's
    // Category sort return when entitlement returns (AC-6).
    seed({ ...EMPTY, income: { key: 'no-such-column', direction: 'asc' } })

    await useTableSortStore.persist.rehydrate()

    expect(read('income')).toEqual({ key: 'no-such-column', direction: 'asc' })
  })

  it('a prototype-polluting key cannot reach the sorts record', async () => {
    localStorage.setItem(
      TABLE_SORT_STORAGE_KEY,
      `{"state":{"sorts":{"__proto__":{"key":"amount","direction":"asc"}}},"version":${TABLE_SORT_VERSION}}`
    )

    await useTableSortStore.persist.rehydrate()

    expect(useTableSortStore.getState().sorts).toEqual(EMPTY)
    expect(({} as Record<string, unknown>).key).toBeUndefined()
  })
})
