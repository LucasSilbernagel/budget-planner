import { type RenderResult, act, cleanup, render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { StoreHydration } from '../lib/store-hydration'
import { useBalanceStore } from '../stores/balanceStore'
import { useCategoryStore } from '../stores/categoryStore'
import { useCurrencyStore } from '../stores/currencyStore'
import { useExpenseStore } from '../stores/expenseStore'
import { useIncomeStore } from '../stores/incomeStore'
import { useOverviewDurationStore } from '../stores/overviewDurationStore'
import { usePlannerVisibilityStore } from '../stores/plannerVisibilityStore'
import { useProfileStore } from '../stores/profileStore'
import { useRetirementPlannerStore } from '../stores/retirementPlannerStore'
import { useSavingsStore } from '../stores/savingsStore'
import { useTableSortStore } from '../stores/tableSortStore'

/**
 * The reload chain: what a full page reload proves about OUR code, below the
 * browser (story 84.5, D5; FR137).
 *
 * A reload is a fresh document whose persisted stores start at their initial
 * state and whose only carrier is localStorage. So a value survives only if
 * every link holds:
 *
 *   1. the store WROTE it (`partialize`, the persist write path);
 *   2. it can be READ back (`version` / `migrate` / `merge`);
 *   3. the store is REGISTERED in `StoreHydration`, which is the only thing that
 *      rehydrates a `skipHydration: true` store on a page load.
 *
 * `reloadChain()` unmounts everything, puts every persisted store back to its
 * initial state, and restores localStorage exactly as it was. The test then
 * mounts the page beside the REAL `<StoreHydration />` (`renderAfterReload`),
 * so dropping a store from that list leaves its value behind, as it would in
 * the browser.
 *
 * ⚠️ Resetting a store goes through zustand's persist WRITE path (even under
 * `skipHydration`, which skips only the initial read) and overwrites its blob.
 * That is why the snapshot is taken first and written back last.
 *
 * ⚠️ This list is a COPY of `StoreHydration`'s, on purpose: it is what a fresh
 * document resets, and it must not shrink when a store is dropped from
 * `StoreHydration` (that is the defect the chain exists to catch). The parity
 * runs the other way in `test/__tests__/reload-chain.test.ts`: every store
 * `StoreHydration` registers must be reset here, or its in-memory value would
 * "survive" a reload it never wrote to storage.
 *
 * ⚠️ ONLY the persisted stores are reset (84.5 code review). Everything else a
 * real reload would wipe survives this one: non-persisted zustand stores
 * (`lib/sync/*Store`, `hooks/useSync`), `<html>` attributes, `body.style`, a
 * stubbed `window.matchMedia`, module-level variables. A claim that depends on
 * any of those needs its own reset.
 *
 * ⚠️ What this does NOT prove (the named D2 loss): the browser itself re-reading
 * storage on a real reload, and the SSR first paint. `e2e/hydration.spec.ts`
 * (F1) and `retirement-plan-persistence.spec.ts` › "every entered value
 * survives a reload" (F3) still do that, in a real browser, for the flows.
 */
export const PERSISTED_STORES: readonly unknown[] = [
  useIncomeStore,
  useExpenseStore,
  useSavingsStore,
  useBalanceStore,
  useCategoryStore,
  useCurrencyStore,
  useProfileStore,
  useOverviewDurationStore,
  usePlannerVisibilityStore,
  useTableSortStore,
  useRetirementPlannerStore,
]

export function reloadChain(): void {
  cleanup()

  const snapshot: [string, string][] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key !== null) snapshot.push([key, localStorage.getItem(key) ?? ''])
  }

  for (const store of PERSISTED_STORES) {
    // Each store has its own state type; the reset only hands a store its own.
    const api = store as unknown as {
      setState: (state: never, replace: true) => void
      getInitialState: () => never
    }
    api.setState(api.getInitialState(), true)
  }

  localStorage.clear()
  for (const [key, value] of snapshot) localStorage.setItem(key, value)
}

/** Reload, then mount `ui` the way the app root does: beside `StoreHydration`. */
export async function renderAfterReload(ui: ReactElement): Promise<RenderResult> {
  reloadChain()
  const result = render(
    <>
      <StoreHydration />
      {ui}
    </>
  )
  // `rehydrate()` resolves through a promise; let it settle before asserting.
  await act(async () => {
    await Promise.resolve()
  })
  return result
}
