/**
 * Currency store tests (story 8-1, FR25).
 *
 * The locale dimension is gone: formatting is derived purely from the selected
 * currency (localeForCurrency). Covers:
 * - the formatting hook deriving locale from currency (no locale ever set)
 * - graceful migration of a legacy blob carrying locale / localeUserSet (AC-3)
 *
 * Runs in jsdom (`.dom.test`) so React hooks render and persist can rehydrate.
 */

import { renderHook } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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

  it('defaults to the currency-less product default', () => {
    expect(useCurrencyStore.getState().mode).toBe('none')
    expect(useCurrencyStore.getState().currency).toBe('NONE')
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
      // The toggle leaves `currency` set when symbols are switched off, so
      // { mode:'none', currency:'EUR' } is reachable. Currency-less "raw numbers"
      // must NOT inherit EUR's de-DE format (1.234.567,89) — they stay en-US.
      useCurrencyStore.setState({ mode: 'none', currency: 'EUR' })
      const { result } = renderHook(() => useFormattedAmount())
      expect(result.current(123456789)).toBe('1,234,567.89')

      // Same for a non-Western-grouping currency like INR (would be 12,34,567.89).
      useCurrencyStore.setState({ mode: 'none', currency: 'INR' })
      const { result: inr } = renderHook(() => useFormattedAmount())
      expect(inr.current(123456789)).toBe('1,234,567.89')
    })
  })

  // Exercises the actual persist wiring (skipHydration + version/migrate).
  describe('persistence / migration (AC-3)', () => {
    const STORAGE_KEY = 'budget-planner-currency-prefs-v1'

    const seed = (state: Record<string, unknown>, version: number) => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, version }))
    }

    it('migrates a legacy blob with locale/localeUserSet without error', async () => {
      // Pre-8-1 shape (stories 4-6/4-7): version 0, carrying the obsolete keys.
      seed({ mode: 'symbol', currency: 'EUR', locale: 'de-DE', localeUserSet: true }, 0)

      await expect(useCurrencyStore.persist.rehydrate()).resolves.not.toThrow()

      const state = useCurrencyStore.getState()
      expect(state.currency).toBe('EUR')
      expect(state.mode).toBe('symbol')
      // Obsolete keys are dropped from state entirely.
      expect('locale' in state).toBe(false)
      expect('localeUserSet' in state).toBe(false)

      // Derived formatting still resolves correctly post-migration.
      const { result } = renderHook(() => useFormattedAmount())
      expect(normalizeSpaces(result.current(100000))).toBe('1.000,00 €')
    })

    it('rehydrates a current v1 blob unchanged', async () => {
      seed({ mode: 'symbol', currency: 'USD' }, 1)

      await useCurrencyStore.persist.rehydrate()

      expect(useCurrencyStore.getState().currency).toBe('USD')
      expect(useCurrencyStore.getState().mode).toBe('symbol')
    })

    it('falls back to defaults for a corrupt v0 blob missing mode/currency', async () => {
      // A partial/corrupt legacy blob must not shallow-merge undefined over the
      // deterministic defaults (migrate coalesces per field).
      seed({ locale: 'de-DE', localeUserSet: true }, 0)

      await expect(useCurrencyStore.persist.rehydrate()).resolves.not.toThrow()

      expect(useCurrencyStore.getState().mode).toBe('none')
      expect(useCurrencyStore.getState().currency).toBe('NONE')
    })

    it('canonicalizes a persisted consolidated currency (v1 CAD → USD) (story 8-2 AC-3)', async () => {
      // A user who picked CAD before consolidation: their money already rendered
      // `$…`, so mapping to USD is lossless and must not throw or blank the state.
      seed({ mode: 'symbol', currency: 'CAD' }, 1)

      await expect(useCurrencyStore.persist.rehydrate()).resolves.not.toThrow()

      expect(useCurrencyStore.getState().currency).toBe('USD')
      expect(useCurrencyStore.getState().mode).toBe('symbol')

      // The displayed money is unchanged — still `$1,000.00`.
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
      // Confirms the v0→(strip locale) migration still runs and the v2
      // canonicalize step also applies to a legacy pre-8-1 blob.
      seed({ mode: 'symbol', currency: 'AUD', locale: 'en-AU', localeUserSet: true }, 0)

      await expect(useCurrencyStore.persist.rehydrate()).resolves.not.toThrow()

      const state = useCurrencyStore.getState()
      expect(state.currency).toBe('USD')
      expect(state.mode).toBe('symbol')
      expect('locale' in state).toBe(false)
    })
  })
})
