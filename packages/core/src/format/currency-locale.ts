/**
 * Currency → locale mapping (story 8-1, FR25).
 *
 * Currency selection alone drives formatting: each supported currency maps to
 * its canonical regional BCP-47 locale, which `formatCurrency` feeds to
 * `Intl.NumberFormat` for native per-region grouping/decimal/symbol placement
 * (e.g. `EUR → 1.000,00 €`, `GBP → £1,000.00`, `JPY → ￥1,000`).
 *
 * This replaces the separate user-chosen locale dimension from stories 4-6/4-7.
 * It is a pure, isomorphic function of the currency code, so it is inherently
 * SSR-safe (no `navigator`/DOM/env access) and belongs in `packages/core`.
 */

import type { CurrencyCode } from './currency.js'

/**
 * Default locale used as a defensive fallback for any currency code without an
 * explicit mapping (including `NONE`, which never actually reaches the formatter
 * because currency-less mode short-circuits first).
 */
export const DEFAULT_LOCALE = 'en-US'

/**
 * Canonical regional locale for each supported currency.
 *
 * Covers every code in `getSupportedCurrencies()`. `EUR` has no single regional
 * format; it defaults to `de-DE` (largest eurozone economy, aligns with the
 * project's Germany/EU data-sovereignty posture) — see story 8-1 Decision D1.
 */
const CURRENCY_LOCALE: Readonly<Record<string, string>> = {
  USD: 'en-US',
  EUR: 'de-DE',
  GBP: 'en-GB',
  JPY: 'ja-JP',
  CAD: 'en-CA',
  AUD: 'en-AU',
  CHF: 'de-CH',
  CNY: 'zh-CN',
  INR: 'en-IN',
  BRL: 'pt-BR',
  ZAR: 'en-ZA',
  MXN: 'es-MX',
}

/**
 * Resolves the regional formatting locale for a currency code.
 *
 * @param currency - Supported currency code.
 * @returns The currency's canonical regional locale, or {@link DEFAULT_LOCALE}
 *   for any unmapped code.
 */
export function localeForCurrency(currency: CurrencyCode): string {
  return CURRENCY_LOCALE[currency] ?? DEFAULT_LOCALE
}
