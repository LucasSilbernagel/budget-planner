import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * AC-7 guard (story 33.1, UX-DR39).
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
 */

const HOME_PAGE = resolve(__dirname, '../../components/HomePage.tsx')

describe('AC-7 guard: the premium-section rule comment states the shipped rule', () => {
  const normalized = readFileSync(HOME_PAGE, 'utf8').replace(/\s+/g, ' ')

  it('states the badge-on-all-three / arrow-on-openable-only rule', () => {
    expect(normalized).toContain('BADGE ON ALL THREE, ARROW ON THE OPENABLE ONES ONLY')
    // Deliberately NOT asserting `toContain('UX-DR39')` on its own: five separate
    // comments in this file now cite it, so that assertion distinguishes nothing
    // and would survive a full revert of the rule above it.
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

  it('still records that sync has no route, which UX-DR39 did NOT change', () => {
    // Half of story 20-2 survives: sync gains a badge but stays unopenable. A
    // rewrite that drops this reasoning invites the next author to add a link.
    expect(normalized).toContain('no /sync route')
  })
})
