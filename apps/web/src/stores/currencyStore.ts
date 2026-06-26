import {
  type CurrencyCode,
  type CurrencyMode,
  type CurrencyOptions,
  DEFAULT_LOCALE,
  formatCurrency as formatCurrencyCore,
  resolveLocale,
} from '@budget-planner/core'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Define the type for our store state
interface CurrencyState {
  mode: CurrencyMode
  currency: CurrencyCode
  /**
   * BCP-47 locale that drives Intl.NumberFormat output in explicit-symbols mode
   * (story 4-7). Always a supported locale code (see core `resolveLocale`).
   */
  locale: string
  /**
   * True once the user has explicitly chosen a locale. Browser auto-detection
   * (see `detectBrowserLocale`) only applies while this is false, so a user's
   * deliberate choice is never overwritten on a later visit.
   */
  localeUserSet: boolean
  setMode: (mode: CurrencyMode) => void
  setCurrency: (currency: CurrencyCode) => void
  setLocale: (locale: string) => void
  toggleMode: () => void
  /** Apply the browser's locale unless the user has set one explicitly. */
  detectBrowserLocale: () => void
}

// Default values
// Currency-less is the product default (FR9 / story 4-6 AC-1, project-context.md):
// new users see raw numbers until they opt into explicit symbols via the toggle.
const DEFAULT_MODE: CurrencyMode = 'none'
const DEFAULT_CURRENCY: CurrencyCode = 'NONE'

/**
 * Reads the browser's preferred language without throwing on the server (SSR)
 * or in non-browser environments. Returns undefined when unavailable so the
 * caller can fall back to {@link DEFAULT_LOCALE}.
 */
function readBrowserLocale(): string | undefined {
  if (typeof navigator === 'undefined') return undefined
  return navigator.languages?.[0] ?? navigator.language
}

export const useCurrencyStore = create<CurrencyState>()(
  persist(
    (set, get) => ({
      // Initial state. `locale` MUST be deterministic here (not navigator-derived):
      // it is the value rendered on the server and on the first client paint, so
      // a browser-derived default would cause a hydration mismatch. Detection
      // happens after rehydration via detectBrowserLocale / onRehydrateStorage.
      mode: DEFAULT_MODE,
      currency: DEFAULT_CURRENCY,
      locale: DEFAULT_LOCALE,
      localeUserSet: false,

      // Set currency display mode
      setMode: (mode) => {
        set({ mode })
      },

      // Set currency code
      setCurrency: (currency) => {
        set({ currency })
      },

      // Set locale (explicit user choice). Normalized to a supported locale and
      // flagged so auto-detection won't override it later.
      setLocale: (locale) => {
        set({ locale: resolveLocale(locale), localeUserSet: true })
      },

      // Toggle between currency modes
      toggleMode: () => {
        set((state) => ({
          mode: state.mode === 'symbol' ? 'none' : 'symbol',
        }))
      },

      // Apply the browser's locale as a sensible default, but never override an
      // explicit user choice (story 4-7 Task 2: detect + allow override).
      detectBrowserLocale: () => {
        if (get().localeUserSet) return
        // No-op when the environment exposes no locale (SSR / non-browser):
        // resolveLocale(undefined) would otherwise clobber a good value with the
        // en-US fallback.
        const detected = readBrowserLocale()
        if (!detected) return
        set({ locale: resolveLocale(detected) })
      },
    }),
    {
      name: 'budget-planner-currency-prefs-v1',
      // SSR-safe: defer the localStorage read until client-side rehydration (see lib/store-hydration)
      skipHydration: true,
      partialize: (state) => ({
        mode: state.mode,
        currency: state.currency,
        locale: state.locale,
        localeUserSet: state.localeUserSet,
      }),
      // After client rehydration, auto-detect the browser locale for users who
      // have not made an explicit choice. Runs once per rehydrate() call.
      onRehydrateStorage: () => (state) => {
        state?.detectBrowserLocale()
      },
    }
  )
)

// Selector hooks for better performance
export const useCurrencyMode = () => useCurrencyStore((state) => state.mode)

export const useCurrencyCode = () => useCurrencyStore((state) => state.currency)

export const useCurrencyLocale = () => useCurrencyStore((state) => state.locale)

export const useCurrencyPreferences = () =>
  useCurrencyStore((state) => ({
    mode: state.mode,
    currency: state.currency,
    locale: state.locale,
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
