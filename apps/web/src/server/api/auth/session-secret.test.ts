/**
 * getSessionSecret hardening tests (Story 5.8 — AC group C / AC-12)
 *
 * Production (and any non-development NODE_ENV) must fail closed on
 * whitespace-only, trivially-padded, or low-entropy SESSION_SECRET values; a
 * strong secret is trimmed and returned. Lives in apps/web because the config
 * package has no test harness but is imported here.
 */

import { getSessionSecret, resetConfig } from '@budget-planner/config'
import { afterEach, describe, expect, it } from 'vitest'

const ORIGINAL_NODE_ENV = process.env.NODE_ENV
const ORIGINAL_SECRET = process.env.SESSION_SECRET

const STRONG_SECRET = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6' // 32 chars, 16 distinct

function setEnv(nodeEnv: string, secret: string | undefined): void {
  process.env.NODE_ENV = nodeEnv
  if (secret === undefined) {
    Reflect.deleteProperty(process.env, 'SESSION_SECRET')
  } else {
    process.env.SESSION_SECRET = secret
  }
  resetConfig()
}

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV
  if (ORIGINAL_SECRET === undefined) {
    Reflect.deleteProperty(process.env, 'SESSION_SECRET')
  } else {
    process.env.SESSION_SECRET = ORIGINAL_SECRET
  }
  resetConfig()
})

describe('getSessionSecret in production (fails closed)', () => {
  it('throws on a whitespace-only secret padded to the min length', () => {
    setEnv('production', ' '.repeat(40))
    expect(() => getSessionSecret()).toThrow(/SESSION_SECRET/)
  })

  it('throws on a short secret padded with trailing whitespace', () => {
    setEnv('production', `${'secret'}${' '.repeat(40)}`)
    expect(() => getSessionSecret()).toThrow(/SESSION_SECRET/)
  })

  it('throws on a long but low-entropy (single repeated char) secret', () => {
    setEnv('production', 'a'.repeat(40))
    expect(() => getSessionSecret()).toThrow(/distinct/)
  })

  it('throws when the secret is missing', () => {
    setEnv('production', undefined)
    expect(() => getSessionSecret()).toThrow(/SESSION_SECRET/)
  })

  it('returns the trimmed value for a strong secret with surrounding whitespace', () => {
    setEnv('production', `   ${STRONG_SECRET}   `)
    expect(getSessionSecret()).toBe(STRONG_SECRET)
  })
})

describe('getSessionSecret in development (lenient)', () => {
  it('falls back to the insecure dev key when unset (does not throw)', () => {
    setEnv('development', undefined)
    expect(getSessionSecret()).toContain('dev-only-insecure')
  })

  it('accepts a strong configured secret', () => {
    setEnv('development', STRONG_SECRET)
    expect(getSessionSecret()).toBe(STRONG_SECRET)
  })
})
