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

import { logger } from '@/lib/logger'
import { assertPaddleProductionConfig, getPaddleConfig } from '@budget-planner/config'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

/**
 * This endpoint is deliberately public and unauthenticated (see the module
 * docblock) — a free deployment-health probe otherwise, so its responses must
 * never be cached by an intermediary.
 *
 * A fresh object per call, not a shared module-level constant: `json()`
 * copies these into a `Headers` instance, so aliasing is harmless today, but
 * a single mutable object handed to every response in the process is a latent
 * footgun for the next person who reaches for `NO_STORE.headers[...] = ...`.
 */
function noStoreHeaders() {
  return { headers: { 'Cache-Control': 'no-store' } }
}

/**
 * Exported standalone so it is unit-testable without a running server —
 * mirrors `routes/api/webhooks/paddle.ts`'s exported `POST`.
 */
export const GET = async (): Promise<Response> => {
  try {
    // Treat an explicitly-empty value the same as unset — `PADDLE_ENVIRONMENT=`
    // (declared, no value) must not skip this endpoint's tailored diagnostic
    // and fall through to the schema's `z.enum` throwing with only the
    // generic catch-all message below.
    if (!process.env['PADDLE_ENVIRONMENT']) {
      return json(
        {
          success: false,
          error:
            'PADDLE_ENVIRONMENT is not set. Refusing to silently default to sandbox for checkout — set it explicitly (sandbox or production).',
        },
        { status: 500, ...noStoreHeaders() }
      )
    }

    assertPaddleProductionConfig()

    const config = getPaddleConfig()

    return json(
      {
        isConfigured: config.isConfigured,
        environment: config.environment,
        clientToken: config.clientToken ?? null,
        // Trimmed, mirroring the webhook's price-match trimming — an id
        // pasted with a trailing newline (a common pasted-secret shape)
        // would otherwise pass every config check here but get silently
        // rejected by `Paddle.Checkout.open` client-side.
        annualPriceId: config.annualPriceId?.trim() ?? null,
        lifetimePriceId: config.lifetimePriceId?.trim() ?? null,
      },
      noStoreHeaders()
    )
  } catch (error) {
    // `assertPaddleProductionConfig()`'s message enumerates exactly which
    // PADDLE_* vars are unset — useful to an operator, but this route is
    // unauthenticated and unrate-limited, so it must not become a free
    // "which secrets are missing" probe. Log the detail; return a generic one.
    //
    // Logged at `debug`, not `error`: while this endpoint stays misconfigured,
    // EVERY `/pricing` pageview hits this branch, and primary alerting on a
    // broken production deploy should come from 5xx-rate monitoring, not this
    // route flooding the error log once per visitor (the same log-amplification
    // concern the 2026-09-10 pass fixed on the webhook's pre-auth path).
    logger.debug('Paddle checkout-config: production config assertion failed', { error })
    return json(
      { success: false, error: 'Checkout is not available right now.' },
      { status: 500, ...noStoreHeaders() }
    )
  }
}

export const Route = createFileRoute('/api/paddle/checkout-config')({
  server: {
    handlers: { GET },
  },
})
