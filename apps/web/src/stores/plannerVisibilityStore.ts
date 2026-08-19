import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * localStorage key for the Retirement planner visibility preference (story 35.2, FR55).
 *
 * ⚠️ The no-flash `<head>` bootstrap in `lib/nav/no-flash-planner-visibility-script`
 * reads this key AND hard-parses the persisted `{ state: { showRetirementPlanner } }`
 * shape directly (it runs before any JS module loads, so it cannot import
 * zustand). Keep this key, the `partialize` shape, and that script in sync — a
 * change here that is not mirrored there silently reintroduces the first-paint
 * flash this story exists to prevent (AC-4).
 */
export const PLANNER_VISIBILITY_STORAGE_KEY = 'budget-planner-planner-visibility-v1'

interface PlannerVisibilityState {
  showRetirementPlanner: boolean
  setShowRetirementPlanner: (showRetirementPlanner: boolean) => void
  toggleRetirementPlanner: () => void
}

/**
 * Visible is the product default: hiding the planner is an opt-in, so nobody's
 * current experience changes without their action (AC-1).
 */
const DEFAULT_SHOW_RETIREMENT_PLANNER = true

/**
 * Coerce a persisted value to a boolean, defaulting to VISIBLE.
 *
 * ⚠️ Only a literal `false` hides the planner. `'false'`, `0`, `null` and a
 * missing field are all falsy, so a naive `!value` would hide the planner for a
 * user who never asked. This rule is duplicated — deliberately and unavoidably —
 * in the pre-paint script, which cannot import this module. The two must agree:
 * if they diverge, a corrupt blob hides the entry on the first frame and reveals
 * it again after hydration, which is worse than either behavior alone.
 */
function coerceVisibility(value: unknown): boolean {
  return value === false ? false : DEFAULT_SHOW_RETIREMENT_PLANNER
}

export const usePlannerVisibilityStore = create<PlannerVisibilityState>()(
  persist(
    (set) => ({
      // Deterministic default. This is the value rendered on the server and on
      // the first client paint, so it MUST NOT be derived from `navigator` / the
      // OS — a browser-derived default would cause a hydration mismatch (same
      // discipline as currencyStore / themeStore). The persisted preference is
      // applied after client rehydration (see lib/store-hydration) and,
      // crucially, *before first paint* by the no-flash <head> script.
      showRetirementPlanner: DEFAULT_SHOW_RETIREMENT_PLANNER,

      setShowRetirementPlanner: (showRetirementPlanner) => {
        set({ showRetirementPlanner })
      },

      toggleRetirementPlanner: () => {
        set((state) => ({ showRetirementPlanner: !state.showRetirementPlanner }))
      },
    }),
    {
      name: PLANNER_VISIBILITY_STORAGE_KEY,
      // SSR-safe: defer the localStorage read until client-side rehydration (see lib/store-hydration).
      skipHydration: true,
      partialize: (state) => ({ showRetirementPlanner: state.showRetirementPlanner }),
      // Runs on every rehydrate: sanitize the persisted flag so a corrupt or
      // tampered value can never hide a planner the user never turned off
      // (cf. overviewDurationStore.merge).
      merge: (persisted, current) => ({
        ...current,
        showRetirementPlanner: coerceVisibility(
          (persisted as Partial<PlannerVisibilityState> | undefined)?.showRetirementPlanner
        ),
      }),
    }
  )
)

// Selector hooks (mirror currencyStore / themeStore idiom) for stable subscriptions.
export const useShowRetirementPlanner = () =>
  usePlannerVisibilityStore((state) => state.showRetirementPlanner)

export const useSetShowRetirementPlanner = () =>
  usePlannerVisibilityStore((state) => state.setShowRetirementPlanner)

export const useToggleRetirementPlanner = () =>
  usePlannerVisibilityStore((state) => state.toggleRetirementPlanner)
