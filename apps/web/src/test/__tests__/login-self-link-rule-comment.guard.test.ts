import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * AC-7 guard (story 41.3, UX-DR51).
 *
 * Story 41.3 stops the account strip offering a "Sign in" link on `/login`. Two
 * things make that a comment problem and not only a code one:
 *
 *  1. It REVERSES the app's own rule for a link to the page you are already on.
 *     UX-DR28 / story 21.1 settled that rule as "keep the link, mark it
 *     `aria-current='page'`", and `GlobalNav` and `Footer` both follow it. A
 *     later author who finds this one surface behaving differently, with no note
 *     saying why, has every reason to "restore consistency" and put the link
 *     back.
 *  2. It made `pathname` a render input in a component whose comment stated, in
 *     so many words, that `pathname` was "not a value read in the body".
 *
 * Neither is a behaviour a test can otherwise fail on, so the prose gets a pin.
 *
 * ⚠️ WHAT THIS GUARD PINS, AND WHAT IT CANNOT. Story 41.1 shipped a comment
 * guard whose three assertions ALL stayed green across the very reversal they
 * existed to catch, because each pinned a half of the rule that did not move.
 * The prose assertions below are chosen to avoid that: the divergence note only
 * makes sense beside a branch that declines to render, and the falsified
 * sentence is banned outright rather than merely superseded.
 *
 * ⚠️ BUT AN EARLIER VERSION OF THIS DOCBLOCK CLAIMED MORE THAN THE FILE HELD,
 * AND CODE REVIEW CAUGHT IT. It said "reverting story 41.3 would have to delete
 * or contradict each one". That is false for the likeliest revert of all: delete
 * `!isOnLoginPage` from the branch condition and touch no comments. The
 * behavioural tests fail loudly, so the bug cannot ship — but every assertion
 * *here* would have stayed green while the prose it pins became actively false,
 * describing a branch that "declines to render" beside one that renders.
 *
 * A prose guard verifies that a comment is PRESENT. It cannot, by itself,
 * verify that the comment still CORRESPONDS to the code. So the last test below
 * pins the code clause the comments describe — the one line whose deletion would
 * orphan every sentence in this file — which is the cheapest way to close the
 * gap between "the prose cannot be silently rewritten" and "the prose cannot be
 * silently orphaned".
 *
 * ⚠️ COUNT-FREE, per the same file's other recorded trap: no assertion here
 * carries a quantity, so being right does not depend on remembering to update a
 * number when a route or a branch is added.
 *
 * Whitespace is normalized first because both comments are hard-wrapped, and a
 * multi-word `toContain` against raw source would break on the line breaks
 * rather than on the meaning.
 */

const AUTH_INDICATOR = resolve(__dirname, '../../components/auth/auth-indicator.tsx')
const AUTH_INDICATOR_SPEC = resolve(__dirname, '../../../e2e/auth-indicator.spec.ts')

/**
 * Read and whitespace-normalize a pinned file.
 *
 * ⚠️ These paths cross directories (one reaches into `e2e/`), so a rename two
 * folders away breaks the UNIT suite. Without this wrapper that surfaces as a
 * bare `ENOENT` naming neither the story nor the reason, which is a failure
 * mode a long way from its cause.
 */
const normalize = (path: string) => {
  try {
    return readFileSync(path, 'utf8').replace(/\s+/g, ' ')
  } catch {
    throw new Error(
      `AC-7 guard (story 41.3) cannot read a file it pins: ${path}
If it was renamed or moved, update the path at the top of this guard. If the rule it pins was deliberately reversed, amend the assertions below rather than deleting them — see this file's docblock.`
    )
  }
}

describe('AC-7 guard: the sign-in-page rule comment states the shipped rule', () => {
  const source = normalize(AUTH_INDICATOR)

  it('records that this surface diverges from the mark-the-current-page rule', () => {
    // The whole point of the note. A revert restores UX-DR28 conformance, at
    // which point claiming a divergence would be false — so this clause cannot
    // survive one honestly.
    expect(source).toContain('DIVERGES from UX-DR28')
  })

  it('records WHY it diverges, not only that it does', () => {
    // The reason is what makes the note actionable. "Diverges from UX-DR28" on
    // its own reads as an oversight to be corrected; the distinction between
    // wayfinding and account status is what tells the next author it was a
    // decision.
    expect(source).toContain('an account-status affordance, not navigation')
  })

  it('records that the loading and authenticated branches are deliberately untouched', () => {
    // AC-4's scoping decision. Without it, the obvious "consistency" fix is to
    // apply the route check to all three branches, which would hide an
    // authenticated user's identity on the one page that most needs explaining.
    expect(source).toContain('branches are deliberately NOT route-aware')
  })

  it('no longer claims the pathname is not read in the render body', () => {
    // The exact claim story 41.3 falsified.
    //
    // ⚠️ FOUND BY CODE REVIEW. The first version of this was
    // `/pathname[^.]*not a value read in the body/i`, and `[^.]*` cannot cross
    // a full stop — so reintroducing the claim as two sentences ("`pathname` is
    // a re-run trigger. It is not a value read in the body.") sailed past it,
    // and so did any phrasing separated by an incidental period such as
    // `state.location.pathname`. The banned phrase is now banned outright,
    // which is safe here because it is specific enough that no honest note
    // about this component could need it: the whole point of the amendment is
    // that the value IS read in the body.
    expect(source).not.toMatch(/not a value read in the body/i)
  })

  it('keeps the REASON the dependency array is suppressed, not just the label', () => {
    // The half of the original comment that is still true, pinned separately so
    // a rewrite cannot drop the justification: removing `pathname` from the
    // dependency array would silently reinstate the stale-identity bug story
    // 13-2 fixed.
    //
    // ⚠️ FOUND BY CODE REVIEW. This used to assert only `toContain('re-run
    // trigger')` — two words. Collapsing the whole block to
    // `// pathname is a re-run trigger` would have deleted the reason entirely
    // and left this green, which is precisely the "pins a label, not a rule"
    // failure this file's docblock lectures about. Pin the consequence, since
    // that is the part a careless rewrite drops.
    expect(source).toContain('re-run trigger')
    // ⚠️ Conjugation-tolerant on purpose. The first version of this pinned the
    // literal "refetched on every navigation" and went red against the ORIGINAL
    // comment, which says "refetches the session on every navigation" — i.e. it
    // was failing on wording, not on meaning, and would have rejected an honest
    // rewrite. Pin the two ideas (a refetch per navigation; the stale identity
    // it prevents), not the tense they are written in.
    expect(source).toMatch(/refetch\w*[^.]*every navigation/i)
    expect(source).toMatch(/stale identity/i)
  })
  it('pins the code clause the comments describe, so a code-only revert cannot orphan them', () => {
    // ⚠️ THE ASSERTION THIS FILE WAS MISSING, added by code review. Everything
    // above pins PROSE. Deleting `!isOnLoginPage` from the branch condition
    // reverts the story's behaviour while leaving every sentence in place — the
    // comments would then describe a rule the code no longer follows, which is
    // the exact failure mode epic 41 exists to remove and which this guard was
    // written to prevent.
    //
    // Hand-written, not read back from the component's own constants: a guard
    // built from the thing it guards cannot fail.
    expect(source).toContain("authState.status === 'unauthenticated' && !isOnLoginPage")
    // And the normalisation itself, which is what makes `/Login` match. A bare
    // `===` here is the defect code review found in the shipped implementation.
    expect(source).toContain('pathname.toLowerCase() === LOGIN_PATH')
  })
})

describe('AC-7 guard: the /login e2e comment states the shipped rule', () => {
  const spec = normalize(AUTH_INDICATOR_SPEC)

  it('no longer claims the strip renders a Sign in link on the login route', () => {
    // Story 21-2 wrote this to explain why its heading assertion is role-scoped.
    // After 41.3 it is simply untrue, and a reader who believes it will conclude
    // the scope is still needed for a reason that no longer exists.
    expect(spec).not.toMatch(/link that also renders on this route/i)
  })

  it('states the new reason the heading assertion stays role-scoped', () => {
    // The scope is still correct — but for the opposite reason: with the strip's
    // link gone, an unscoped match would now succeed on the heading and quietly
    // stop distinguishing the card from the strip.
    expect(spec).toMatch(/removed the AuthIndicator[^.]*link FROM THIS ROUTE/i)
  })
})
