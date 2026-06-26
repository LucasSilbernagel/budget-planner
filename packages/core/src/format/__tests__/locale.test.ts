/**
 * Locale Resolution Tests (story 4-7, FR10 / UX-DR4).
 *
 * Validates the pure locale helpers that back the currency-display locale
 * dimension: a curated supported-locale list, validation, and robust
 * normalization of arbitrary candidate strings (browser language, persisted
 * preference, etc.) down to a supported locale.
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  getSupportedLocales,
  isLocaleSupported,
  resolveLocale,
} from '../locale.js'

describe('locale helpers', () => {
  describe('DEFAULT_LOCALE / SUPPORTED_LOCALES', () => {
    it('defaults to en-US', () => {
      expect(DEFAULT_LOCALE).toBe('en-US')
    })

    it('includes the AC locales (en-US, de-DE, fr-FR)', () => {
      const codes = SUPPORTED_LOCALES.map((entry) => entry.code)
      expect(codes).toContain('en-US')
      expect(codes).toContain('de-DE')
      expect(codes).toContain('fr-FR')
    })

    it('exposes the curated list via getSupportedLocales', () => {
      expect(getSupportedLocales()).toBe(SUPPORTED_LOCALES)
      for (const entry of getSupportedLocales()) {
        expect(entry.code).toBeTruthy()
        expect(entry.label).toBeTruthy()
      }
    })
  })

  describe('isLocaleSupported', () => {
    it('accepts curated codes', () => {
      expect(isLocaleSupported('de-DE')).toBe(true)
      expect(isLocaleSupported('en-US')).toBe(true)
    })

    it('rejects non-curated or malformed codes', () => {
      expect(isLocaleSupported('de')).toBe(false)
      expect(isLocaleSupported('xx-YY')).toBe(false)
      expect(isLocaleSupported('')).toBe(false)
    })
  })

  describe('resolveLocale', () => {
    it('returns the fallback for empty / nullish input', () => {
      expect(resolveLocale(undefined)).toBe(DEFAULT_LOCALE)
      expect(resolveLocale(null)).toBe(DEFAULT_LOCALE)
      expect(resolveLocale('')).toBe(DEFAULT_LOCALE)
      expect(resolveLocale('   ')).toBe(DEFAULT_LOCALE)
    })

    it('passes through an exact supported locale', () => {
      expect(resolveLocale('de-DE')).toBe('de-DE')
      expect(resolveLocale('fr-FR')).toBe('fr-FR')
    })

    it('canonicalizes casing before matching', () => {
      expect(resolveLocale('DE-de')).toBe('de-DE')
      expect(resolveLocale('en-us')).toBe('en-US')
    })

    it('maps a language-only tag to a supported regional locale', () => {
      expect(resolveLocale('de')).toBe('de-DE')
      expect(resolveLocale('fr')).toBe('fr-FR')
    })

    it('maps an unsupported region to the supported locale of the same language', () => {
      expect(resolveLocale('de-AT')).toBe('de-DE')
      expect(resolveLocale('fr-CA')).toBe('fr-FR')
    })

    it('falls back when the language has no supported locale', () => {
      // Korean is a valid tag but not in the curated list → fallback.
      expect(resolveLocale('ko-KR')).toBe(DEFAULT_LOCALE)
    })

    it('honors a custom fallback', () => {
      expect(resolveLocale('ko-KR', 'de-DE')).toBe('de-DE')
      expect(resolveLocale(undefined, 'fr-FR')).toBe('fr-FR')
    })

    it('returns the fallback for malformed BCP-47 tags', () => {
      expect(resolveLocale('not a locale!!')).toBe(DEFAULT_LOCALE)
      expect(resolveLocale('en_US_extra_garbage')).toBe(DEFAULT_LOCALE)
    })
  })
})
