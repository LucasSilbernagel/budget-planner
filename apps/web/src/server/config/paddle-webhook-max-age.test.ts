/**
 * PADDLE_WEBHOOK_MAX_AGE_SECONDS invalid-value guard (Story 5-3 review follow-up).
 *
 * A bare `z.coerce.number()` throws inside `getConfig()` — and 500s EVERY
 * route, not just billing — for ANY value that isn't a positive integer, not
 * only `''`: `' '`, `'abc'`, `'0'`, `'-1'`, and `'1.5'` all reach
 * `.positive()`/`.int()` and throw too (caught by the 2026-09-15 #3 review
 * after the first pass only handled the empty-string case). The schema
 * instead falls back to the 300s default on anything that isn't a positive
 * integer, and never throws.
 */

import { getPaddleConfig, resetConfig } from '@budget-planner/config'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  resetConfig()
})

describe('PADDLE_WEBHOOK_MAX_AGE_SECONDS', () => {
  it.each(['', ' ', 'abc', '0', '-1', '1.5', 'NaN'])(
    'falls back to the 300s default instead of crashing config load for %j',
    (value) => {
      vi.stubEnv('PADDLE_WEBHOOK_MAX_AGE_SECONDS', value)
      resetConfig()

      expect(() => getPaddleConfig()).not.toThrow()
      expect(getPaddleConfig().webhookMaxAgeSeconds).toBe(300)
    }
  )

  it('falls back to the 300s default when unset entirely', () => {
    resetConfig()

    expect(getPaddleConfig().webhookMaxAgeSeconds).toBe(300)
  })

  it('still honors an explicit configured value', () => {
    vi.stubEnv('PADDLE_WEBHOOK_MAX_AGE_SECONDS', '600')
    resetConfig()

    expect(getPaddleConfig().webhookMaxAgeSeconds).toBe(600)
  })
})
