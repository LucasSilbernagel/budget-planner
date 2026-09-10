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
})
