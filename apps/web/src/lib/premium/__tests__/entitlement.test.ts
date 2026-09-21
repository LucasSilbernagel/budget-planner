import { describe, expect, it } from 'vitest'
import type { SessionSeed } from '../../../context/session-seed'
import { seedToStatus } from '../../../hooks/usePremiumAccess'
import { isEntitledSeed } from '../entitlement'

/**
 * The one tier predicate (story 58.2, AC-8).
 *
 * Before this module the rule was written out twice — inline in `GlobalNav.tsx`
 * (story 58.1) and as `seedToStatus`'s `hasAccess` field in `usePremiumAccess.ts`
 * — and story 58.2 needed it on two more surfaces. Four hand-written copies of a
 * fail-closed security-shaped predicate is how they drift apart, so it lives here
 * once and is exercised here once.
 *
 * ⚠️ Every case below is a FAIL-CLOSED case except the two entitled ones. That
 * asymmetry is the point: this predicate answers "has this session PROVEN it is
 * entitled", never "is it plausibly entitled". Callers that want to fail OPEN
 * (story 58.2's Overview and Settings gates do) invert the ANSWER at the call
 * site; they must not weaken the predicate.
 */

function seed(overrides: Partial<SessionSeed> = {}): SessionSeed {
  return {
    isAuthenticated: true,
    userId: 'u1',
    email: 'u1@example.test',
    subscriptionStatus: 'active',
    ...overrides,
  }
}

describe('isEntitledSeed', () => {
  it('is true for an authenticated active subscription', () => {
    expect(isEntitledSeed(seed({ subscriptionStatus: 'active' }))).toBe(true)
  })

  it('is true for an authenticated lifetime purchase (story 25-2)', () => {
    expect(isEntitledSeed(seed({ subscriptionStatus: 'lifetime' }))).toBe(true)
  })

  it('is false for a null seed — unverified is never entitled', () => {
    // `getSessionSeed` returns null when the resolver could not verify the
    // session (`server/api/auth/session-seed.ts`), and the context is also null
    // outside a provider. Neither is evidence of a paid tier.
    expect(isEntitledSeed(null)).toBe(false)
  })

  it.each(['free', 'past_due', 'canceled', null] as const)(
    'is false for an authenticated session with status %s',
    (subscriptionStatus) => {
      expect(isEntitledSeed(seed({ subscriptionStatus }))).toBe(false)
    }
  )

  it.each(['active', 'lifetime'] as const)(
    'is false when not authenticated, even with status %s',
    (subscriptionStatus) => {
      // Gate on authentication too, so a malformed seed can never yield premium
      // for a signed-out session — fail-closed by construction, not by luck of
      // what the resolver emits (the 2026-07-14 review finding on `seedToStatus`).
      expect(isEntitledSeed(seed({ isAuthenticated: false, subscriptionStatus }))).toBe(false)
    }
  )

  it('matches seedToStatus.hasAccess for every status/auth combination, and for a null seed', () => {
    // The parity that justifies NOT refactoring `seedToStatus` to call this
    // helper (story 58.2 §5): the two are kept in step by an assertion rather
    // than by an import, because `seedToStatus` builds a five-field object on
    // the hot path of every gate in the app and rewriting it is risk this story
    // has no reason to take. If this ever goes red, the two rules have drifted
    // and that is the bug — do not "fix" it by loosening this test.
    //
    // ⚠️⚠️ THIS TEST CALLS THE REAL `seedToStatus`, AND THAT IS THE WHOLE POINT.
    // The first version of it recomputed the predicate inline —
    // `s.isAuthenticated && (status === 'active' || status === 'lifetime')` —
    // which is a verbatim copy of `isEntitledSeed`'s body asserted against
    // `isEntitledSeed`. It could never go red, in a story whose thesis is that
    // hand-written copies of this rule drift apart, while the docblocks next to
    // it claimed it held the two in step. Caught in code review (2026-09-21).
    // `seedToStatus` is exported for this test alone. Never reintroduce a local
    // re-implementation of the expected value here.
    const statuses = ['free', 'active', 'past_due', 'canceled', 'lifetime', null] as const
    for (const subscriptionStatus of statuses) {
      for (const isAuthenticated of [true, false]) {
        const s = seed({ isAuthenticated, subscriptionStatus })
        expect(isEntitledSeed(s), `${subscriptionStatus}/${isAuthenticated}`).toBe(
          seedToStatus(s).hasAccess
        )
      }
    }

    // The null seed is the case the loop cannot express, and the one where the
    // two rules are most likely to drift: `seedToStatus(null)` returns the
    // fail-closed LOADING default, whose `hasAccess` is false — matching
    // `isEntitledSeed(null)`. A future "unknown tier is optimistic" change to
    // either side breaks here first.
    expect(isEntitledSeed(null)).toBe(seedToStatus(null).hasAccess)
  })
})
