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
 *
 * BEFORE that, a narrower check unique to this endpoint: `PADDLE_ENVIRONMENT`
 * itself must be explicitly set. `packages/config`'s schema defaults it to
 * `sandbox` when unset (kept as-is — other Paddle code paths and their tests
 * rely on that default, and this story scopes the stricter behaviour to the
 * checkout entry point only, not the shared schema). This endpoint is the ONE
 * place that hands the browser both the environment AND a client token —
 * silently defaulting here is exactly the "ran against the wrong Paddle
 * account" failure mode a real-money checkout must never risk. A developer
 * exercising this checkout locally sets `PADDLE_ENVIRONMENT=sandbox` in `.env`
 * (already the value `.env.example` documents) — a deliberate choice, not a
 * default.
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
    if (process.env['PADDLE_ENVIRONMENT'] === undefined) {
      return json(
        {
          success: false,
          error:
            'PADDLE_ENVIRONMENT is not set. Refusing to silently default to sandbox for checkout — set it explicitly (sandbox or production).',
        },
        { status: 500 }
      )
    }

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
