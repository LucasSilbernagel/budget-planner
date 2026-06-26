/**
 * Locale Resolution Utilities
 *
 * Pure, isomorphic helpers for the currency-display locale dimension
 * (story 4-7, FR10 / UX-DR4). These complement `formatCurrency`, which already
 * accepts a `locale` and delegates to `Intl.NumberFormat` for native, per-locale
 * grouping/decimal/symbol placement (e.g. en-US `$1,000.00`, de-DE `1.000,00 €`,
 * fr-FR `1 000,00 €`).
 *
 * Browser detection (`navigator.language`) deliberately lives in the web layer
 * (the Zustand currency store), NOT here: `packages/core` is pure with no
 * environment side effects. This module only validates and normalizes a
 * candidate locale string, so it stays fully unit-testable in Node.
 */

/**
 * Default locale used when no preference is set and detection is unavailable.
 * Matches `DEFAULT_CURRENCY_OPTIONS.locale` in `./currency`.
 */
export const DEFAULT_LOCALE = 'en-US'

/** A user-selectable locale with a human-readable label for UI selectors. */
export interface SupportedLocale {
  /** BCP-47 language tag, e.g. `de-DE`. */
  code: string
  /** Display label for selectors, e.g. `German (Germany)`. */
  label: string
}

/**
 * Curated list of locales offered in the UI. The set is intentionally small and
 * EU-leaning (matching the project's data-sovereignty focus) plus a few common
 * non-EU locales. `Intl.NumberFormat` supports far more, but a curated list
 * keeps the selector and the persisted store value bounded and predictable.
 */
export const SUPPORTED_LOCALES: readonly SupportedLocale[] = [
  { code: 'en-US', label: 'English (United States)' },
  { code: 'en-GB', label: 'English (United Kingdom)' },
  { code: 'de-DE', label: 'German (Germany)' },
  { code: 'fr-FR', label: 'French (France)' },
  { code: 'es-ES', label: 'Spanish (Spain)' },
  { code: 'it-IT', label: 'Italian (Italy)' },
  { code: 'nl-NL', label: 'Dutch (Netherlands)' },
  { code: 'pt-PT', label: 'Portuguese (Portugal)' },
  { code: 'ja-JP', label: 'Japanese (Japan)' },
  { code: 'zh-CN', label: 'Chinese (China)' },
] as const

/** Returns the curated list of user-selectable locales (for UI selectors). */
export function getSupportedLocales(): readonly SupportedLocale[] {
  return SUPPORTED_LOCALES
}

/** True if `locale` is one of the curated, selectable locale codes. */
export function isLocaleSupported(locale: string): boolean {
  return SUPPORTED_LOCALES.some((entry) => entry.code === locale)
}

/**
 * Resolves an arbitrary candidate locale (e.g. from `navigator.language`, a URL,
 * or a persisted preference) to a supported locale code.
 *
 * Resolution order:
 * 1. Empty / non-string candidate → `fallback`.
 * 2. Invalid BCP-47 tag (rejected by `Intl.getCanonicalLocales`) → `fallback`.
 * 3. Exact match against the curated list → that code.
 * 4. Match by primary language subtag (e.g. `de`, `de-AT` → `de-DE`).
 * 5. Otherwise → `fallback`.
 *
 * Always returns a value within {@link SUPPORTED_LOCALES} (or `fallback`), so the
 * result is safe to store and to feed back into the UI selector.
 *
 * @param candidate - Raw locale string to normalize (nullable/undefined allowed).
 * @param fallback - Locale to use when the candidate can't be resolved.
 * @returns A supported locale code.
 */
export function resolveLocale(
  candidate: string | null | undefined,
  fallback: string = DEFAULT_LOCALE
): string {
  if (!candidate || typeof candidate !== 'string' || candidate.trim() === '') {
    return fallback
  }

  let canonical: string | undefined
  try {
    ;[canonical] = Intl.getCanonicalLocales(candidate.trim())
  } catch {
    // RangeError for malformed tags
    return fallback
  }

  if (!canonical) return fallback

  // Exact supported match (case already canonicalized by Intl, e.g. EN-us → en-US)
  if (isLocaleSupported(canonical)) return canonical

  // Fall back to the first supported locale sharing the primary language subtag.
  const language = primaryLanguage(canonical)
  const byLanguage = SUPPORTED_LOCALES.find((entry) => primaryLanguage(entry.code) === language)

  return byLanguage ? byLanguage.code : fallback
}

/** Lowercased primary language subtag of a BCP-47 tag (e.g. `de-AT` → `de`). */
function primaryLanguage(tag: string): string {
  return (tag.split('-')[0] ?? tag).toLowerCase()
}
