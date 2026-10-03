/**
 * Story 92.1 (code review): `apps/web/vitest.config.ts` pins every web test run
 * to UTC (`test.env.TZ`), so the PGlite harnesses' session TimeZone and JS local
 * time match CI and production. CI's runners are UTC anyway, so this only bites
 * on a dev box in another zone; it is the regression pin for that config line.
 */

import { describe, expect, it } from 'vitest'

describe('web Vitest runs in UTC (story 92.1)', () => {
  it('has a UTC process zone', () => {
    expect(process.env.TZ).toBe('UTC')
    expect(new Date('2026-07-01T12:00:00Z').getTimezoneOffset()).toBe(0)
  })
})
