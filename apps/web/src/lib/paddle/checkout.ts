/**
 * Paddle.js Billing checkout — client-side helper (Story 5-3, Task 2a).
 *
 * Wraps `@paddle/paddle-js` behind two small functions so the component layer
 * never touches the SDK singleton or its CDN-loaded state directly:
 *   - `getPaddleInstance` lazy-loads and initializes the SDK exactly once per
 *     page load (`initializePaddle` itself injects the `cdn.paddle.com`
 *     script — already CSP-allow-listed, see `security-headers.ts`).
 *   - `openPaddleCheckout` opens the overlay for a single price.
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
 * Opens the Paddle Billing checkout overlay for one price.
 *
 * `customerEmail` pre-fills the checkout's email field when the buyer is
 * already signed in (5.16 magic-link session) so they aren't asked to retype
 * an address Paddle will key the webhook's `data.customer_id` resolution off
 * of anyway.
 */
export function openPaddleCheckout(paddle: Paddle, priceId: string, customerEmail?: string): void {
  paddle.Checkout.open({
    items: [{ priceId, quantity: 1 }],
    ...(customerEmail ? { customer: { email: customerEmail } } : {}),
  })
}
