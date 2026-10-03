/**
 * Story 92.1 (code review): `packages/db/vitest.config.ts` sets
 * `process.env.TZ = 'UTC'` before the worker threads start (Vitest 1.6 ignores
 * `test.env.TZ` for the zone), so the PGlite harnesses' session TimeZone and JS
 * local time match CI and production. CI's runners are UTC anyway, so this only
 * bites on a dev box in another zone; it is the regression pin for that line.
 */

import { describe, expect, it } from 'vitest'

describe('db Vitest runs in UTC (story 92.1)', () => {
  it('has a UTC process zone', () => {
    expect(process.env.TZ).toBe('UTC')
    expect(new Date('2026-07-01T12:00:00Z').getTimezoneOffset()).toBe(0)
  })
})
