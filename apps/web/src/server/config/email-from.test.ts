/** vitest.config.ts overrides EMAIL_FROM suite-wide, so only this pins the real default. */

import { getEmailConfig, resetConfig } from '@budget-planner/config'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  resetConfig()
})

describe('EMAIL_FROM default', () => {
  it('defaults to the Longhand-owned, Brevo-verified sender when unset', () => {
    vi.stubEnv('EMAIL_FROM', undefined)
    resetConfig()

    expect(getEmailConfig().from).toBe('hello@longhandbudget.com')
  })

  it('is never the retired budgetplanner.eu domain', () => {
    vi.stubEnv('EMAIL_FROM', undefined)
    resetConfig()

    expect(getEmailConfig().from).not.toMatch(/budgetplanner\.eu/i)
  })

  it.each(['', ' ', '\t'])(
    'falls back to the real default instead of silently sending as %j (a manifest that declares the var with no value)',
    (value) => {
      // z.string().default() applies only to undefined; a blank value must also fall back.
      vi.stubEnv('EMAIL_FROM', value)
      resetConfig()

      expect(getEmailConfig().from).toBe('hello@longhandbudget.com')
    }
  )

  it('still honors an explicit configured value', () => {
    vi.stubEnv('EMAIL_FROM', 'hello@example.com')
    resetConfig()

    expect(getEmailConfig().from).toBe('hello@example.com')
  })
})
