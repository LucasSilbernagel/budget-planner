import {
	type CurrencyCode,
	type CurrencyMode,
	type CurrencyOptions,
	canonicalizeCurrency,
	formatCurrency as formatCurrencyCore,
} from '@budget-planner/core/format/currency'
import { DEFAULT_LOCALE, localeForCurrency } from '@budget-planner/core/format/currency-locale'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type CurrencyState = {
	mode: CurrencyMode
	currency: CurrencyCode
	setMode: (mode: CurrencyMode) => void
	setCurrency: (currency: CurrencyCode) => void
	toggleMode: () => void
}

const DEFAULT_MODE: CurrencyMode = 'symbol'
const DEFAULT_CURRENCY: CurrencyCode = 'USD'

export const useCurrencyStore = create<CurrencyState>()(
	persist(
		(set) => ({
			// Deterministic default so the server render and first client paint agree.
			mode: DEFAULT_MODE,
			currency: DEFAULT_CURRENCY,

			setMode: (mode) => {
				set({ mode })
			},

			setCurrency: (currency) => {
				set({ currency: canonicalizeCurrency(currency) })
			},

			toggleMode: () => {
				set((state) => ({
					mode: state.mode === 'symbol' ? 'none' : 'symbol',
				}))
			},
		}),
		{
			name: 'budget-planner-currency-prefs-v1',
			skipHydration: true,
			version: 2,
			migrate: (persisted) => {
				const state = persisted as { mode?: CurrencyMode; currency?: CurrencyCode }
				// Coalesce per field: zustand's default merge would spread undefined over the defaults.
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

export const useCurrencyMode = () => useCurrencyStore((state) => state.mode)

export const useCurrencyCode = () => useCurrencyStore((state) => state.currency)

export const useCurrencyPreferences = () =>
	useCurrencyStore((state) => ({
		mode: state.mode,
		currency: state.currency,
		// Currency-less mode must not inherit a retained currency's regional grouping
		// (e.g. EUR's 1.234.567,89); the toggle leaves `currency` set.
		locale: state.mode === 'none' ? DEFAULT_LOCALE : localeForCurrency(state.currency),
	}))

export function useFormattedAmount(): (cents: number) => string {
	const { mode, currency, locale } = useCurrencyPreferences()

	return (cents: number) => formatCurrencyCore(cents, { mode, currency, locale })
}

export function useFormattedAmountWithOptions(
	options: Partial<CurrencyOptions> = {}
): (cents: number) => string {
	const { mode, currency, locale } = useCurrencyPreferences()

	return (cents: number) => formatCurrencyCore(cents, { mode, currency, locale, ...options })
}
