import { useEffect } from 'react'
import { usePlannerVisibilityStore } from '../../stores/plannerVisibilityStore'

/**
 * Keeps `<html data-hide-retirement>` in sync with the persisted preference
 * (story 35.2, FR55). Renders nothing — pure wiring, mounted once at the root.
 *
 * ⚠️⚠️ WHY THIS EXISTS: THE PRE-PAINT BOOTSTRAP IS A ONE-WAY DOOR WITHOUT IT.
 * The `<head>` script only ever SETS the attribute. Found in code review — with
 * only the "set" half shipped, this happened on a plain, reachable path:
 *   1. user has the planner hidden; any page load stamps `data-hide-retirement="1"`;
 *   2. user re-enables it (Settings switch, or the off-state panel's button);
 *   3. React dutifully renders the `<li>` again — and the CSS rule, still
 *      matching, hides it.
 * The switch read ON, `/retirement` rendered the planner, and the nav entry
 * stayed invisible until a full reload. The React layer is authoritative for
 * *removing* the entry, but the CSS layer silently outranked it for *restoring*
 * it. Two-layer mechanisms have to be two-way.
 *
 * The shape is copied from `components/theme/ThemeProvider`, which solves the
 * identical problem for `.dark` — including the ordering that matters:
 * REHYDRATE FIRST, then apply from the resolved value, then subscribe. A plain
 * `[value]`-dependency effect would apply the deterministic default (visible)
 * before rehydration and strip the attribute the `<head>` script just set —
 * reintroducing exactly the flash both mechanisms exist to prevent.
 */
export function PlannerVisibilityProvider(): null {
  useEffect(() => {
    const apply = (show: boolean) => {
      if (show) {
        document.documentElement.removeAttribute('data-hide-retirement')
      } else {
        document.documentElement.setAttribute('data-hide-retirement', '1')
      }
    }

    // Load the persisted preference before the first reflect. StoreHydration
    // also rehydrates this store; calling it here is idempotent and guarantees
    // we never briefly apply the default (visible) over the <head> script's
    // attribute. localStorage-backed rehydration is synchronous. Swallow like
    // StoreHydration when localStorage is blocked (Safari private mode →
    // SecurityError); getState() then returns the default.
    Promise.resolve(usePlannerVisibilityStore.persist.rehydrate()).catch(() => {})
    apply(usePlannerVisibilityStore.getState().showRetirementPlanner)

    // Live updates when the user toggles the preference.
    return usePlannerVisibilityStore.subscribe((state) => apply(state.showRetirementPlanner))
  }, [])

  return null
}
