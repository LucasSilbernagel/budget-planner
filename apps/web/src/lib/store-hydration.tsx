import { useEffect } from 'react'
import { useBalanceStore } from '../stores/balanceStore'
import { useCategoryStore } from '../stores/categoryStore'
import { useCurrencyStore } from '../stores/currencyStore'
import { useExpenseStore } from '../stores/expenseStore'
import { useIncomeStore } from '../stores/incomeStore'
import { useOverviewDurationStore } from '../stores/overviewDurationStore'
import { usePlannerVisibilityStore } from '../stores/plannerVisibilityStore'
import { useProfileStore } from '../stores/profileStore'
import { useSavingsStore } from '../stores/savingsStore'
import { useThemeStore } from '../stores/themeStore'

/**
 * Client-side rehydration for all persisted Zustand stores.
 *
 * Every persisted store is created with `skipHydration: true` so that the
 * localStorage read does NOT happen on the server (which has no localStorage)
 * and does NOT happen during the first client render. Once the app has mounted
 * on the client, we trigger `rehydrate()` to load the user's free-tier data
 * from localStorage (story 1-6).
 *
 * ⚠️ WHAT `skipHydration` DOES AND DOES NOT GUARANTEE — corrected by story 38.1.
 *
 * This docblock used to say the deferred read is what keeps the first client
 * render matching the server HTML. That is **only true for selectors that read
 * the state object React hands them.** It is false for a selector that CALLS a
 * state method, and was measurably false on six routes (BUG-F), in dev and in a
 * production build (React #418).
 *
 * The reason is an ordering this component cannot control. `StoreHydration` sits
 * in the ROOT subtree, but route content sits inside the Suspense boundary
 * `@tanstack/react-router` wraps around the root `<Outlet/>` unconditionally
 * (`Match.js:286-289`), which React hydrates in a LATER pass. `rehydrate()` is
 * synchronous for a synchronous storage, so by the time the route subtree
 * hydrates, every store is already full. zustand handles this correctly — it
 * passes `getInitialState` to React as `getServerSnapshot` — but that snapshot's
 * METHODS still close over `get()` and return live state.
 *
 * So the rule is: **a selector must derive from its argument, never call a state
 * method.** Each store keeps pure `*From()` helpers shared by its methods and its
 * selectors, and `stores/__tests__/no-method-selectors.guard.test.ts` sweeps `src`
 * for the banned shape.
 *
 * ⚠️ That guard is a TRIPWIRE, NOT A PROOF — this sentence used to say it "fails if
 * the banned shape returns", and code review showed it caught only one spelling.
 * It now covers the common spellings (paren-less and typed params, braced bodies,
 * optional chaining, calls nested in a larger expression) and still cannot see a
 * named selector function defined elsewhere. Read its docblock before relying on
 * it.
 *
 * This component is unchanged and is not the defect — do not "fix" it here.
 *
 * Rejections are swallowed per-store: if localStorage is blocked (Safari
 * private mode, `SecurityError`) or holds corrupt JSON, that store simply stays
 * at its default rather than surfacing an unhandled promise rejection.
 */
export function StoreHydration() {
  useEffect(() => {
    const stores = [
      useIncomeStore,
      useExpenseStore,
      useSavingsStore,
      useBalanceStore,
      useCategoryStore,
      useCurrencyStore,
      useProfileStore,
      useThemeStore,
      useOverviewDurationStore,
      usePlannerVisibilityStore,
    ]

    for (const store of stores) {
      Promise.resolve(store.persist.rehydrate()).catch((error) => {
        console.error('Store rehydration failed:', error)
      })
    }
  }, [])

  return null
}
