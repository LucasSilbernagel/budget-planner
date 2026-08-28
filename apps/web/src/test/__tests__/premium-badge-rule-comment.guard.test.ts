import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * AC-7 guard (story 33.1, UX-DR39; amended by story 33.2, FR56, and by story
 * 41.1, UX-DR45).
 *
 * The rule that governs the Overview's Premium Features section is written into
 * `HomePage.tsx` as a comment, and story 20-2's version of it — "never given a
 * lock badge … (story 20-2, CONTENT-G, still binding)" — sat directly above the
 * markup UX-DR39 changes. Prose that contradicts its own implementation is the
 * failure mode this batch has already shipped twice, and a comment cannot fail a
 * behavioural test, so it needs its own guard.
 *
 * Anchored on DISTINGUISHING phrasing (epic-23's lesson): the words pinned below
 * are unique to the new rule and could not survive a revert to the old one.
 * Whitespace is normalized first because the comment is hard-wrapped, so a
 * multi-word `toContain` against the raw source would break on the line breaks
 * rather than on the meaning.
 *
 * ⚠️ THE TRAP THIS GUARD ITSELF FELL INTO, recorded because it is the most
 * transferable thing here. Story 33.1 pinned the phrase "BADGE ON ALL THREE …".
 * When story 33.2 grew the set from three benefits to five, this guard stayed
 * GREEN — a count baked into pinned prose is invisible to the pin. The guard
 * written to stop the comment rotting would happily have certified a comment
 * asserting "ALL THREE" beside five boxes, and it fires only if the author is
 * honest enough to rewrite the sentence. The fix is not a better assertion: it is
 * that the pinned wording must be COUNT-FREE, so that being right does not depend
 * on remembering to update a number. Do not reintroduce a quantity here.
 *
 * ⚠️ AND THE TRAP RECURRED IN THE OTHER DIRECTION AT STORY 41.1. This guard's
 * three original assertions ALL stayed green across a change that reversed the
 * rule they exist to protect: "BADGE ON EVERY BENEFIT, ARROW ON THE OPENABLE ONES
 * ONLY" is still true after UX-DR45, "no /sync route" is still true, and the
 * 20-2 negative assertions were never about gating. A guard pinned to the surviving
 * half of a rule is silent about the half that changed. The two assertions added
 * for 41.1 pin the ACTIVATION half, which is the half that moved — and the next
 * amendment must ask the same question of all five rather than assuming green
 * means guarded.
 */

const HOME_PAGE = resolve(__dirname, '../../components/HomePage.tsx')

describe('AC-7 guard: the premium-section rule comment states the shipped rule', () => {
  const normalized = readFileSync(HOME_PAGE, 'utf8').replace(/\s+/g, ' ')

  it('states the badge-on-every-benefit / arrow-on-openable-only rule', () => {
    expect(normalized).toContain('BADGE ON EVERY BENEFIT, ARROW ON THE OPENABLE ONES ONLY')
    // Deliberately NOT asserting `toContain('UX-DR39')` on its own: five separate
    // comments in this file now cite it, so that assertion distinguishes nothing
    // and would survive a full revert of the rule above it.
    //
    // ⚠️ The phrase was "BADGE ON ALL THREE …" until story 33.2 expanded the
    // canonical set to five. Read §"the trap" in the docblock above: a count baked
    // into pinned PROSE goes stale silently, because this guard passes whether the
    // number is true or not. The wording is now count-free so the next amendment
    // cannot leave a lie here — which is the failure mode 33.2 was written to catch
    // and very nearly shipped.
  })

  it('no longer claims story 20-2 withholds the badge from sync', () => {
    // The exact words the old rule ended on. Their survival would mean the
    // comment and the markup disagree about whether sync carries a badge.
    //
    // Scoped to the sentence, not just the phrase: bare `not.toContain('still
    // binding')` would fail on any future comment legitimately calling an
    // unrelated rule binding, and bare `never given a lock badge` would ban an
    // honest historical note ("sync was never given a lock badge before 33.1").
    // What must never reappear is either phrase attached to the SYNC rule.
    expect(normalized).not.toMatch(/sync[^.]*never given a lock badge/i)
    expect(normalized).not.toMatch(/story 20-2[^.]*still binding/i)
    expect(normalized).not.toMatch(/CONTENT-G[^.]*still binding/i)
  })

  it('still records that sync has no route, which neither amendment changed', () => {
    // The one half of story 20-2 that BOTH amendments leave standing. A rewrite
    // that drops this reasoning invites the next author to add a link.
    expect(normalized).toContain('no /sync route')
  })

  it('states the every-benefit-is-activatable rule (story 41.1, UX-DR45)', () => {
    // ⚠️ THE POINT OF THIS ASSERTION. Story 33.1 ratified the OPPOSITE rule and
    // wrote it into this file verbatim; story 41.1 reverses it. A comment left
    // asserting "never wrapped in a PremiumFeatureGate" beside markup that wraps
    // it in one is how a later story reinstates the old behaviour believing it
    // was required — which is exactly the risk that created this guard in the
    // first place, one amendment ago.
    //
    // Count-free, per the docblock rule: the sentence says EVERY, not FIVE.
    expect(normalized).toContain('EVERY BENEFIT IS ALSO ACTIVATABLE')
  })

  it('no longer claims sync is never gate-wrapped', () => {
    // Story 33.1's exact reasoning, which is now false. Scoped to the sync rule
    // rather than banning the words outright, for the same reason as the 20-2
    // assertion above: an honest historical note ("33.1 held that sync must never
    // be gate-wrapped") must stay writable, and this file contains one.
    //
    // What must never reappear is the claim stated as CURRENT — the shape it had
    // when it was true: "it is never wrapped in a PremiumFeatureGate".
    expect(normalized).not.toMatch(/it is never wrapped in a PremiumFeatureGate/i)
  })
})
