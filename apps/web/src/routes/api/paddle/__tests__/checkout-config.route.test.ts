/**
 * GET /api/paddle/checkout-config (Story 5-3, Task 2a).
 *
 * Drives the real `@budget-planner/config` module through env vars (same
 * technique as `server/__tests__/paddle-config-assertion.test.ts`) rather than
 * mocking it, so the fail-closed production guard is exercised for real.
 */

import { resetConfig } from '@budget-planner/config'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GET } from '../checkout-config'

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

    const response = await GET()
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

  it('returns isConfigured:false with null fields when nothing is set (dev default)', async () => {
    const response = await GET()
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

  it('fails loudly (500) rather than silently when production is misconfigured', async () => {
    withEnv({ NODE_ENV: 'production', PADDLE_ENVIRONMENT: 'production' })

    const response = await GET()
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.success).toBe(false)
    expect(body.error).toMatch(/PADDLE_API_KEY/)
  })
})
