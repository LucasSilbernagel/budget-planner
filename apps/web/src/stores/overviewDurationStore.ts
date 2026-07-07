import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Financial Overview duration preference (story 12-2, FR31).
 *
 * Drives the single global duration selector on the Home dashboard's Financial
 * Overview: Total Income and Total Expenses are re-expressed Weekly / Monthly /
 * Annually from this one source of truth (no per-card duplication). `annually`
 * is the product default.
 *
 * Deliberately a subset of the core `Frequency` type — the overview offers only
 * weekly / monthly / annually (no biweekly), per the story's three options.
 */
export type OverviewDuration = 'weekly' | 'monthly' | 'annually'

/** localStorage key for the persisted overview-duration preference. */
export const OVERVIEW_DURATION_STORAGE_KEY = 'budget-planner-overview-duration-prefs-v1'

interface OverviewDurationState {
  duration: OverviewDuration
  setDuration: (duration: OverviewDuration) => void
}

// Annually is the product default (story 12-2 AC-1 / FR31).
const DEFAULT_DURATION: OverviewDuration = 'annually'

const VALID_DURATIONS: readonly OverviewDuration[] = ['weekly', 'monthly', 'annually']

// Coerce any unknown/corrupt value back to the default. The only in-app writers
// are the three-value selector and the default, so this only ever fires against a
// tampered or corrupt persisted blob — but an invalid duration would otherwise
// throw in the core denormalizer (Invalid frequency) during render and take the
// dashboard down, so we sanitize defensively (cf. currencyStore.migrate).
function coerceDuration(value: unknown): OverviewDuration {
  return VALID_DURATIONS.includes(value as OverviewDuration)
    ? (value as OverviewDuration)
    : DEFAULT_DURATION
}

export const useOverviewDurationStore = create<OverviewDurationState>()(
  persist(
    (set) => ({
      // Deterministic default. This is the value rendered on the server and on
      // the first client paint, so it MUST NOT be derived from `navigator` / the
      // OS — a browser-derived default would cause a hydration mismatch (same
      // discipline as currencyStore / themeStore). The persisted preference is
      // applied after client rehydration (see lib/store-hydration).
      duration: DEFAULT_DURATION,

      setDuration: (duration) => {
        set({ duration })
      },
    }),
    {
      name: OVERVIEW_DURATION_STORAGE_KEY,
      // SSR-safe: defer the localStorage read until client-side rehydration (see lib/store-hydration).
      skipHydration: true,
      partialize: (state) => ({ duration: state.duration }),
      // Runs on every rehydrate: sanitize the persisted duration so a corrupt or
      // tampered value can never reach the denormalizer (which throws on an
      // invalid frequency) and crash the dashboard.
      merge: (persisted, current) => ({
        ...current,
        duration: coerceDuration(
          (persisted as Partial<OverviewDurationState> | undefined)?.duration
        ),
      }),
    }
  )
)

// Selector hooks (mirror currencyStore / themeStore idiom) for stable subscriptions.
export const useOverviewDuration = () => useOverviewDurationStore((state) => state.duration)

export const useSetOverviewDuration = () => useOverviewDurationStore((state) => state.setDuration)
