/**
 * Paddle.js Billing checkout — client-side helper (Story 5-3, Task 2a).
 *
 * Wraps `@paddle/paddle-js` behind three small functions so the component layer
 * never touches the SDK singleton or its CDN-loaded state directly:
 *   - `getPaddleInstance` lazy-loads and initializes the SDK exactly once per
 *     page load (`initializePaddle` itself injects the `cdn.paddle.com`
 *     script — already CSP-allow-listed, see `security-headers.ts`).
 *   - `getLocalizedPlanPrices` fetches country-localized totals via
 *     `Paddle.PricePreview()` for both catalog prices in one call.
 *   - `openPaddleCheckout` opens the one-page overlay checkout for a single
 *     price.
 *
 * Reuses the fetched config's `environment` (sandbox | production) and
 * `clientToken` from `/api/paddle/checkout-config` — never a hardcoded value,
 * so sandbox testing and production behave identically in this module.
 */

import type { Environments, Paddle } from '@paddle/paddle-js'

export interface PaddleCheckoutClientConfig {
  environment: Environments
  clientToken: string
}

// Module-level singleton: Paddle.js itself is a singleton (it injects one
// script tag and hangs its instance off `window.Paddle`), so re-initializing
// per checkout attempt would be redundant work at best and a duplicate
// `<script>` tag at worst. Reset only happens on a full page reload.
let paddleInstancePromise: Promise<Paddle | undefined> | null = null

/** Lazily loads and initializes Paddle.js. Safe to call more than once. */
export function getPaddleInstance(config: PaddleCheckoutClientConfig): Promise<Paddle | undefined> {
  if (!paddleInstancePromise) {
    paddleInstancePromise = import('@paddle/paddle-js').then(({ initializePaddle }) =>
      initializePaddle({ token: config.clientToken, environment: config.environment })
    )
  }
  return paddleInstancePromise
}

/** Resets the cached instance. Test-only — production never needs to re-init. */
export function resetPaddleInstanceForTests(): void {
  paddleInstancePromise = null
}

/**
 * Paddle's own pre-formatted breakdown for one price — every field is a
 * ready-to-display string (e.g. "€39.00"), never a number to do math on.
 */
export interface LocalizedPriceBreakdown {
  subtotal: string
  tax: string
  total: string
}

export interface LocalizedPlanPrices {
  /** Paddle's own pre-formatted breakdown for the annual price. */
  annual: LocalizedPriceBreakdown | null
  /** Paddle's own pre-formatted breakdown for the lifetime price. */
  lifetime: LocalizedPriceBreakdown | null
}

/**
 * Fetches a country-localized price breakdown for both catalog prices in one
 * `Paddle.PricePreview()` call.
 *
 * Deliberately passes NO country/address — Paddle auto-detects the visitor's
 * location from their IP when none is given, which is exactly what we want:
 * this app runs on DanubeData Rapids, which sets no geo-IP request header
 * (unlike, say, Vercel's `x-vercel-ip-country`), so there is nothing to read
 * server-side and nothing to thread through here.
 *
 * Returns ONLY the pre-formatted `formattedTotals` strings Paddle computes —
 * never do price math or re-format these (no `Intl.NumberFormat`, no
 * rounding, no subtracting subtotal from total to "derive" tax): Paddle
 * already applied the visitor's currency, locale and tax treatment, and
 * reformatting or recomputing risks silently diverging from what checkout
 * will actually charge.
 */
export async function getLocalizedPlanPrices(
  paddle: Paddle,
  priceIds: { annualPriceId: string; lifetimePriceId: string }
): Promise<LocalizedPlanPrices> {
  const preview = await paddle.PricePreview({
    items: [
      { priceId: priceIds.annualPriceId, quantity: 1 },
      { priceId: priceIds.lifetimePriceId, quantity: 1 },
    ],
  })

  const breakdownFor = (priceId: string): LocalizedPriceBreakdown | null => {
    const formatted = preview.data.details.lineItems.find(
      (item) => item.price.id === priceId
    )?.formattedTotals
    return formatted
      ? { subtotal: formatted.subtotal, tax: formatted.tax, total: formatted.total }
      : null
  }

  return {
    annual: breakdownFor(priceIds.annualPriceId),
    lifetime: breakdownFor(priceIds.lifetimePriceId),
  }
}

/**
 * Opens the Paddle Billing checkout as a one-page overlay for one price.
 *
 * `customerEmail` pre-fills the checkout's email field when the buyer is
 * already signed in (5.16 magic-link session) so they aren't asked to retype
 * an address Paddle will key the webhook's `data.customer_id` resolution off
 * of anyway. `successUrl` sends the buyer to `/welcome` once Paddle confirms
 * the purchase, rather than leaving the overlay's own generic confirmation as
 * the only feedback.
 */
export function openPaddleCheckout(
  paddle: Paddle,
  priceId: string,
  options: { customerEmail?: string; successUrl: string }
): void {
  paddle.Checkout.open({
    items: [{ priceId, quantity: 1 }],
    settings: { displayMode: 'overlay', variant: 'one-page', successUrl: options.successUrl },
    ...(options.customerEmail ? { customer: { email: options.customerEmail } } : {}),
  })
}
