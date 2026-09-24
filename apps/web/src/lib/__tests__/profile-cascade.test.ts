/**
 * The local profile cascade (story 66.3, FR104, AC-1).
 *
 * ⚠️⚠️ THE TEST THAT MATTERS HERE is the UNSCOPED-row one. The natural instinct
 * — reuse `isInActiveProfile`, the predicate every read already goes through —
 * destroys every pre-54.4 row on the first profile deletion, because that
 * predicate returns TRUE for a null/absent `profileId` BY DESIGN.
 *
 * MUTATION ARM, measured rather than assumed: replacing the strict comparison in
 * `profile-cascade.ts` with `isInActiveProfile(row.profileId, profileId)` turns
 * THREE of these five red — the unscoped-survival test, the count in the
 * five-collection test (5 removed becomes 15) and the owns-nothing no-op (a
 * profile that owns nothing still eats every unscoped row). The two that stay
 * green are the surviving-profile test and the empty-id test, so neither is load
 * bearing for this predicate.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { useBalanceStore } from '../../stores/balanceStore'
import { useCategoryStore } from '../../stores/categoryStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { useSavingsStore } from '../../stores/savingsStore'
import { cascadeProfileRowRemoval, registeredProfileScopedCollections } from '../profile-cascade'

const DOOMED = 'profile-doomed'
const KEEPER = 'profile-keeper'

/**
 * Every store gets the same four rows: one owned by the profile being deleted,
 * one owned by another profile, one with an explicit `null` profileId and one
 * with the key ABSENT entirely. The last two are the pre-54.4 shapes.
 */
function seed() {
  useIncomeStore.setState({
    incomeSources: [
      { id: 'i-doomed', profileId: DOOMED, name: 'Salary', amount: 1, frequency: 'monthly' },
      { id: 'i-keeper', profileId: KEEPER, name: 'Consulting', amount: 2, frequency: 'monthly' },
      { id: 'i-null', profileId: null, name: 'Legacy null', amount: 3, frequency: 'monthly' },
      { id: 'i-absent', name: 'Legacy absent', amount: 4, frequency: 'monthly' },
    ],
  } as never)
  useExpenseStore.setState({
    expenses: [
      { id: 'e-doomed', profileId: DOOMED, name: 'Rent', amount: 1, frequency: 'monthly' },
      { id: 'e-keeper', profileId: KEEPER, name: 'Office', amount: 2, frequency: 'monthly' },
      { id: 'e-null', profileId: null, name: 'Legacy null', amount: 3, frequency: 'monthly' },
      { id: 'e-absent', name: 'Legacy absent', amount: 4, frequency: 'monthly' },
    ],
  } as never)
  useSavingsStore.setState({
    savingsGoals: [
      { id: 's-doomed', profileId: DOOMED, name: 'Car', targetAmount: 1, currentBalance: 0 },
      { id: 's-keeper', profileId: KEEPER, name: 'Van', targetAmount: 2, currentBalance: 0 },
      { id: 's-null', profileId: null, name: 'Legacy null', targetAmount: 3, currentBalance: 0 },
      { id: 's-absent', name: 'Legacy absent', targetAmount: 4, currentBalance: 0 },
    ],
  } as never)
  useBalanceStore.setState({
    // ⚠️ `entries`, not `balanceTracking` — the store key and the sync entity
    // type disagree, and the entity name here would be a silent no-op.
    entries: [
      { id: 'b-doomed', profileId: DOOMED, name: 'ISA', type: 'investment', currentBalance: 1 },
      { id: 'b-keeper', profileId: KEEPER, name: 'Loan', type: 'debt', currentBalance: 2 },
      { id: 'b-null', profileId: null, name: 'Legacy null', type: 'debt', currentBalance: 3 },
      { id: 'b-absent', name: 'Legacy absent', type: 'debt', currentBalance: 4 },
    ],
  } as never)
  useCategoryStore.setState({
    categories: [
      { id: 'c-doomed', profileId: DOOMED, name: 'Bills', kind: 'expense', isDeleted: false },
      { id: 'c-keeper', profileId: KEEPER, name: 'Travel', kind: 'expense', isDeleted: false },
      { id: 'c-null', profileId: null, name: 'Legacy null', kind: 'expense', isDeleted: false },
      { id: 'c-absent', name: 'Legacy absent', kind: 'expense', isDeleted: false },
    ],
  } as never)
}

function ids() {
  return {
    income: useIncomeStore.getState().incomeSources.map((r) => r.id),
    expenses: useExpenseStore.getState().expenses.map((r) => r.id),
    savings: useSavingsStore.getState().savingsGoals.map((r) => r.id),
    balances: useBalanceStore.getState().entries.map((r) => r.id),
    categories: useCategoryStore.getState().categories.map((r) => r.id),
  }
}

beforeEach(() => {
  seed()
})

describe('cascadeProfileRowRemoval (AC-1)', () => {
  it('removes the deleted profile’s rows from all FIVE collections', () => {
    const removed = cascadeProfileRowRemoval(DOOMED)

    expect(removed).toBe(5)
    const after = ids()
    expect(after.income).not.toContain('i-doomed')
    expect(after.expenses).not.toContain('e-doomed')
    expect(after.savings).not.toContain('s-doomed')
    expect(after.balances).not.toContain('b-doomed')
    expect(after.categories).not.toContain('c-doomed')
  })

  /**
   * ⚠️⚠️ THE MUTATION ARM. `isInActiveProfile(null, DOOMED)` is TRUE, so a
   * cascade built on the read predicate deletes both of these rows. They are
   * every row this device persisted before story 54.4.
   */
  it('keeps an UNSCOPED row — null profileId AND an absent key — in every collection', () => {
    cascadeProfileRowRemoval(DOOMED)

    const after = ids()
    expect(after.income).toEqual(expect.arrayContaining(['i-null', 'i-absent']))
    expect(after.expenses).toEqual(expect.arrayContaining(['e-null', 'e-absent']))
    expect(after.savings).toEqual(expect.arrayContaining(['s-null', 's-absent']))
    expect(after.balances).toEqual(expect.arrayContaining(['b-null', 'b-absent']))
    expect(after.categories).toEqual(expect.arrayContaining(['c-null', 'c-absent']))
  })

  it('leaves the surviving profile’s rows untouched', () => {
    cascadeProfileRowRemoval(DOOMED)

    const after = ids()
    expect(after.income).toContain('i-keeper')
    expect(after.expenses).toContain('e-keeper')
    expect(after.savings).toContain('s-keeper')
    expect(after.balances).toContain('b-keeper')
    expect(after.categories).toContain('c-keeper')
  })

  it('is a no-op for a profile that owns nothing, and writes no new array', () => {
    const before = useIncomeStore.getState().incomeSources
    const removed = cascadeProfileRowRemoval('profile-nobody-owns')

    expect(removed).toBe(0)
    // Identity, not equality: an unchanged collection must not be re-set, or
    // every subscriber re-renders on a deletion that touched nothing.
    expect(useIncomeStore.getState().incomeSources).toBe(before)
  })

  it('treats an empty id as a no-op rather than matching anything', () => {
    expect(cascadeProfileRowRemoval('')).toBe(0)
    expect(ids().income).toHaveLength(4)
  })
})

/**
 * The registry itself (story 66.3).
 *
 * ⚠️⚠️ THE CASCADE CAN ONLY REACH A COLLECTION THAT REGISTERED ITSELF, so a
 * store that stops calling `registerProfileScopedCollection` becomes a SILENT
 * hole — its rows survive a profile deletion and nothing fails. The registration
 * lives at the bottom of each store module, which is easy to drop in a refactor.
 *
 * ⚠️ In the real app the guarantee is `lib/store-hydration.tsx`: it statically
 * imports all five domain stores and is mounted from `routes/__root.tsx`, so
 * every one is registered before anything renders. A store that was never
 * imported also holds no rows, so the registry cannot be stale in the direction
 * that would lose data — but it CAN be stale if a store drops its call, which is
 * what this test is for.
 */
describe('the cascade registry', () => {
  it('holds exactly the five profile-scoped local collections', () => {
    expect(registeredProfileScopedCollections().sort()).toEqual([
      'categories',
      'entries',
      'expenses',
      'incomeSources',
      'savingsGoals',
    ])
  })

  /**
   * ⚠️ `entries`, not `balanceTracking`. The balance store's collection key and
   * its sync entity type disagree; registering the entity name would make that
   * arm a silent no-op that every other test in this file would still pass.
   */
  it('registers the balance store under its STORE key, not its entity type', () => {
    expect(registeredProfileScopedCollections()).toContain('entries')
    expect(registeredProfileScopedCollections()).not.toContain('balanceTracking')
  })
})
