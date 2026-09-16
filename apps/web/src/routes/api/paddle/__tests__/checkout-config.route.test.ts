/**
 * GET /api/paddle/checkout-config (Story 5-3, Task 2a).
 *
 * Drives the real `@budget-planner/config` module through env vars (same
 * technique as `server/__tests__/paddle-config-assertion.test.ts`) rather than
 * mocking it, so the fail-closed production guard is exercised for real.
 */

import { resetConfig } from '@budget-planner/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getCurrentUserSession } = vi.hoisted(() => ({ getCurrentUserSession: vi.fn() }))
vi.mock('@/server/api/auth/paddle', () => ({ getCurrentUserSession }))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { GET } from '../checkout-config'

/**
 * Call the route the way the framework does. Story 5-19 (AC-5) made this
 * endpoint session-aware, so it now takes a `request`.
 */
function GETWith(request = new Request('https://app.test/api/paddle/checkout-config')) {
  return GET({ request })
}

const PADDLE_KEYS = [
  'NODE_ENV',
  'PADDLE_ENVIRONMENT',
  'PADDLE_API_KEY',
  'PADDLE_CLIENT_TOKEN',
  'PADDLE_WEBHOOK_SECRET',
  'PADDLE_ANNUAL_PRICE_ID',
  'PADDLE_LIFETIME_PRICE_ID',
] as const

const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of PADDLE_KEYS) saved[k] = process.env[k]
  for (const k of PADDLE_KEYS) delete process.env[k]
  resetConfig()
  // Default: an anonymous visitor, resolved successfully. Every pre-5-19 test
  // in this file describes that case.
  getCurrentUserSession.mockReset()
  getCurrentUserSession.mockResolvedValue({ success: true, data: null })
})

afterEach(() => {
  for (const k of PADDLE_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  resetConfig()
})

function withEnv(env: Partial<Record<(typeof PADDLE_KEYS)[number], string>>) {
  for (const [k, v] of Object.entries(env)) process.env[k] = v
  resetConfig()
}

describe('GET /api/paddle/checkout-config', () => {
  it('returns the public config in development, never the server API key or webhook secret', async () => {
    withEnv({
      NODE_ENV: 'development',
      PADDLE_ENVIRONMENT: 'sandbox',
      PADDLE_API_KEY: 'pdl_sandbox_secret',
      PADDLE_CLIENT_TOKEN: 'test_client_token',
      PADDLE_WEBHOOK_SECRET: 'pdl_ntfset_secret',
      PADDLE_ANNUAL_PRICE_ID: 'pri_annual',
      PADDLE_LIFETIME_PRICE_ID: 'pri_lifetime',
    })

    const response = await GETWith()
    expect(response.status).toBe(200)
    const body = await response.json()

    expect(body).toEqual({
      isConfigured: true,
      environment: 'sandbox',
      clientToken: 'test_client_token',
      annualPriceId: 'pri_annual',
      lifetimePriceId: 'pri_lifetime',
    })
    expect(JSON.stringify(body)).not.toContain('secret')
  })

  it('returns isConfigured:false with null fields when PADDLE_ENVIRONMENT is explicitly sandbox but nothing else is set', async () => {
    withEnv({ PADDLE_ENVIRONMENT: 'sandbox' })
    const response = await GETWith()
    expect(response.status).toBe(200)
    const body = await response.json()

    expect(body).toEqual({
      isConfigured: false,
      environment: 'sandbox',
      clientToken: null,
      annualPriceId: null,
      lifetimePriceId: null,
    })
  })

  it('fails loudly (500) rather than silently when production is misconfigured, without leaking which var is missing', async () => {
    withEnv({ NODE_ENV: 'production', PADDLE_ENVIRONMENT: 'production' })

    const response = await GETWith()
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.success).toBe(false)
    // Regression: this endpoint is unauthenticated and unrate-limited, so the
    // raw assertion message (which names every unset PADDLE_* var) must never
    // reach the caller — that would make it a free "which secrets are
    // missing" probe. The detail is logged server-side instead.
    expect(body.error).not.toMatch(/PADDLE_API_KEY/)
    expect(body.error).toBe('Checkout is not available right now.')
  })

  it('fails loudly (500) when PADDLE_ENVIRONMENT itself was never set — never silently defaults', async () => {
    // No withEnv() call: PADDLE_ENVIRONMENT is deleted by beforeEach and never
    // set, unlike every other test in this file. This is the one case this
    // endpoint refuses to let the schema's `.default('sandbox')` paper over —
    // see the docblock on `GET` for why.
    const response = await GETWith()
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.success).toBe(false)
    expect(body.error).toMatch(/PADDLE_ENVIRONMENT is not set/)
  })

  it('fails loudly (500) when PADDLE_ENVIRONMENT is declared with an EMPTY value — same as unset', async () => {
    // Regression: `PADDLE_ENVIRONMENT=` (declared, no value) previously
    // skipped the tailored diagnostic above (`'' !== undefined`) and fell
    // through to the generic catch-all message instead.
    withEnv({ PADDLE_ENVIRONMENT: '' })
    const response = await GETWith()
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error).toMatch(/PADDLE_ENVIRONMENT is not set/)
  })

  it('trims a price ID before handing it to the browser', async () => {
    // A pasted secret with a trailing newline is a common shape; the webhook
    // already trims for its match, so the browser-facing value must match.
    withEnv({
      NODE_ENV: 'development',
      PADDLE_ENVIRONMENT: 'sandbox',
      PADDLE_API_KEY: 'pdl_sandbox_secret',
      PADDLE_CLIENT_TOKEN: 'test_client_token',
      PADDLE_WEBHOOK_SECRET: 'pdl_ntfset_secret',
      PADDLE_ANNUAL_PRICE_ID: '  pri_annual\n',
      PADDLE_LIFETIME_PRICE_ID: 'pri_lifetime\t',
    })

    const response = await GETWith()
    const body = await response.json()

    expect(body.annualPriceId).toBe('pri_annual')
    expect(body.lifetimePriceId).toBe('pri_lifetime')
  })

  it('never lets an intermediary cache the response, success or failure', async () => {
    withEnv({ NODE_ENV: 'development', PADDLE_ENVIRONMENT: 'sandbox' })
    const ok = await GETWith()
    expect(ok.status).toBe(200)
    expect(ok.headers.get('cache-control')).toBe('no-store')

    withEnv({ NODE_ENV: 'production', PADDLE_ENVIRONMENT: 'production' })
    const failed = await GETWith()
    expect(failed.status).toBe(500)
    expect(failed.headers.get('cache-control')).toBe('no-store')
  })
})

/**
 * Story 5-19, AC-5 — the server-side already-Premium guard.
 *
 * Before this, nothing server-side rejected a second purchase: the ONLY thing
 * between an entitled user and a duplicate real charge was a client render
 * guard that fell through whenever the session seed was `null`.
 */
describe('GET /api/paddle/checkout-config — already-entitled guard (5-19 AC-5)', () => {
  function configured() {
    withEnv({
      NODE_ENV: 'development',
      PADDLE_ENVIRONMENT: 'sandbox',
      PADDLE_API_KEY: 'pdl_sandbox_secret',
      PADDLE_CLIENT_TOKEN: 'test_client_token',
      PADDLE_WEBHOOK_SECRET: 'pdl_ntfset_secret',
      PADDLE_ANNUAL_PRICE_ID: 'pri_annual',
      PADDLE_LIFETIME_PRICE_ID: 'pri_lifetime',
    })
  }

  it.each(['active', 'past_due', 'lifetime'])(
    'refuses (403) to mint checkout config for a %s session, and hands back no client token',
    async (subscriptionStatus) => {
      configured()
      getCurrentUserSession.mockResolvedValue({
        success: true,
        data: { userId: 'u1', email: 'a@example.test', subscriptionStatus },
      })

      const response = await GETWith()

      expect(response.status).toBe(403)
      const body = await response.json()
      expect(body.alreadyEntitled).toBe(true)
      // The point of the guard: an entitled caller cannot obtain the material
      // needed to open a checkout, whatever the client believes.
      expect(body.clientToken).toBeUndefined()
      expect(body.annualPriceId).toBeUndefined()
      expect(body.lifetimePriceId).toBeUndefined()
    }
  )

  it('still serves a canceled subscriber — resubscribing is the intended path', async () => {
    configured()
    getCurrentUserSession.mockResolvedValue({
      success: true,
      data: { userId: 'u1', email: 'a@example.test', subscriptionStatus: 'canceled' },
    })

    const response = await GETWith()

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.clientToken).toBe('test_client_token')
  })

  it('still serves a free signed-in user', async () => {
    configured()
    getCurrentUserSession.mockResolvedValue({
      success: true,
      data: { userId: 'u1', email: 'a@example.test', subscriptionStatus: 'free' },
    })

    const response = await GETWith()
    expect(response.status).toBe(200)
  })

  it('FAILS CLOSED (503) when the session cannot be resolved — never sells on a guess', async () => {
    // An unresolvable session is not "anonymous": we do not know who this is,
    // and the wrong direction charges a paying customer twice. The same outage
    // would also stop the webhook recording the purchase.
    configured()
    getCurrentUserSession.mockResolvedValue({ success: false, error: 'db down' })

    const response = await GETWith()

    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.success).toBe(false)
    expect(body.clientToken).toBeUndefined()
  })

  it('never lets an intermediary cache a refusal', async () => {
    configured()
    getCurrentUserSession.mockResolvedValue({
      success: true,
      data: { userId: 'u1', email: 'a@example.test', subscriptionStatus: 'lifetime' },
    })

    const response = await GETWith()
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})
