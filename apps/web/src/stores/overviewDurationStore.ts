import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * App-wide period ("duration") preference (story 12-2 / FR31, widened by story
 * 32.1 / FR58).
 *
 * One persisted source of truth for every headline flow total: the Home
 * dashboard's Financial Overview, the category breakdown, and the Income and
 * Expenses pages all read this store, so the same period is shown everywhere
 * and a change on one surface is reflected on the others.
 *
 * Story 32.1 added `biweekly` as a fourth value so the control matches the four
 * entry frequencies users actually record (FR1/FR2) — a deliberate amendment to
 * story 12-2's three-value subset. The union is now congruent with the core
 * `Frequency` type, which is what lets `denormalizeFromMonthly` accept a
 * duration directly.
 */
export type OverviewDuration = 'weekly' | 'biweekly' | 'monthly' | 'annually'

/** localStorage key for the persisted overview-duration preference. */
export const OVERVIEW_DURATION_STORAGE_KEY = 'budget-planner-overview-duration-prefs-v1'

interface OverviewDurationState {
  duration: OverviewDuration
  setDuration: (duration: OverviewDuration) => void
}

// Annually is the product default (story 12-2 AC-1 / FR31).
const DEFAULT_DURATION: OverviewDuration = 'annually'

/**
 * Period suffix appended to a total's label, e.g. "Total Income (per year)".
 *
 * ⚠️ THE SINGLE SOURCE OF TRUTH FOR THE VALID SET. `VALID_DURATIONS` below is
 * DERIVED from these keys rather than written out a second time. Before story
 * 32.1 the union and the valid-set array were two independent literals, and
 * `readonly OverviewDuration[]` happily accepts a subset — so adding a value to
 * the union alone type-checked, left every test green, and made `coerceDuration`
 * silently reset the new value to the default on every rehydrate. Deriving the
 * array turns that class of drift into a compile error on this `Record`.
 *
 * Declaration order is the app-wide ascending-period convention (weekly,
 * biweekly, monthly, annually) and is load-bearing: `Object.keys` preserves it,
 * so it is also the order the `<option>` list renders in.
 *
 * Consumed by HomePage, CategoryBreakdown, IncomePage and ExpensesPage — this
 * used to be copy-pasted per component (story 32.1 collapsed those copies).
 */
export const DURATION_LABEL: Record<OverviewDuration, string> = {
  weekly: '(per week)',
  biweekly: '(per 2 weeks)',
  monthly: '(per month)',
  annually: '(per year)',
}

/**
 * Visible text for each `<option>` in a duration selector.
 *
 * `Bi-weekly` (hyphenated) matches the per-row frequency selects on the Income,
 * Expenses and Balance pages, which is where a user meets the word first. The
 * reports and forecasting surfaces spell it `Biweekly`; that inconsistency
 * predates this store and is not resolved here.
 */
export const DURATION_OPTION_LABEL: Record<OverviewDuration, string> = {
  weekly: 'Weekly',
  biweekly: 'Bi-weekly',
  monthly: 'Monthly',
  annually: 'Annually',
}

/**
 * Every selectable duration, in render order. Derived — never hand-written.
 * Drives both `coerceDuration` and the rendered `<option>` list, so a
 * user-selectable option cannot be one the store would reject on reload.
 */
export const VALID_DURATIONS = Object.keys(DURATION_LABEL) as readonly OverviewDuration[]

// Coerce any unknown/corrupt value back to the default. The only in-app writers
// are the selector and the default, so this only ever fires against a tampered
// or corrupt persisted blob — but an invalid duration would otherwise throw in
// the core denormalizer (Invalid frequency) during render and take the
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
