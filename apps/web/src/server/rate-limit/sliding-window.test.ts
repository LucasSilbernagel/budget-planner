/**
 * Generic sliding-window rate limiter tests (Story 5-16, Task 2)
 *
 * Extracted from the Paddle callback limiter (Story 5-8) so the magic-link
 * request route can rate-limit per-IP AND per-email with independent budgets.
 * These tests pin the same semantics the callback limiter was hardened to:
 * real per-key sliding window, independent keys, window slide, and a hard
 * memory bound that degrades open rather than growing unbounded.
 */

import { describe, expect, it } from 'vitest'
import { createSlidingWindowLimiter } from './sliding-window'

const T0 = 1_000_000

describe('createSlidingWindowLimiter', () => {
  it('allows up to maxAttempts then blocks the next within the window', () => {
    const limiter = createSlidingWindowLimiter({ windowMs: 60_000, maxAttempts: 5, maxKeys: 100 })
    for (let i = 0; i < 5; i++) {
      expect(limiter.check('k', T0 + i)).toBe(false)
    }
    expect(limiter.check('k', T0 + 5)).toBe(true)
  })

  it('tracks keys independently (alternating two keys does not defeat it)', () => {
    const limiter = createSlidingWindowLimiter({ windowMs: 60_000, maxAttempts: 5, maxKeys: 100 })
    for (let i = 0; i < 5; i++) {
      expect(limiter.check('a', T0 + i)).toBe(false)
      expect(limiter.check('b', T0 + i)).toBe(false)
    }
    expect(limiter.check('a', T0 + 5)).toBe(true)
    expect(limiter.check('b', T0 + 5)).toBe(true)
  })

  it('lets attempts through again once the window has slid past old ones', () => {
    const limiter = createSlidingWindowLimiter({ windowMs: 60_000, maxAttempts: 5, maxKeys: 100 })
    for (let i = 0; i < 5; i++) {
      expect(limiter.check('k', T0 + i)).toBe(false)
    }
    expect(limiter.check('k', T0 + 5)).toBe(true)
    expect(limiter.check('k', T0 + 61_000)).toBe(false)
  })

  it('degrades OPEN for a brand-new key once the key cap is reached (no unbounded growth)', () => {
    const limiter = createSlidingWindowLimiter({ windowMs: 60_000, maxAttempts: 1, maxKeys: 2 })
    // Fill two distinct keys to the cap (each used once, still within window).
    expect(limiter.check('k1', T0)).toBe(false)
    expect(limiter.check('k2', T0)).toBe(false)
    // A third, never-seen key at capacity is allowed through rather than tracked.
    expect(limiter.check('k3', T0 + 1)).toBe(false)
    // An already-tracked key stays limited.
    expect(limiter.check('k1', T0 + 1)).toBe(true)
  })

  it('reset() clears all tracked state', () => {
    const limiter = createSlidingWindowLimiter({ windowMs: 60_000, maxAttempts: 1, maxKeys: 100 })
    expect(limiter.check('k', T0)).toBe(false)
    expect(limiter.check('k', T0 + 1)).toBe(true)
    limiter.reset()
    expect(limiter.check('k', T0 + 2)).toBe(false)
  })
})
