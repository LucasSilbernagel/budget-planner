/**
 * `assertPaddleProductionConfig()` — the fail-closed guard for Paddle Billing
 * (Story 5-3). `packages/config` has no test suite of its own; this exercises the
 * real (built) assertion the webhook route depends on, driven through env vars.
 *
 * The webhook's own test mocks the assertion to a no-op, so without this the
 * revenue-critical "crash instead of silently earning nothing" behaviour ships
 * untested.
 */

import { assertPaddleProductionConfig, resetConfig } from '@budget-planner/config'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const PADDLE_KEYS = [
  'NODE_ENV',
  'PADDLE_ENVIRONMENT',
  'PADDLE_API_KEY',
  'PADDLE_CLIENT_TOKEN',
  'PADDLE_WEBHOOK_SECRET',
  'PADDLE_ANNUAL_PRICE_ID',
  'PADDLE_LIFETIME_PRICE_ID',
  'PADDLE_MONTHLY_PRICE_ID',
] as const

const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of PADDLE_KEYS) saved[k] = process.env[k]
  for (const k of PADDLE_KEYS) delete process.env[k]
  resetConfig()
})

afterEach(() => {
  for (const k of PADDLE_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  resetConfig()
})

/** Set env and re-load the config singleton. */
function withEnv(env: Partial<Record<(typeof PADDLE_KEYS)[number], string>>) {
  for (const [k, v] of Object.entries(env)) process.env[k] = v
  resetConfig()
}

const FULL = {
  PADDLE_API_KEY: 'pdl_live_x',
  PADDLE_CLIENT_TOKEN: 'live_x',
  PADDLE_WEBHOOK_SECRET: 'pdl_ntfset_x',
  PADDLE_MONTHLY_PRICE_ID: 'pri_monthly',
  PADDLE_ANNUAL_PRICE_ID: 'pri_annual',
  PADDLE_LIFETIME_PRICE_ID: 'pri_lifetime',
} as const

describe('assertPaddleProductionConfig', () => {
  it('is a no-op in development with a sandbox Paddle environment', () => {
    withEnv({ NODE_ENV: 'development', PADDLE_ENVIRONMENT: 'sandbox' })
    expect(() => assertPaddleProductionConfig()).not.toThrow()
  })

  it('throws for each missing var outside development', () => {
    withEnv({ NODE_ENV: 'production', PADDLE_ENVIRONMENT: 'production' })
    expect(() => assertPaddleProductionConfig()).toThrow(/PADDLE_API_KEY/)
  })

  it('names every missing var, not just the first', () => {
    withEnv({
      NODE_ENV: 'production',
      PADDLE_ENVIRONMENT: 'production',
      PADDLE_API_KEY: 'pdl_live_x',
    })
    expect(() => assertPaddleProductionConfig()).toThrow(
      /PADDLE_CLIENT_TOKEN.*PADDLE_LIFETIME_PRICE_ID/s
    )
  })

  it('passes when the full Billing set is present in production', () => {
    withEnv({ NODE_ENV: 'production', PADDLE_ENVIRONMENT: 'production', ...FULL })
    expect(() => assertPaddleProductionConfig()).not.toThrow()
  })

  it('rejects equal annual and lifetime price IDs (renewal mis-grant guard)', () => {
    withEnv({
      NODE_ENV: 'production',
      PADDLE_ENVIRONMENT: 'production',
      ...FULL,
      PADDLE_ANNUAL_PRICE_ID: 'pri_same',
      PADDLE_LIFETIME_PRICE_ID: 'pri_same',
    })
    expect(() => assertPaddleProductionConfig()).toThrow(/must differ/)
  })

  it('still validates when NODE_ENV is unset but PADDLE_ENVIRONMENT=production (split-brain gap)', () => {
    withEnv({ PADDLE_ENVIRONMENT: 'production' }) // NODE_ENV unset → schema default "development"
    expect(() => assertPaddleProductionConfig()).toThrow(/not fully configured/)
  })

  // ── Story 5-20: the third plan ───────────────────────────────────────────
  //
  // The required-set and the must-differ guard were both PAIRWISE (annual +
  // lifetime). Monthly is deliberately NOT added to the required set — see the
  // rationale on the assertion itself — but it MUST join the distinctness
  // check, because the `:216` mis-grant rationale applies just as hard to a
  // monthly id colliding with the lifetime id.

  it('REQUIRES PADDLE_MONTHLY_PRICE_ID in production (story 5-20, settled at code review)', () => {
    // ⚠️ INVERTED, not deleted. The first implementation of 5-20 made monthly
    // optional, reasoning that a post-launch plan must not be able to take all
    // billing down. Code review found that the same story states "€5.99 per
    // month" on `content/legal/pricing.md` — the Paddle-required legal pricing
    // page. A price stated on a compliance surface must be chargeable, so the
    // id is required and a build without it must fail loudly rather than
    // advertise a plan it cannot sell.
    const { PADDLE_MONTHLY_PRICE_ID: _omitted, ...withoutMonthly } = FULL
    withEnv({ NODE_ENV: 'production', PADDLE_ENVIRONMENT: 'production', ...withoutMonthly })
    expect(() => assertPaddleProductionConfig()).toThrow(/PADDLE_MONTHLY_PRICE_ID/)
  })

  it.each([['PADDLE_MONTHLY_PRICE_ID'], ['PADDLE_ANNUAL_PRICE_ID'], ['PADDLE_LIFETIME_PRICE_ID']])(
    'rejects a WHITESPACE-ONLY %s as missing, not as present',
    (key) => {
      // ⚠️ THE REGRESSION THIS PINS was introduced by 5-20's own first pass and
      // caught by two independent review layers. The required check used a plain
      // `!env.X`, so '  ' read as PRESENT; the distinctness loop then dropped it as
      // trimmed-empty, so nothing was compared and the assertion reported healthy.
      // Production would boot with every plan unbuyable and every lifetime purchase
      // silently ignored by the webhook — money taken, no entitlement granted.
      withEnv({
        NODE_ENV: 'production',
        PADDLE_ENVIRONMENT: 'production',
        ...FULL,
        [key]: '   \n',
      })
      expect(() => assertPaddleProductionConfig()).toThrow(new RegExp(key))
    }
  )

  it('rejects a monthly price ID equal to the lifetime one (mis-grant guard)', () => {
    withEnv({
      NODE_ENV: 'production',
      PADDLE_ENVIRONMENT: 'production',
      ...FULL,
      PADDLE_MONTHLY_PRICE_ID: 'pri_lifetime',
    })
    expect(() => assertPaddleProductionConfig()).toThrow(
      /PADDLE_MONTHLY_PRICE_ID.*PADDLE_LIFETIME_PRICE_ID.*must differ/s
    )
  })

  it('rejects a monthly price ID equal to the annual one (wrong-cadence guard)', () => {
    withEnv({
      NODE_ENV: 'production',
      PADDLE_ENVIRONMENT: 'production',
      ...FULL,
      PADDLE_MONTHLY_PRICE_ID: 'pri_annual',
    })
    expect(() => assertPaddleProductionConfig()).toThrow(/must differ/)
  })

  it('ignores surrounding whitespace when comparing the three ids', () => {
    // The ids are `.trim()`-compared everywhere else (checkout-config trims
    // before handing them to the browser; the webhook trims before matching),
    // so a pasted trailing newline must not slip a collision past this guard.
    withEnv({
      NODE_ENV: 'production',
      PADDLE_ENVIRONMENT: 'production',
      ...FULL,
      PADDLE_MONTHLY_PRICE_ID: '  pri_lifetime\n',
    })
    expect(() => assertPaddleProductionConfig()).toThrow(/must differ/)
  })

  it('accepts three distinct price IDs', () => {
    withEnv({
      NODE_ENV: 'production',
      PADDLE_ENVIRONMENT: 'production',
      ...FULL,
      PADDLE_MONTHLY_PRICE_ID: 'pri_monthly',
    })
    expect(() => assertPaddleProductionConfig()).not.toThrow()
  })
})
