import { useEffect } from 'react'
import { usePlannerVisibilityStore } from '../../stores/plannerVisibilityStore'

// The <head> script only SETS the attribute; without this, re-enabling leaves the CSS
// hiding the restored entry. Rehydrate before applying, or the default strips it pre-paint.
export function PlannerVisibilityProvider(): null {
	useEffect(() => {
		const apply = (show: boolean) => {
			if (show) {
				document.documentElement.removeAttribute('data-hide-retirement')
			} else {
				document.documentElement.setAttribute('data-hide-retirement', '1')
			}
		}

		// Swallowed like StoreHydration: blocked localStorage (Safari private mode) throws.
		Promise.resolve(usePlannerVisibilityStore.persist.rehydrate()).catch(() => {})
		apply(usePlannerVisibilityStore.getState().showRetirementPlanner)

		return usePlannerVisibilityStore.subscribe((state) => apply(state.showRetirementPlanner))
	}, [])

	return null
}
