/**
 * getSiteUrl production fail-closed tests (Story 5-16 review patch)
 *
 * Magic-link emails build absolute links from SITE_URL. In production a missing,
 * localhost, or non-HTTPS value would silently email unusable links, so it fails
 * closed (mirrors getSessionSecret). Development returns the value/localhost default.
 */

import { getSiteUrl, resetConfig } from '@budget-planner/config'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  resetConfig()
})

const withEnv = (env: Record<string, string>) => {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
  resetConfig()
}

describe('getSiteUrl', () => {
  it('returns a valid https origin in production', () => {
    withEnv({ NODE_ENV: 'production', SITE_URL: 'https://app.budgetplanner.eu' })
    expect(getSiteUrl()).toBe('https://app.budgetplanner.eu')
  })

  it('throws in production when SITE_URL is unset, localhost, or non-https', () => {
    withEnv({ NODE_ENV: 'production', SITE_URL: 'http://localhost:5173' })
    expect(() => getSiteUrl()).toThrow(/SITE_URL/)

    withEnv({ NODE_ENV: 'production', SITE_URL: 'http://app.budgetplanner.eu' })
    expect(() => getSiteUrl()).toThrow(/SITE_URL/)
  })

  it('returns the configured value in development without enforcement', () => {
    withEnv({ NODE_ENV: 'development', SITE_URL: 'http://localhost:5173' })
    expect(getSiteUrl()).toBe('http://localhost:5173')
  })
})
