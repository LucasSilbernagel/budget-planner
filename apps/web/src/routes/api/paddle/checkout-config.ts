/**
 * Public Paddle Billing checkout config
 *
 * Endpoint: GET /api/paddle/checkout-config
 *
 * Story 5-3, Task 2a. Exposes ONLY the browser-safe subset of
 * `getPaddleConfig()` that Paddle.js checkout needs client-side: the
 * environment, the client-side token, and the two catalog price IDs. The
 * server API key and webhook secret are never read here. No auth is required —
 * none of these values are secret (the client token is designed to ship in
 * the browser bundle; the price IDs are visible in any checkout request
 * anyway), matching how `/pricing` itself is a public, unauthenticated route.
 *
 * `assertPaddleProductionConfig()` runs first, mirroring the webhook route
 * (`routes/api/webhooks/paddle.ts`): a production deploy missing a secret/price
 * or with `annual === lifetime` fails this endpoint loudly (500) instead of
 * quietly telling every `/pricing` visitor checkout is unconfigured (AC-3).
 */

import { assertPaddleProductionConfig, getPaddleConfig } from '@budget-planner/config'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

/**
 * Exported standalone so it is unit-testable without a running server —
 * mirrors `routes/api/webhooks/paddle.ts`'s exported `POST`.
 */
export const GET = async (): Promise<Response> => {
  try {
    assertPaddleProductionConfig()

    const config = getPaddleConfig()

    return json({
      isConfigured: config.isConfigured,
      environment: config.environment,
      clientToken: config.clientToken ?? null,
      annualPriceId: config.annualPriceId ?? null,
      lifetimePriceId: config.lifetimePriceId ?? null,
    })
  } catch (error) {
    return json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export const Route = createFileRoute('/api/paddle/checkout-config')({
  server: {
    handlers: { GET },
  },
})
