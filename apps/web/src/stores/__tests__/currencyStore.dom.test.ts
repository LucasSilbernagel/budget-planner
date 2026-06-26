/**
 * Currency store locale tests (story 4-7, FR10 / UX-DR4).
 *
 * Covers the locale dimension added on top of the 4-6 currency control:
 * - deterministic default locale (SSR-safe)
 * - explicit user override (normalized + flagged so detection won't clobber it)
 * - browser auto-detection that respects an explicit choice
 * - the formatting hook actually threading locale into Intl.NumberFormat
 *
 * Runs in jsdom (`.dom.test`) so `navigator` exists and React hooks render.
 */

import { renderHook } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useCurrencyStore, useFormattedAmount } from '../currencyStore'

// de-DE uses U+00A0 before the symbol; fr-FR uses U+202F as the grouping
// separator. Normalize both to a plain space for human-readable assertions.
const normalizeSpaces = (value: string) => value.replace(/[  ]/g, ' ')

/** Override the jsdom navigator languages for a single test. */
function setBrowserLanguages(languages: string[]) {
  Object.defineProperty(window.navigator, 'languages', {
    value: languages,
    configurable: true,
  })
  Object.defineProperty(window.navigator, 'language', {
    value: languages[0],
    configurable: true,
  })
}

const originalLanguages = [...window.navigator.languages]

describe('currencyStore locale (story 4-7)', () => {
  beforeEach(() => {
    useCurrencyStore.setState({
      mode: 'none',
      currency: 'NONE',
      locale: 'en-US',
      localeUserSet: false,
    })
  })

  afterEach(() => {
    setBrowserLanguages(originalLanguages)
    localStorage.clear()
  })

  it('defaults to a deterministic en-US locale, not user-set', () => {
    expect(useCurrencyStore.getState().locale).toBe('en-US')
    expect(useCurrencyStore.getState().localeUserSet).toBe(false)
  })

  it('setLocale normalizes the value and flags it as user-set', () => {
    useCurrencyStore.getState().setLocale('de-AT') // unsupported region → de-DE
    expect(useCurrencyStore.getState().locale).toBe('de-DE')
    expect(useCurrencyStore.getState().localeUserSet).toBe(true)
  })

  it('setLocale maps a language-only tag to a supported locale', () => {
    useCurrencyStore.getState().setLocale('fr')
    expect(useCurrencyStore.getState().locale).toBe('fr-FR')
  })

  it('detectBrowserLocale applies the browser locale when none is user-set', () => {
    setBrowserLanguages(['de-DE'])
    useCurrencyStore.getState().detectBrowserLocale()
    expect(useCurrencyStore.getState().locale).toBe('de-DE')
  })

  it('detectBrowserLocale does NOT override an explicit user choice', () => {
    useCurrencyStore.getState().setLocale('fr-FR')
    setBrowserLanguages(['de-DE'])
    useCurrencyStore.getState().detectBrowserLocale()
    expect(useCurrencyStore.getState().locale).toBe('fr-FR')
  })

  it('detectBrowserLocale falls back to en-US for an unsupported browser locale', () => {
    setBrowserLanguages(['ko-KR'])
    useCurrencyStore.getState().detectBrowserLocale()
    expect(useCurrencyStore.getState().locale).toBe('en-US')
  })

  it('detectBrowserLocale is a no-op when no browser locale is exposed (does not clobber)', () => {
    // Seed a non-default, non-user-set locale, then make detection find nothing.
    useCurrencyStore.setState({ locale: 'de-DE', localeUserSet: false })
    setBrowserLanguages([]) // navigator.languages empty + language '' → readBrowserLocale() falsy
    useCurrencyStore.getState().detectBrowserLocale()
    // Without the !detected guard this would reset to the en-US fallback.
    expect(useCurrencyStore.getState().locale).toBe('de-DE')
  })

  describe('useFormattedAmount threads locale into Intl.NumberFormat', () => {
    it('formats EUR per de-DE conventions (AC-2)', () => {
      useCurrencyStore.setState({ mode: 'symbol', currency: 'EUR', locale: 'de-DE' })
      const { result } = renderHook(() => useFormattedAmount())
      expect(normalizeSpaces(result.current(100000))).toBe('1.000,00 €')
    })

    it('formats USD per en-US conventions (AC-1)', () => {
      useCurrencyStore.setState({ mode: 'symbol', currency: 'USD', locale: 'en-US' })
      const { result } = renderHook(() => useFormattedAmount())
      expect(result.current(100000)).toBe('$1,000.00')
    })
  })

  // Exercises the actual persist wiring (skipHydration + onRehydrateStorage),
  // not just the action in isolation — the path where findings hide.
  describe('persistence / rehydration', () => {
    const STORAGE_KEY = 'budget-planner-currency-prefs-v1'

    const seed = (state: Record<string, unknown>) => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, version: 0 }))
    }

    it('restores an explicit user-set locale and does NOT re-detect over it', async () => {
      seed({ mode: 'symbol', currency: 'EUR', locale: 'de-DE', localeUserSet: true })
      setBrowserLanguages(['fr-FR']) // browser disagrees with the saved choice

      await useCurrencyStore.persist.rehydrate()

      expect(useCurrencyStore.getState().locale).toBe('de-DE')
      expect(useCurrencyStore.getState().localeUserSet).toBe(true)
    })

    it('auto-detects on rehydration for a legacy blob without locale keys', async () => {
      seed({ mode: 'symbol', currency: 'EUR' }) // pre-4-7 shape: no locale/localeUserSet
      setBrowserLanguages(['de-DE'])

      await useCurrencyStore.persist.rehydrate()

      expect(useCurrencyStore.getState().locale).toBe('de-DE')
    })
  })
})
