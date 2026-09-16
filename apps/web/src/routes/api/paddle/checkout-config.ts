/**
 * Public Paddle Billing checkout config
 *
 * Endpoint: GET /api/paddle/checkout-config
 *
 * Story 5-3, Task 2a. Exposes ONLY the browser-safe subset of
 * `getPaddleConfig()` that Paddle.js checkout needs client-side: the
 * environment, the client-side token, and the two catalog price IDs. The
 * server API key and webhook secret are never read here. No auth is REQUIRED —
 * none of these values are secret (the client token is designed to ship in
 * the browser bundle; the price IDs are visible in any checkout request
 * anyway), matching how `/pricing` itself is a public, unauthenticated route.
 *
 * ⚠️ Story 5-19 (AC-5): the endpoint stays public, but it now READS the session
 * when one is present and REFUSES (403) an already-entitled user, so a second
 * real charge cannot be started from a stale or failed client-side guard. It
 * also fails closed (503) when the session cannot be resolved at all. See the
 * inline rationale in the handler.
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
import { getCurrentUserSession } from '@/server/api/auth/paddle'
import { assertPaddleProductionConfig, getPaddleConfig } from '@budget-planner/config'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

/**
 * Statuses that already carry paid access. A session in one of these is
 * refused checkout configuration (Story 5-19, AC-5).
 *
 * `canceled` is deliberately absent: that subscription has ended, so checkout
 * is the correct way to resubscribe — blocking it would be a regression for a
 * real customer.
 */
const ENTITLED_STATUSES: readonly string[] = ['active', 'past_due', 'lifetime']

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
export const GET = async ({ request }: { request: Request }): Promise<Response> => {
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

    // AC-5: refuse to mint checkout configuration for a session that ALREADY
    // has paid access. Until now the only thing standing between an entitled
    // user and a second real charge was a client-side render guard that fails
    // open on an unverified session seed — a guard against a real-money outcome
    // living entirely in optional client state.
    //
    // ⚠️ FAILS CLOSED when the session cannot be resolved. An unresolvable
    // session is not "anonymous": we genuinely do not know, and the wrong
    // direction here charges a paying customer twice. The same outage that
    // breaks session resolution also stops the webhook recording a purchase, so
    // there is nothing coherent to sell during one. An anonymous visitor
    // resolves normally (`data: null`) and is unaffected.
    const session = await getCurrentUserSession(request)
    if (!session.success) {
      logger.warn(
        'Paddle checkout-config: session unresolvable — refusing checkout (fail closed)',
        {
          error: session.error,
        }
      )
      return json(
        { success: false, error: 'Checkout is not available right now.' },
        { status: 503, ...noStoreHeaders() }
      )
    }
    if (session.data && ENTITLED_STATUSES.includes(session.data.subscriptionStatus)) {
      logger.info('Paddle checkout-config: refused for an already-entitled session', {
        subscriptionStatus: session.data.subscriptionStatus,
      })
      return json(
        {
          success: false,
          error: 'You already have Premium access — there is nothing to buy here.',
          alreadyEntitled: true,
        },
        { status: 403, ...noStoreHeaders() }
      )
    }

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
