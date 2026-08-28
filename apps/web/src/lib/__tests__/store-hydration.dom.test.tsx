/**
 * StoreHydration must rehydrate EVERY persisted store (Story 30.4a, gate 11)
 *
 * ⚠️ WHY THIS FILE EXISTS. Every store in this app is created with
 * `skipHydration: true` so the localStorage read never happens on the server or
 * during the first client render. That makes `StoreHydration`'s list the ONLY
 * thing that loads a user's data — a store missing from it silently starts empty
 * on every page load and stays empty until something else writes to it.
 *
 * There was no test for this list at all. Removing `useCategoryStore` from it
 * was mutation-tested and left `src/lib` + `src/stores` fully green (202
 * passed). That is the gap this closes.
 *
 * The list is asserted by BEHAVIOUR (each store's `rehydrate` is actually
 * called), not by reading the source, so it cannot pass on a store that is
 * imported but never invoked.
 */

import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useBalanceStore } from '../../stores/balanceStore'
import { useCategoryStore } from '../../stores/categoryStore'
import { useCurrencyStore } from '../../stores/currencyStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { useOverviewDurationStore } from '../../stores/overviewDurationStore'
import { usePlannerVisibilityStore } from '../../stores/plannerVisibilityStore'
import { useProfileStore } from '../../stores/profileStore'
import { useSavingsStore } from '../../stores/savingsStore'
import { useTableSortStore } from '../../stores/tableSortStore'
import { useThemeStore } from '../../stores/themeStore'
import { StoreHydration } from '../store-hydration'

/** Every persisted store, with the name used in failure output. */
const PERSISTED_STORES = [
  ['income', useIncomeStore],
  ['expense', useExpenseStore],
  ['savings', useSavingsStore],
  ['balance', useBalanceStore],
  ['category', useCategoryStore],
  ['currency', useCurrencyStore],
  ['profile', useProfileStore],
  ['theme', useThemeStore],
  ['overviewDuration', useOverviewDurationStore],
  // Story 35.2: a store missing from the list here is the story's Trap A — the
  // Retirement-visibility preference would persist correctly and never load, so
  // a user who hid the planner would see it return on every reload.
  ['plannerVisibility', usePlannerVisibilityStore],
  // Story 42.1: a column sort that persists correctly and never loads is worse
  // than one that was never persisted — the user re-sorts every visit and the
  // storage slot quietly accumulates a selection nothing reads.
  ['tableSort', useTableSortStore],
] as const

afterEach(() => {
  vi.restoreAllMocks()
})

describe('StoreHydration', () => {
  it('rehydrates every persisted store on mount', () => {
    const spies = PERSISTED_STORES.map(
      ([name, store]) =>
        [name, vi.spyOn(store.persist, 'rehydrate').mockResolvedValue(undefined)] as const
    )

    render(<StoreHydration />)

    for (const [name, spy] of spies) {
      // Named assertion so a miss says WHICH store was dropped.
      expect(spy, `${name} store was never rehydrated`).toHaveBeenCalledTimes(1)
    }
  })

  it('rehydrates the category store specifically (Story 30.4a)', () => {
    // Called out separately from the sweep above so the reason it matters is not
    // lost: without this, a Premium user's categories vanish on every refresh
    // while their income and expenses come back, which reads as data loss.
    const spy = vi.spyOn(useCategoryStore.persist, 'rehydrate').mockResolvedValue(undefined)

    render(<StoreHydration />)

    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('a failing store does not prevent the others from rehydrating', async () => {
    // localStorage can throw (Safari private mode / SecurityError). The loop
    // swallows per-store rejections; this pins that one bad store cannot leave
    // the rest of the app empty.
    //
    // ⚠️ CODE REVIEW 30.4a — this test used to assert
    // `expect(() => render(...)).not.toThrow()` plus a spy call count, and it
    // proved NOTHING. `mockRejectedValue` returns a rejected promise; it never
    // throws synchronously, so `not.toThrow()` cannot fail whatever the
    // implementation does. And every `rehydrate()` is issued in one synchronous
    // loop before any rejection settles, so the category spy fires regardless.
    // Verified at review: deleting the ENTIRE `.catch()` from store-hydration.tsx
    // left this file green at 3/3.
    //
    // The fix is to assert the HANDLING: the rejection must be routed to
    // console.error, and the promise must settle without an unhandled rejection.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failure = new Error('SecurityError')
    vi.spyOn(useIncomeStore.persist, 'rehydrate').mockRejectedValue(failure)
    const categorySpy = vi.spyOn(useCategoryStore.persist, 'rehydrate').mockResolvedValue(undefined)

    const unhandled: unknown[] = []
    const onUnhandled = (event: PromiseRejectionEvent) => {
      unhandled.push(event.reason)
      event.preventDefault()
    }
    globalThis.addEventListener?.('unhandledrejection', onUnhandled)

    try {
      render(<StoreHydration />)

      // Let the rejected rehydrate settle and its handler run.
      await vi.waitFor(() => {
        expect(consoleError).toHaveBeenCalled()
      })

      // MUTATION KILLED: remove `.catch(...)` from the rehydrate loop. Without
      // the handler nothing reaches console.error and this assertion goes red.
      expect(consoleError).toHaveBeenCalledWith('Store rehydration failed:', failure)

      // The other stores were still asked to rehydrate — the original intent.
      expect(categorySpy).toHaveBeenCalledTimes(1)

      // And the failure was genuinely handled, not merely unobserved.
      await Promise.resolve()
      expect(unhandled).toHaveLength(0)
    } finally {
      globalThis.removeEventListener?.('unhandledrejection', onUnhandled)
    }
  })
})
