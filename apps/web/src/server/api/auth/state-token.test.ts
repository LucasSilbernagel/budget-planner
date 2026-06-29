/**
 * CSRF state-token tests (Story 5.8 — AC group C / AC-10)
 *
 * The state token must be CSPRNG-generated (crypto.randomBytes), not
 * Math.random(), and validation must enforce the exact format rather than the
 * previous `state.length > 0`.
 */

import { describe, expect, it } from 'vitest'
import { generateStateToken, validateStateToken } from './paddle'

describe('generateStateToken', () => {
  it('produces a 64-char lowercase hex string', () => {
    const token = generateStateToken()
    expect(token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('produces a unique value on each call (high entropy)', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateStateToken()))
    expect(tokens.size).toBe(100)
  })
})

describe('validateStateToken', () => {
  it('accepts a freshly generated token', () => {
    expect(validateStateToken(generateStateToken())).toBe(true)
  })

  it('rejects empty, short, non-hex, and over-long values', () => {
    expect(validateStateToken('')).toBe(false)
    expect(validateStateToken('x')).toBe(false)
    expect(validateStateToken('g'.repeat(64))).toBe(false) // not hex
    expect(validateStateToken('a'.repeat(63))).toBe(false) // too short
    expect(validateStateToken('a'.repeat(65))).toBe(false) // too long
    // The old implementation (`state.length > 0`) would have accepted this:
    expect(validateStateToken('anything-nonempty')).toBe(false)
  })
})
