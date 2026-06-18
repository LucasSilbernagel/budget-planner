import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CurrencyMode, CurrencyCode } from '@budget-planner/core'

// Define the type for our store state
interface CurrencyState {
  mode: CurrencyMode
  currency: CurrencyCode
  setMode: (mode: CurrencyMode) => void
  setCurrency: (currency: CurrencyCode) => void
  toggleMode: () => void
}

// Default values
const DEFAULT_MODE: CurrencyMode = 'symbol'
const DEFAULT_CURRENCY: CurrencyCode = 'USD'

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
      partialize: (state) => ({
        mode: state.mode,
        currency: state.currency,
      }),
    }
  )
)

// Selector hooks for better performance
export const useCurrencyMode = () =>
  useCurrencyStore((state) => state.mode)

export const useCurrencyCode = () =>
  useCurrencyStore((state) => state.currency)

export const useCurrencyPreferences = () =>
  useCurrencyStore((state) => ({ mode: state.mode, currency: state.currency }))

// Helper to get formatted value based on current preferences
import { formatCurrency as formatCurrencyCore, formatAmount } from '@budget-planner/core'

export function useFormattedAmount(cents: number): string {
  const { mode, currency } = useCurrencyPreferences()
  
  // Use the core formatting function with current preferences
  return formatCurrencyCore(cents, { mode, currency })
}

// Client-side currency preferences persistence
// Data persists in localStorage across page refreshes
