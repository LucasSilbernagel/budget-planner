import type { CurrencyCode, CurrencyMode } from '@budget-planner/core'
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
// Currency-less is the product default (FR9 / story 4-6 AC-1, project-context.md):
// new users see raw numbers until they opt into explicit symbols via the toggle.
const DEFAULT_MODE: CurrencyMode = 'none'
const DEFAULT_CURRENCY: CurrencyCode = 'NONE'

export const useCurrencyStore = create<CurrencyState>()(
  persist(
    (set) => ({
      // Initial state
      mode: DEFAULT_MODE,
      currency: DEFAULT_CURRENCY,

      // Set currency display mode
      setMode: (mode) => {
        set({ mode })
      },

      // Set currency code
      setCurrency: (currency) => {
        set({ currency })
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
  useCurrencyStore((state) => ({ mode: state.mode, currency: state.currency }))

// Helper to get formatted value based on current preferences
import { type CurrencyOptions, formatCurrency as formatCurrencyCore } from '@budget-planner/core'

export function useFormattedAmount(): (cents: number) => string {
  const { mode, currency } = useCurrencyPreferences()

  // Return a function that can be used anywhere in the component
  return (cents: number) => formatCurrencyCore(cents, { mode, currency })
}

export function useFormattedAmountWithOptions(
  options: Partial<CurrencyOptions> = {}
): (cents: number) => string {
  const { mode, currency } = useCurrencyPreferences()

  // Return a function that can be used anywhere in the component
  return (cents: number) => formatCurrencyCore(cents, { mode, currency, ...options })
}

// Client-side currency preferences persistence
// Data persists in localStorage across page refreshes
