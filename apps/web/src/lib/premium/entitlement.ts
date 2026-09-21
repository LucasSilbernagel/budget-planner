import type { SessionSeed } from '../../context/session-seed'

/**
 * The one answer to "is this session entitled to Premium?" (story 58.2, AC-8).
 *
 * ## Why this module exists
 *
 * The rule was written out by hand twice before this: inline in `GlobalNav.tsx`
 * (story 58.1, the tier-aware nav) and as `seedToStatus`'s `hasAccess` field in
 * `hooks/usePremiumAccess.ts`. Story 58.2 needed it on two more surfaces — the
 * Overview's Premium Features section and the two premium sections on
 * `/settings` — and four hand-written copies of a fail-closed, security-shaped
 * predicate is exactly how they drift into disagreeing.
 *
 * ⚠️ `seedToStatus` (`usePremiumAccess.ts`) deliberately does NOT call this. It
 * builds a five-field status object and sits on the hot path of every premium
 * gate in the app; rewriting it is risk story 58.2 had no reason to take. The two
 * are held in step by a parity test that **imports and calls the real
 * `seedToStatus`** (`__tests__/entitlement.test.ts`). If that test goes red, the
 * rules have drifted — that is the bug, and it is not fixed by loosening the test.
 *
 * ⚠️⚠️ That test was VACUOUS as first written: it recomputed the predicate inline
 * and asserted it against `isEntitledSeed`, so it could never fail, while this
 * very docblock claimed it held the two in step. Caught in code review
 * (2026-09-21). If you ever find yourself writing the expected value by hand
 * here, you have recreated the bug.
 *
 * ## Fail-closed, in all three directions
 *
 * This answers "has this session PROVEN it is entitled", never "is it plausibly
 * entitled":
 *   - a `null` seed means the resolver could not verify the session (see
 *     `getSessionSeed`, which returns null on error rather than asserting a wrong
 *     signed-out state) — unverified is never entitled;
 *   - an unauthenticated seed never qualifies, whatever its status reads, so a
 *     malformed seed cannot yield premium by luck of what the resolver emits;
 *   - only `active` and `lifetime` count. `free`, `past_due` and `canceled` do not.
 *
 * ⚠️⚠️ **Callers may legitimately want the opposite fail direction, and they invert
 * the ANSWER — never this predicate.** `GlobalNav` fails CLOSED: an unverified
 * session gets the free nav (withhold). The Overview and Settings gates fail
 * OPEN: an unverified session is SHOWN the premium sections, because hiding them
 * from a paid user whose seed failed to resolve would leave them with no nav
 * entry and no card — the stranding FR88's sequencing exists to prevent. Both
 * are fail-safe; the harm is asymmetric, so they point opposite ways. Do not
 * "harmonise" them.
 *
 * ⚠️ **Failing open IMPROVES the odds of a route; it does not guarantee one.**
 * Stated precisely because an earlier version of this comment overclaimed. The
 * boxes inside those sections are `PremiumFeatureGate`s driven by
 * `usePremiumAccess`, whose null-seed path fires a client round-trip: if that
 * ALSO fails — the likely case when the SSR resolver already failed — every box
 * renders locked and the user still has no route. Fail-open rescues the
 * SSR-only outage, which is the common one. It is not a guarantee, and the
 * remaining gap is `usePremiumAccess`'s, not this module's.
 *
 * ## Read it as an initializer
 *
 * Every caller reads the seed via `useSessionSeed()` as a `useState` INITIALIZER,
 * per `context/session-seed.tsx`'s documented contract — never reactively. The
 * seed is authoritative for the first paint; reading it once means a later
 * provider value cannot clobber a consumer's resolved state, and the surface does
 * not flip after hydration.
 */
export function isEntitledSeed(seed: SessionSeed | null): boolean {
  return (
    seed?.isAuthenticated === true &&
    (seed.subscriptionStatus === 'active' || seed.subscriptionStatus === 'lifetime')
  )
}
