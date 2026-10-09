import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useCurrencyStore } from '../currencyStore'

describe('currencyStore', () => {
	beforeEach(() => {
		useCurrencyStore.setState({ mode: 'none', currency: 'NONE' })
	})

	afterEach(() => {
		localStorage.clear()
	})

	it('defaults new users to explicit USD symbols', () => {
		// The product default lives on the store's initial state, independent of the suite's
		// currency-less baseline.
		const initial = useCurrencyStore.getInitialState()
		expect(initial.mode).toBe('symbol')
		expect(initial.currency).toBe('USD')
	})

	describe('persistence / migration', () => {
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
		})

		it('rehydrates a current v1 blob unchanged', async () => {
			seed({ mode: 'symbol', currency: 'USD' }, 1)

			await useCurrencyStore.persist.rehydrate()

			expect(useCurrencyStore.getState().currency).toBe('USD')
			expect(useCurrencyStore.getState().mode).toBe('symbol')
		})

		it('falls back to the new symbol/USD default for a corrupt v0 blob missing mode/currency', async () => {
			// migrate coalesces per field: a partial blob must not merge undefined over the defaults.
			seed({ locale: 'de-DE', localeUserSet: true }, 0)

			await expect(useCurrencyStore.persist.rehydrate()).resolves.not.toThrow()

			expect(useCurrencyStore.getState().mode).toBe('symbol')
			expect(useCurrencyStore.getState().currency).toBe('USD')
		})

		it('preserves an existing explicit currency-less choice (new default does NOT clobber it)', async () => {
			// Pre-set the contrasting default so the assertion proves rehydrate restored the stored value.
			useCurrencyStore.setState({ mode: 'symbol', currency: 'USD' })
			seed({ mode: 'none', currency: 'NONE' }, 2)

			await useCurrencyStore.persist.rehydrate()

			expect(useCurrencyStore.getState().mode).toBe('none')
			expect(useCurrencyStore.getState().currency).toBe('NONE')
		})

		it('canonicalizes a persisted consolidated currency (v1 CAD → USD)', async () => {
			// CAD already rendered `$…`, so mapping to USD is lossless.
			seed({ mode: 'symbol', currency: 'CAD' }, 1)

			await expect(useCurrencyStore.persist.rehydrate()).resolves.not.toThrow()

			expect(useCurrencyStore.getState().currency).toBe('USD')
			expect(useCurrencyStore.getState().mode).toBe('symbol')
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
