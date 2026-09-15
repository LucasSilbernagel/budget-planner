/**
 * EMAIL_FROM production default guard (Story 5-3 review follow-up).
 *
 * `vitest.config.ts` overrides `EMAIL_FROM` for the whole web suite (so the
 * mailer takes its real send path against MSW), which means the real
 * `.default(...)` in `packages/config/src/schema.ts` was never exercised by
 * any test. `retired-brand.test.ts` doesn't catch a regression either — it
 * sweeps for retired BRAND names, and the lowercase sender domain matches
 * neither `RETIRED_BRANDS` entry. This pins the actual default so a future
 * edit that silently reverts it to an unverified domain fails a test instead
 * of just bouncing every magic-link email in production.
 *
 * Uses `vi.stubEnv`/`vi.unstubAllEnvs` (not `delete process.env[...]`) so a
 * failure mid-test can't leak a cleared var into a later test file even
 * without `--no-file-parallelism` in force.
 */

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
      // Regression (2026-09-15 #3 review): `z.string().default()` applies
      // ONLY to `undefined` — an empty/whitespace value previously validated
      // as-is, so `getEmailConfig().from` returned '' and every magic-link
      // send was silently rejected by Brevo with nothing failing at startup.
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
