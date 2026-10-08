import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderHook } from '@/test/utils'
import { useCurrencyStore, useFormattedAmount } from '../currencyStore'

// de-DE uses U+00A0 before the symbol. \s matches it (and other Unicode
// spaces) — normalize to a plain space for human-readable assertions.
const normalizeSpaces = (value: string) => value.replace(/\s/g, ' ')

describe('currencyStore (story 8-1)', () => {
	beforeEach(() => {
		useCurrencyStore.setState({ mode: 'none', currency: 'NONE' })
	})

	afterEach(() => {
		localStorage.clear()
	})

	it('defaults new users to explicit USD symbols (story 22-1 / FR38)', () => {
		// The product default lives on the store's initial state, independent of the suite's
		// currency-less baseline.
		const initial = useCurrencyStore.getInitialState()
		expect(initial.mode).toBe('symbol')
		expect(initial.currency).toBe('USD')
	})

	describe('useFormattedAmount derives locale from currency (AC-1)', () => {
		it('formats EUR per its de-DE regional default without any locale set', () => {
			useCurrencyStore.setState({ mode: 'symbol', currency: 'EUR' })
			const { result } = renderHook(() => useFormattedAmount())
			expect(normalizeSpaces(result.current(100000))).toBe('1.000,00 €')
		})

		it('formats USD per its en-US regional default', () => {
			useCurrencyStore.setState({ mode: 'symbol', currency: 'USD' })
			const { result } = renderHook(() => useFormattedAmount())
			expect(result.current(100000)).toBe('$1,000.00')
		})

		it('leaves currency-less mode as grouped raw numbers (AC-5; story 14-2 grouping)', () => {
			useCurrencyStore.setState({ mode: 'none', currency: 'NONE' })
			const { result } = renderHook(() => useFormattedAmount())
			expect(result.current(100000)).toBe('1,000.00')
		})

		it('groups currency-less amounts with a neutral en-US locale even when a symbol currency is still retained (story 14-2 review)', () => {
			// { mode:'none', currency:'EUR' } is reachable; raw numbers must stay en-US.
			useCurrencyStore.setState({ mode: 'none', currency: 'EUR' })
			const { result } = renderHook(() => useFormattedAmount())
			expect(result.current(123456789)).toBe('1,234,567.89')

			useCurrencyStore.setState({ mode: 'none', currency: 'INR' })
			const { result: inr } = renderHook(() => useFormattedAmount())
			expect(inr.current(123456789)).toBe('1,234,567.89')
		})
	})

	describe('persistence / migration (AC-3)', () => {
		const STORAGE_KEY = 'budget-planner-currency-prefs-v1'

		const seed = (state: Record<string, unknown>, version: number) => {
			localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, version }))
		}

		it('migrates a legacy blob with locale/localeUserSet without error', async () => {
			seed({ mode: 'symbol', currency: 'EUR', locale: 'de-DE', localeUserSet: true }, 0)

			await expect(useCurrencyStore.persist.rehydrate()).resolves.not.toThrow()

			const state = useCurrencyStore.getState()
			expect(state.currency).toBe('EUR')
			expect(state.mode).toBe('symbol')
			expect('locale' in state).toBe(false)
			expect('localeUserSet' in state).toBe(false)

			const { result } = renderHook(() => useFormattedAmount())
			expect(normalizeSpaces(result.current(100000))).toBe('1.000,00 €')
		})

		it('rehydrates a current v1 blob unchanged', async () => {
			seed({ mode: 'symbol', currency: 'USD' }, 1)

			await useCurrencyStore.persist.rehydrate()

			expect(useCurrencyStore.getState().currency).toBe('USD')
			expect(useCurrencyStore.getState().mode).toBe('symbol')
		})

		it('falls back to the new symbol/USD default for a corrupt v0 blob missing mode/currency (story 22-1)', async () => {
			// migrate coalesces per field: a partial blob must not merge undefined over the defaults.
			seed({ locale: 'de-DE', localeUserSet: true }, 0)

			await expect(useCurrencyStore.persist.rehydrate()).resolves.not.toThrow()

			expect(useCurrencyStore.getState().mode).toBe('symbol')
			expect(useCurrencyStore.getState().currency).toBe('USD')
		})

		it('preserves an existing explicit currency-less choice (new default does NOT clobber it) (story 22-1 / AC-2)', async () => {
			// Pre-set the contrasting default so the assertion proves rehydrate restored the stored value.
			useCurrencyStore.setState({ mode: 'symbol', currency: 'USD' })
			seed({ mode: 'none', currency: 'NONE' }, 2)

			await useCurrencyStore.persist.rehydrate()

			expect(useCurrencyStore.getState().mode).toBe('none')
			expect(useCurrencyStore.getState().currency).toBe('NONE')

			const { result } = renderHook(() => useFormattedAmount())
			expect(result.current(100000)).toBe('1,000.00')
		})

		it('canonicalizes a persisted consolidated currency (v1 CAD → USD) (story 8-2 AC-3)', async () => {
			// CAD already rendered `$…`, so mapping to USD is lossless.
			seed({ mode: 'symbol', currency: 'CAD' }, 1)

			await expect(useCurrencyStore.persist.rehydrate()).resolves.not.toThrow()

			expect(useCurrencyStore.getState().currency).toBe('USD')
			expect(useCurrencyStore.getState().mode).toBe('symbol')

			const { result } = renderHook(() => useFormattedAmount())
			expect(result.current(100000)).toBe('$1,000.00')
		})

		it('leaves a non-consolidated persisted currency untouched (EUR stays EUR)', async () => {
			seed({ mode: 'symbol', currency: 'EUR' }, 1)

			await useCurrencyStore.persist.rehydrate()

			expect(useCurrencyStore.getState().currency).toBe('EUR')
			expect(useCurrencyStore.getState().mode).toBe('symbol')
		})

		it('canonicalizes alongside the v0 locale-strip path (v0 AUD → USD)', async () => {
			seed({ mode: 'symbol', currency: 'AUD', locale: 'en-AU', localeUserSet: true }, 0)

			await expect(useCurrencyStore.persist.rehydrate()).resolves.not.toThrow()

			const state = useCurrencyStore.getState()
			expect(state.currency).toBe('USD')
			expect(state.mode).toBe('symbol')
			expect('locale' in state).toBe(false)
		})
	})
})
