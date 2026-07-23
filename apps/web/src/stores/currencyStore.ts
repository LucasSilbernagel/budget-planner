import {
  type CurrencyCode,
  type CurrencyMode,
  type CurrencyOptions,
  DEFAULT_LOCALE,
  canonicalizeCurrency,
  formatCurrency as formatCurrencyCore,
  localeForCurrency,
} from '@budget-planner/core'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Define the type for our store state
interface CurrencyState {
  mode: CurrencyMode
  currency: CurrencyCode
  setMode: (mode: CurrencyMode) => void
  setCurrency: (currency: CurrencyCode) => void
  toggleMode: () => void
}

// Default values
// New users default to explicit `$` (USD) symbols (FR38 / Epic 22), reversing the
// earlier currency-less default (FR9 / story 4-6 AC-1). Existing users keep their
// persisted preference — the `migrate` per-field coalesce below only falls back to
// these defaults for a missing field, so an explicit stored `none`/`NONE` (or any
// other saved choice) is preserved, never overwritten. `$` is nationality-neutral
// in the UI (currencyDisplayLabel('USD') === '$'); billing/pricing display stays EUR.
const DEFAULT_MODE: CurrencyMode = 'symbol'
const DEFAULT_CURRENCY: CurrencyCode = 'USD'

export const useCurrencyStore = create<CurrencyState>()(
  persist(
    (set) => ({
      // Initial state is fully deterministic (no navigator-derived values), so
      // server and first client paint agree — no hydration mismatch. The display
      // locale is derived from `currency` (see localeForCurrency), not stored.
      mode: DEFAULT_MODE,
      currency: DEFAULT_CURRENCY,

      // Set currency display mode
      setMode: (mode) => {
        set({ mode })
      },

      // Set currency code. Canonicalize defensively so a consolidated code
      // (e.g. CAD/AUD/MXN) can never re-enter state at runtime (story 8-2).
      setCurrency: (currency) => {
        set({ currency: canonicalizeCurrency(currency) })
      },

      // Toggle between currency modes
      toggleMode: () => {
        set((state) => ({
          mode: state.mode === 'symbol' ? 'none' : 'symbol',
        }))
      },
    }),
    {
      name: 'budget-planner-currency-prefs-v1',
      // SSR-safe: defer the localStorage read until client-side rehydration (see lib/store-hydration)
      skipHydration: true,
      // v1 (Story 8-1): the locale dimension is gone — formatting is now derived
      // from `currency`. Strip the obsolete locale/localeUserSet keys from any
      // legacy persisted blob so it migrates cleanly to currency-driven formatting.
      // v2 (Story 8-2): canonicalize the persisted currency so a now-consolidated
      // code (CAD/AUD/MXN) maps to its representative (USD) — no data loss, the
      // money already rendered `$…`; everything else is preserved.
      version: 2,
      migrate: (persisted) => {
        const state = persisted as { mode?: CurrencyMode; currency?: CurrencyCode }
        // Coalesce per field: a corrupt/partial blob missing mode/currency must
        // fall back to the deterministic defaults, not shallow-merge `undefined`
        // over them (zustand's default merge spreads undefined keys).
        return {
          mode: state?.mode ?? DEFAULT_MODE,
          currency: canonicalizeCurrency(state?.currency ?? DEFAULT_CURRENCY),
        }
      },
      partialize: (state) => ({
        mode: state.mode,
        currency: state.currency,
      }),
    }
  )
)

// Selector hooks for better performance
export const useCurrencyMode = () => useCurrencyStore((state) => state.mode)

export const useCurrencyCode = () => useCurrencyStore((state) => state.currency)

export const useCurrencyPreferences = () =>
  useCurrencyStore((state) => ({
    mode: state.mode,
    currency: state.currency,
    // Display locale is derived from the selected currency (story 8-1): a pure
    // function of `currency`, so the returned shape stays { mode, currency, locale }
    // and every downstream consumer keeps working unchanged.
    //
    // Currency-less mode has no currency, so it must NOT inherit a retained
    // currency's regional locale (story 14-2 review): the toggle leaves `currency`
    // set when symbols are switched off, so `{ mode:'none', currency:'EUR' }` is
    // reachable and would otherwise render raw numbers as `1.234.567,89`
    // (German comma-decimal) or Indian 2-2-3 grouping. Currency-less grouping is
    // fixed to the neutral DEFAULT_LOCALE so raw numbers read consistently
    // (`1,234,567.89`) regardless of any previously-picked symbol currency.
    locale: state.mode === 'none' ? DEFAULT_LOCALE : localeForCurrency(state.currency),
  }))

// Helper to get formatted value based on current preferences

export function useFormattedAmount(): (cents: number) => string {
  const { mode, currency, locale } = useCurrencyPreferences()

  // Return a function that can be used anywhere in the component
  return (cents: number) => formatCurrencyCore(cents, { mode, currency, locale })
}

export function useFormattedAmountWithOptions(
  options: Partial<CurrencyOptions> = {}
): (cents: number) => string {
  const { mode, currency, locale } = useCurrencyPreferences()

  // Caller-supplied options win over the store preferences (spread last).
  return (cents: number) => formatCurrencyCore(cents, { mode, currency, locale, ...options })
}

// Client-side currency preferences persistence
// Data persists in localStorage across page refreshes
