import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * The no-flash <head> script parses this key and the partialized shape directly (it cannot
 * import zustand); keep them in sync.
 */
export const PLANNER_VISIBILITY_STORAGE_KEY = 'budget-planner-planner-visibility-v1'

interface PlannerVisibilityState {
	showRetirementPlanner: boolean
	setShowRetirementPlanner: (showRetirementPlanner: boolean) => void
	toggleRetirementPlanner: () => void
}

const DEFAULT_SHOW_RETIREMENT_PLANNER = true

/**
 * Only a literal `false` hides the planner. The pre-paint script duplicates this rule and the
 * two must agree.
 */
function coerceVisibility(value: unknown): boolean {
	return value === false ? false : DEFAULT_SHOW_RETIREMENT_PLANNER
}

export const usePlannerVisibilityStore = create<PlannerVisibilityState>()(
	persist(
		(set) => ({
			// Deterministic default so the server render and first client paint agree.
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
			skipHydration: true,
			partialize: (state) => ({ showRetirementPlanner: state.showRetirementPlanner }),
			merge: (persisted, current) => ({
				...current,
				showRetirementPlanner: coerceVisibility(
					(persisted as Partial<PlannerVisibilityState> | undefined)?.showRetirementPlanner
				),
			}),
		}
	)
)

export const useShowRetirementPlanner = () =>
	usePlannerVisibilityStore((state) => state.showRetirementPlanner)

export const useSetShowRetirementPlanner = () =>
	usePlannerVisibilityStore((state) => state.setShowRetirementPlanner)

export const useToggleRetirementPlanner = () =>
	usePlannerVisibilityStore((state) => state.toggleRetirementPlanner)
