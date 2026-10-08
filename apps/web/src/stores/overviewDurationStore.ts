import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type OverviewDuration = 'weekly' | 'biweekly' | 'monthly' | 'annually'

export const OVERVIEW_DURATION_STORAGE_KEY = 'budget-planner-overview-duration-prefs-v1'

interface OverviewDurationState {
  duration: OverviewDuration
  setDuration: (duration: OverviewDuration) => void
}

const DEFAULT_DURATION: OverviewDuration = 'annually'

/**
 * Single source of the valid set: VALID_DURATIONS derives from these keys. Declaration order is
 * the render order of the options.
 */
export const DURATION_LABEL: Record<OverviewDuration, string> = {
  weekly: '(per week)',
  biweekly: '(per 2 weeks)',
  monthly: '(per month)',
  annually: '(per year)',
}

export const DURATION_OPTION_LABEL: Record<OverviewDuration, string> = {
  weekly: 'Weekly',
  biweekly: 'Bi-weekly',
  monthly: 'Monthly',
  annually: 'Annually',
}

/**
 * weekly (×12/52) and biweekly (×12/26) multipliers are non-integral, so per-entry and
 * whole-set rounding can differ by a few cents.
 */
export const IS_NON_INTEGRAL_CADENCE: Record<OverviewDuration, boolean> = {
  weekly: true,
  biweekly: true,
  monthly: false,
  annually: false,
}

export const VALID_DURATIONS = Object.keys(DURATION_LABEL) as readonly OverviewDuration[]

// An invalid duration would throw in the core denormalizer during render.
function coerceDuration(value: unknown): OverviewDuration {
  return VALID_DURATIONS.includes(value as OverviewDuration)
    ? (value as OverviewDuration)
    : DEFAULT_DURATION
}

export const useOverviewDurationStore = create<OverviewDurationState>()(
  persist(
    (set) => ({
      // Deterministic default so the server render and first client paint agree.
      duration: DEFAULT_DURATION,

      setDuration: (duration) => {
        set({ duration })
      },
    }),
    {
      name: OVERVIEW_DURATION_STORAGE_KEY,
      skipHydration: true,
      partialize: (state) => ({ duration: state.duration }),
      merge: (persisted, current) => ({
        ...current,
        duration: coerceDuration(
          (persisted as Partial<OverviewDurationState> | undefined)?.duration
        ),
      }),
    }
  )
)

export const useOverviewDuration = () => useOverviewDurationStore((state) => state.duration)

export const useSetOverviewDuration = () => useOverviewDurationStore((state) => state.setDuration)
