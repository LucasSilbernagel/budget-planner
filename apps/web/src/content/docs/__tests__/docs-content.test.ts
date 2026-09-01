import {
  calculateTotalMonthlyNormalized,
  denormalizeFromMonthly,
  normalizeToMonthly,
} from '@budget-planner/core/finance'
import { describe, expect, it } from 'vitest'
import { DOC_PAGES, getDocPage } from '../index'

/**
 * Cents → the grouped decimal string the docs print (e.g. 503_333 → '5,033.33').
 *
 * Deliberately a plain `Intl` call rather than the app's `formatAmount`: this is
 * only turning a computed number into the substring to search the Markdown for.
 * The VALUE it formats is what must come from core — see the worked-example
 * guard below.
 */
function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * Documentation content registry tests (story 4-10, AC-2).
 *
 * Confirms the registry exposes well-formed pages whose bodies are loaded from
 * the static `.md` files, and that slug lookup behaves correctly.
 */
describe('DOC_PAGES', () => {
  it('exposes at least the getting-started, features, and faq pages', () => {
    const slugs = DOC_PAGES.map((page) => page.slug)
    expect(slugs).toEqual(expect.arrayContaining(['getting-started', 'features', 'faq']))
  })

  it('gives every page a slug, title, description, and non-empty markdown body', () => {
    for (const page of DOC_PAGES) {
      expect(page.slug).toMatch(/^[a-z0-9-]+$/)
      expect(page.title.length).toBeGreaterThan(0)
      expect(page.description.length).toBeGreaterThan(0)
      expect(page.content.trim().length).toBeGreaterThan(0)
    }
  })

  it('uses unique slugs', () => {
    const slugs = DOC_PAGES.map((page) => page.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })
})

describe('getDocPage', () => {
  it('returns the matching page for a known slug', () => {
    expect(getDocPage('faq')?.title).toBe('FAQ')
  })

  it('returns undefined for an unknown slug', () => {
    expect(getDocPage('does-not-exist')).toBeUndefined()
  })
})

/**
 * Content-accuracy guards (story 10-4).
 *
 * These lock in the corrections made when the docs were reconciled against the
 * shipped app so a future edit can't silently reintroduce a stale claim. They
 * assert facts, not prose, so wording can still evolve freely.
 */
describe('documentation content accuracy (story 10-4)', () => {
  const contentFor = (slug: string): string => {
    const page = getDocPage(slug)
    if (!page) throw new Error(`missing expected doc page: ${slug}`)
    return page.content
  }

  it('no page references the "Financial Health" score removed in story 11-5', () => {
    for (const page of DOC_PAGES) {
      expect(page.content.toLowerCase()).not.toContain('financial health')
    }
  })

  it('the FAQ locates the currency control on /settings, not an old page header', () => {
    const faq = contentFor('faq')
    expect(faq).toContain('/settings')
    expect(faq).not.toContain('in the page header')
  })

  it('the FAQ documents the in-app "Clear local data" control (story 17-2)', () => {
    // The reset/clear answer must lead with the in-app control, not only point at
    // the browser's own privacy settings.
    expect(contentFor('faq')).toContain('Clear local data')
  })

  it('the FAQ discloses the cookieless (counter.dev) analytics posture', () => {
    expect(contentFor('faq').toLowerCase()).toContain('counter.dev')
  })

  it('the FAQ routes support requests to the in-app contact form and links the Privacy Policy', () => {
    const faq = contentFor('faq')
    expect(faq).toContain('/contact')
    expect(faq).toContain('/privacy')
  })

  it('the FAQ no longer advertises the phantom data import/export feature (story 17-3, AC-1)', () => {
    // Story 17-3 removed a "planned for a future release" entry promising data
    // import/export, which did not exist. Its review then added a blanket
    // `not.toContain('export')` on the rationale that "the app never supports
    // export".
    //
    // ⚠️ That rationale DIED in story 30-3, which ships a Premium print/PDF
    // financial SUMMARY REPORT. The phantom 17-3 killed is still absent and
    // still guarded below; what changed is that the bare word "export" is no
    // longer evidence of it. Note the blanket guard would NOT have caught this
    // drift on its own: it reads the FAQ only, and 30-3 documents the report in
    // features.md, so it would have stayed green while its stated reason became
    // false.
    //
    // What remains genuinely false, and is guarded: raw data export, a backup
    // or downloadable copy of your entries, a machine-readable file, and
    // transaction import. The summary report is none of those — it cannot be
    // read back in, and there is deliberately no importer.
    // ⚠️ These guard the CLAIM, not one phrasing of it. A first attempt keyed on
    // literal phrases ("export your data", "data export") and a review proved it
    // porous: "exporting your data", "export to spreadsheet", "download your
    // entries as a file" and "save a copy of your data" all sailed through — and
    // so did "download your data", which this story's own notes list as a claim
    // that would be FALSE. A negative keyed on one spelling is not a guard on the
    // claim; match the VERB STEM against the OBJECT instead.
    const faq = contentFor('faq').toLowerCase()
    expect(faq).not.toContain('import or export')

    const OBJECT = '(?:data|entries|budget|figures|records|copy|file|spreadsheet|csv|json)'
    const VERB = '(?:export|download|back ?up|backup)'
    // Verb before object — "export your data", "downloading your entries".
    expect(faq).not.toMatch(new RegExp(`\\b${VERB}\\w*\\b[^.!?\\n]{0,40}?\\b${OBJECT}\\b`))
    // Object before verb — "a full data export", "an entries backup". Both
    // orders are needed: the first pattern alone missed "a full data export".
    expect(faq).not.toMatch(new RegExp(`\\b${OBJECT}\\b[^.!?\\n]{0,20}?\\b${VERB}\\w*\\b`))
    expect(faq).not.toMatch(/\bsave a copy of\b/)
    // ⚠️ These three are banned in the FAQ as proxies for an export TARGET ("a
    // machine-readable file"). The ban is broader than that intent: story 32.3
    // wanted the FAQ to say a total can differ from "the same sum in a
    // spreadsheet" — honest copy about the USER'S OWN spreadsheet, with no
    // export claim anywhere near it — and this went red on it. The FAQ sentence
    // was reworded rather than the guard narrowed, because the word is a decent
    // proxy and the FAQ is the one page it guards; the spreadsheet-reconciliation
    // copy lives on `how-totals-are-calculated.md`, which this does not read.
    // Narrow it only with a replacement that still catches "export to
    // spreadsheet".
    expect(faq).not.toMatch(/\b(?:csv|spreadsheet|json)\b/)

    // ⚠️ "import" is deliberately NOT guarded, and must stay that way. The FAQ
    // legitimately states the app "does not import transactions" (`faq.md:55`) —
    // a TRUE negative claim. An import guard added during this review blocked
    // that correct sentence, and survived only because the phrase happens to wrap
    // across a newline; a re-wrap would have turned it red against good copy.
    // `not.toContain('import or export')` above covers the phantom phrasing.
  })

  it('the FAQ frames Longhand as a planning tool and points to a spend tracker (story 17-3, AC-2)', () => {
    const faq = contentFor('faq')
    expect(faq.toLowerCase()).toContain('planning tool')
    expect(faq).toContain('Lunch Money')
  })

  it('refers to the product as "Longhand", never the retired brands (stories 27-3, brand-1)', () => {
    // The docs rebrand must be complete and stay complete: no doc body or its
    // index metadata may reference a retired wordmark, and the page that names
    // the product (Features) carries the new brand. "Lunch Money" (a third-party
    // app) is unaffected — it does not contain the brand token.
    //
    // Unlike the legal set, docs carry NO historical rename note, so here the
    // retired brand must be gone outright — no sanctioned exception.
    for (const page of DOC_PAGES) {
      expect(page.content).not.toContain('Budget Planner')
      expect(page.description).not.toContain('Budget Planner')
      expect(page.content).not.toContain('SoluBudget')
      expect(page.description).not.toContain('SoluBudget')
    }
    // Assert the FORMAL form explicitly. `toContain('Longhand')` would be
    // strictly weaker than the `toContain('SoluBudget')` it replaced, because
    // the short form is a strict PREFIX of the formal one — so it could not
    // distinguish the two at exactly the moment brand-1 introduced a form
    // distinction. Features opens on the formal form (first mention) and uses
    // the short form thereafter, so both are pinned deliberately.
    expect(getDocPage('features')?.content).toContain('Longhand Budget is split into')
    expect(getDocPage('features')?.content).toMatch(/\bLonghand is built for\b/)
    expect(getDocPage('features')?.description).toContain('Longhand')
  })

  it('the Features page pledges no AI, scoped to what was actually verified (brand-1 AC-6)', () => {
    // The verification behind this claim is "no AI/LLM dependency in any package
    // manifest and no AI/LLM reference in source". That supports "no AI
    // features"; it does NOT support the broader "no machine-learning features"
    // the copy briefly carried, which was dropped at code review. Pin both the
    // pledge and the absence of the over-broad wording, so the claim cannot
    // silently widen again or rot if an inference feature ever ships.
    const features = contentFor('features')
    expect(features).toContain('No ads, no trackers, no AI — ever.')
    expect(features).toMatch(/no AI features/)
    expect(features).not.toMatch(/machine[- ]learning/i)
  })

  it('the FAQ describes Lunch Money accurately as a Canadian app, not implied-US (story 23-2)', () => {
    // Story 23-2 (CONTENT-M): the spend-tracker entry recommended Lunch Money and then
    // said "Non-US options exist too if data residency matters to you", which implies
    // Lunch Money is US-based. It is a Canadian app. Pin the correction on two axes:
    // the positive assertion ties the "Canadian" attribution to Lunch Money itself
    // (not merely somewhere in the FAQ), and the negative removes the old framing.
    // "Lunch Money, a Canadian app" hard-wraps across two physical lines, so the regex
    // uses \s+ to span the line break. `not.toContain` is the load-bearing guard — it
    // fails if the old US-implying sentence returns.
    const faq = contentFor('faq')
    expect(faq).toMatch(/Lunch Money,\s+a Canadian app/)
    expect(faq).not.toContain('Non-US options exist too')
  })

  it('the FAQ explains the monthly-basis conversion is an estimate using the ~4.33 factor (story 23-1)', () => {
    // Story 23-1 (investigation → keep monthly, clarify disclosure): the "why do my
    // totals differ" answer must state the ~4.33 weekly factor and that the monthly
    // figure is an estimate, and it must NOT overclaim that the info button reveals a
    // per-figure conversion breakdown (the tooltip shows the amount entered before
    // conversion, not a factor-by-factor breakdown).
    // NOTE: the pre-23-1 copy already contained "4.33" and "estimate", so those two
    // substrings alone don't prove the new disclosure landed. Anchor the positive
    // assertion to the distinguishing new phrasing so a partial revert breaks this.
    const faq = contentFor('faq')
    expect(faq).toContain('4.33')
    expect(faq.toLowerCase()).toContain('average number of weeks in a month')
    expect(faq.toLowerCase()).toContain('estimate rather than an exact calendar-month total')
    expect(faq.toLowerCase()).not.toContain('how it was converted')
  })

  it('the Features page discloses the common monthly basis is an estimate/average (story 23-1)', () => {
    // Story 23-1: the "common monthly basis" bullet must carry the same estimate/
    // average nuance as the FAQ so the two explanation surfaces stay consistent.
    // "common monthly basis" pre-dates 23-1, so anchor to the new 4.33/estimate
    // nuance in the Free section to make this assertion load-bearing. (The bullet
    // hard-wraps, so match the wrap-safe "4.33" token rather than a multi-word span.)
    const free = featureSections().free
    expect(free).toContain('common monthly basis')
    expect(free).toContain('4.33')
    expect(free).toContain('estimate')
  })

  // The Features page splits into an intro, a Free section and a Premium section;
  // the guards below assert *which* section a claim lives in, not just that a
  // substring appears somewhere on the page.
  //
  // ⚠️ `free` is everything ABOVE the Premium heading, which means it includes the
  // INTRO PARAGRAPH as well as the Free tier list. That conflation was harmless
  // only for as long as the intro named a subset of the Premium benefits. Story
  // 33.2 (FR56) requires the intro to enumerate the whole Premium set, at which
  // point `expect(free).not.toContain('custom categories')` started failing on a
  // sentence that reads "a Premium tier that adds … custom categories" — i.e. the
  // assertion failed on copy that says exactly what the assertion wants to be true.
  //
  // So tier-PLACEMENT claims now use `freeTier`, the Free bullet list alone. A
  // negative scoped to a slice is only as precise as the slice: this one was
  // measuring "appears anywhere before the Premium heading" while claiming to
  // measure "is advertised as a Free feature".
  const featureSections = () => {
    const content = getDocPage('features')?.content ?? ''
    const premiumIndex = content.indexOf('### Premium tier')
    if (premiumIndex === -1) throw new Error('Features page is missing the Premium tier section')
    const freeIndex = content.indexOf('### Free tier')
    if (freeIndex === -1) throw new Error('Features page is missing the Free tier section')
    // Without this, a reordered file makes `freeTier` the EMPTY STRING and every
    // `expect(freeTier).not.toContain(...)` below passes vacuously — including the
    // categories tier-placement half, which has no positive to catch it indirectly.
    if (freeIndex >= premiumIndex) {
      throw new Error('Features page lists the Premium tier before the Free tier')
    }
    return {
      free: content.slice(0, premiumIndex).toLowerCase(),
      freeTier: content.slice(freeIndex, premiumIndex).toLowerCase(),
      premium: content.slice(premiumIndex).toLowerCase(),
    }
  }

  it('the Features page states no ads universally, not as a Premium perk (story 25-1)', () => {
    // Story 25-1 removed all advertising: "no ads" is now an unconditional trait
    // of the whole app, not a paywalled benefit. Assert the statement appears on
    // the page but is NOT scoped to the Premium section.
    const content = getDocPage('features')?.content ?? ''
    expect(content.toLowerCase()).toContain('no ads')
    expect(featureSections().premium).not.toContain('no ads')
  })

  it('the Features page lists Dark mode under the Free tier, not Premium (story 25-3)', () => {
    // Story 25-3 moved dark mode to Free: it must appear in the Free bullet list
    // and NOT be advertised under Premium.
    const { freeTier, premium } = featureSections()
    expect(freeTier).toContain('dark mode')
    expect(premium).not.toContain('dark mode')
  })

  it('the Features page keeps Retirement modeling under the Free tier (story 13-1, AC-4)', () => {
    // AC-4 do-not-regress guard: retirement stays Free (decided 2026-07-06) — it
    // must appear in the Free bullet list and NOT be advertised under Premium.
    const { freeTier, premium } = featureSections()
    expect(freeTier).toContain('retirement modeling')
    expect(premium).not.toContain('retirement modeling')
  })

  it('the Features page documents Custom categories under Premium only (story 30.4b, AC-8)', () => {
    // Categories are a Premium benefit: they must be documented in the Premium
    // section and must never appear as a Free tier bullet.
    //
    // ⚠️ This comment used to say "categories are documented here and NOWHERE else
    // — the canonical three-benefit set (premium-prompt / pricing-page) stays at
    // three, which is what keeps all five pinned count assertions passing." That is
    // now false in every clause: story 33.2 (FR56) added categories to /pricing, the
    // upgrade prompt and the Overview precisely BECAUSE documenting them here and
    // nowhere else meant a paying user could not discover a feature they had bought.
    // The set is five, and the count assertions are derived from
    // PREMIUM_BENEFIT_IDS.length rather than pinned to a literal.
    //
    // The negative is scoped to `freeTier`, not `free`: the intro paragraph now
    // enumerates the Premium set, so it names categories while correctly attributing
    // them to Premium. See the note on `featureSections`.
    const { freeTier, premium } = featureSections()
    expect(premium).toContain('custom categories')
    expect(freeTier).not.toContain('custom categories')
  })

  it('the Custom categories bullet documents the per-category breakdown (story 30.5)', () => {
    // Anchored on DISTINGUISHING phrasing rather than the word "breakdown",
    // which the Advanced forecasting and overview copy could also carry: the
    // "share of that side" framing is what 30.5 actually shipped, and it is
    // what would go missing if the sentence were dropped.
    // ⚠️ Deliberately still scoped to `free` (intro + Free list), NOT the narrower
    // `freeTier`. The rescope elsewhere in this file exists only for anchors the
    // intro must now legitimately contain — benefit NAMES. This phrase is not one of
    // them, so narrowing it would have been a silent weakening dressed up as part of
    // one uniform cleanup: it would let breakdown wording appear, mis-tiered, above
    // the fold. Narrow a negative only when something forces you to.
    const { premium, free } = featureSections()
    expect(premium).toContain('what share of that side it is')
    expect(premium).toContain('uncategorized line')
    expect(free).not.toContain('what share of that side it is')
  })

  it('the Custom categories bullet claims no cross-device sync (story 30.4b)', () => {
    // ⚠️ Category rows cannot reach the server at all yet (deferred sync-create
    // repair). Copy that said otherwise would be a false premise shipped to
    // users, which is the exact failure mode this batch keeps producing. Scope
    // the check to the bullet, since the section legitimately advertises sync
    // as a SEPARATE benefit.
    const { premium } = featureSections()
    const start = premium.indexOf('**custom categories**')
    // `>= 0`, not `> 0`: this is an existence check, and `indexOf` returning 0
    // is a hit, not a miss.
    expect(start).toBeGreaterThanOrEqual(0)
    // ⚠️ Every "not found" must fall back to the END of the section, never to
    // the raw -1: `slice(start, -1)` silently drops the last character, so a
    // sync claim appended at the very end of the section could partly escape
    // this guard (code review 30.4b).
    const candidates = [premium.indexOf('\n- **', start), premium.indexOf('\n###', start)].filter(
      (index) => index > start
    )
    const end = candidates.length > 0 ? Math.min(...candidates) : premium.length
    const bullet = premium.slice(start, end)
    expect(bullet).not.toMatch(/sync|across (?:all )?your devices|other devices|phone to laptop/)
  })

  it('the Features page describes Advanced forecasting honestly (stories 20-1, 30-2)', () => {
    // The forecasting copy must describe only what ships. Story 20-1 wrote this
    // guard when saved forecasts could NOT be reopened and the Projections chart
    // showed canned sample data, so it forbade "reloadable" outright. Story bug-3
    // shipped both, which left this negative enforcing a dead premise — it was
    // forbidding accurate copy. Story 30-2 inverts it: the reload claim is now
    // PINNED rather than banned, so coverage moves instead of dropping.
    //
    // NOTE both slices are lowercased by featureSections(), so every literal
    // here must be lowercase. The reload pin deliberately anchors on the clause
    // ALONE, not on the whole bullet: it must be able to fail when only the
    // reload words are removed, otherwise it merely re-proves the two pins above.
    const { premium } = featureSections()
    expect(premium).toContain('what-if scenarios')
    expect(premium).toContain('searchable list')
    // Interior spaces are \s+: this clause ends at column 77 of a hard-wrapped
    // paragraph, so a literal-space toContain would go red on a pure reflow
    // (30-2 review; matches the \s+ convention the two guards below use).
    expect(premium).toMatch(/reload\s+any\s+of\s+them\s+back\s+into\s+the\s+builder/)

    // Side-by-side is still a REAL overpromise and this negative stays: nothing
    // plots two SAVED forecasts together. bug-3 wired reload and the chart, but
    // built no comparison view, so retiring this alongside the reload negative
    // would silently reopen the overpromise story 20-1 removed.
    //
    // Matches BOTH spellings. The spaced-only literal this replaces was blind to
    // "side-by-side" — which is the form this repo's own comments use in all
    // four places they mention it, so the hyphen was the likelier drift (30-2
    // review). Widening a negative can only ever catch more; story 30-2 AC-5
    // froze this assertion's INTENT, and this preserves it.
    expect(premium).not.toMatch(/side[\s-]by[\s-]side/)
  })

  it('scopes the EU-storage claim to SAVED forecasts, and states it once (story 30-2)', () => {
    // FR52 wants Advanced forecasting understood as EU-stored. The claim is true
    // only of SAVED forecasts: the forecast math runs in the browser, so copy
    // implying the calculation happens on an EU server would be false. Anchor on
    // the scoping words ("saved forecasts are stored"), not on "european union"
    // alone — the latter already appears in the sync bullet and would be
    // true-by-construction here. Interior spaces are \s+ so a re-wrap of the
    // bullet cannot produce a false failure (Epic-23 lesson).
    const { premium } = featureSections()
    expect(premium).toMatch(
      /saved\s+forecasts\s+are\s+stored\s+on\s+servers\s+in\s+the\s+european\s+union/
    )

    // Within the Premium BENEFIT BULLETS the EU claim may appear exactly twice —
    // once for sync, once for saved forecasts — and nowhere else. Scope the count
    // to the bullets: the `premium` slice runs to end-of-file and so also carries
    // the "Privacy and data location" section, whose own EU sentence is not a
    // benefit claim and must not be counted. A third hit inside the bullets means
    // the claim was pasted onto custom profiles too, which it is not true of.
    //
    // ⚠️ Assert the heading EXISTS before slicing on it. When `indexOf` returns
    // -1, `slice(0, -1)` yields almost the WHOLE section rather than an empty
    // string, so the `not.toHaveLength(0)` sentinel this replaces could never
    // fire (30-2 review). Today a renamed heading still fails downstream, but
    // only because the Privacy prose happens to repeat "European Union" —
    // reword that one sentence to "the EU" and the guard would silently widen
    // to the whole document while staying green.
    const privacyIndex = premium.indexOf('### privacy')
    expect(privacyIndex).toBeGreaterThan(0)
    const premiumBullets = premium.slice(0, privacyIndex)
    expect(premiumBullets.match(/european union/g) ?? []).toHaveLength(2)
  })

  it('contrasts the free retirement projection with Premium forecasting (story 30-2, AC-3)', () => {
    // FR52 requires Advanced forecasting to read as distinct from the FREE
    // retirement projection. The contrast is written into the
    // intro prose rather than the Premium bullet on purpose: the Premium section
    // is guarded against containing "retirement modeling" (story 13-1 AC-4,
    // above), so naming the free charts inside it would fail that guard.
    //
    // Anchor on the distinguishing contrast clause. The generic words
    // ("forecasting", "projections") appear throughout the page and would be
    // true-by-construction. Every interior space is \s+ because this paragraph
    // hard-wraps and a reflow must not read as a copy regression.
    //
    // ⚠️ The second pin deliberately anchors on "a separate what-if workspace".
    // An earlier 30-2 draft read "lets you model alternatives to THOSE NUMBERS",
    // which implied the builder carries your budget figures over from the free
    // projections. It does not: scenario-builder.tsx imports only currencyStore
    // and seeds hardcoded defaults (Salary $5,000/mo, savings $5,000), so the
    // user retypes everything. "Separate workspace" is the honest framing — do
    // not reintroduce a continuity claim here (30-2 review).
    const { free } = featureSections()
    // ⚠️ MOVED by story 43.3, not relaxed. FR69 removed the free net-worth
    // projection page, so the old pin ("free net-worth and retirement
    // projections chart where your current numbers lead") became FALSE by
    // design. The distinguishing clause is still "charts where your current
    // numbers lead" — do NOT weaken this to /projections/, which appears
    // throughout the page and would be true-by-construction.
    expect(free).toMatch(
      /free\s+retirement\s+projection\s+charts\s+where\s+your\s+current\s+numbers\s+lead/
    )
    expect(free).toMatch(/premium\s+forecasting\s+is\s+a\s+separate\s+what-if\s+workspace/)
  })

  it('the docs carry the "without bank sync or AI integrations" framing (FR45 as amended by brand-1)', () => {
    // FR45 unifies the three privacy pillars (no account, optional EU-hosted sync,
    // no bank connection) under this framing. It is woven into the positioning copy
    // (Features, and Getting started). Markdown hard-wraps at ~76 columns, so match
    // with \s+ to span a possible line break rather than a literal-space toContain
    // (Epic-23 wrap lesson). Asserting the distinguishing framing phrase — not the
    // generic pillar words that already appear across the docs — makes this guard
    // load-bearing (batch-5/23 true-by-construction lesson).
    //
    // brand-1 amends FR45: the framing now also carries the no-AI stance, and
    // drops "the" before "bank sync". Every interior space is \s+ so a hard-wrap
    // anywhere in the phrase cannot produce a false failure.
    const framing = /intentional\s+budgeting\s+without\s+bank\s+sync\s+or\s+AI\s+integrations/i
    expect(framing.test(contentFor('features'))).toBe(true)
    // Getting started carries the framing too — a THIRD site the brand-1 story
    // itself did not list (it named only HomePage and features.md). Left stale it
    // would have shipped two different versions of the same positioning line.
    expect(framing.test(contentFor('getting-started'))).toBe(true)
    // The pre-amendment wording must be gone from both.
    const oldFraming = /without\s+the\s+bank\s+sync/i
    expect(oldFraming.test(contentFor('features'))).toBe(false)
    expect(oldFraming.test(contentFor('getting-started'))).toBe(false)
  })

  /**
   * ════════════════════════════════════════════════════════════════════════
   * "Getting started" — income means take-home pay (story 46.1, UX-DR52)
   * ════════════════════════════════════════════════════════════════════════
   *
   * ⚠️ Every other getting-started guard in this file matches the WHOLE
   * DOCUMENT (`contentFor('getting-started')`). That is fine for a positioning
   * line that may legitimately appear anywhere, and wrong for this story, which
   * writes to two sections sixteen lines apart: an unscoped assertion cannot
   * tell whether the definition landed in the step list or in the overview
   * paragraph, so it would pass with the copy in the wrong place entirely.
   *
   * `featureSections()` and `howTotalsSections()` and `mortgageSections()` all
   * exist for exactly this reason, each added after a whole-document guard was
   * found passing against the defect it was meant to catch. This is the FOURTH
   * page to need one; the first three were already written down in this file
   * and that did not stop the fourth from starting out unscoped.
   *
   * The `throw` on a missing heading is load-bearing, not defensive: without it
   * a renamed or reordered heading silently yields an EMPTY slice and every
   * assertion below passes vacuously.
   */
  const gettingStartedSections = () => {
    const content = contentFor('getting-started')
    const bounds = (start: string, end: string): string => {
      const from = content.indexOf(start)
      if (from === -1) throw new Error(`Getting started is missing the "${start}" heading`)
      const to = content.indexOf(end, from)
      if (to === -1) throw new Error(`Getting started is missing the "${end}" heading`)
      // ADJACENCY, not merely order. `indexOf(end, from)` already throws on a
      // fully reordered file, but it cannot see a section INSERTED between the
      // two headings — that yields a non-empty slice spanning foreign sections,
      // and every assertion below then passes with the copy in the wrong place.
      // `featureSections()` guards ordering only and has the same residual hole;
      // this is the tighter version.
      const nextHeading = content.indexOf('\n### ', from + start.length)
      if (nextHeading !== -1 && nextHeading + 1 !== to) {
        throw new Error(
          `Getting started: "${end}" is not the section immediately after "${start}" — a section was inserted between them and the slice would span it`
        )
      }
      return content.slice(from, to)
    }
    return {
      addIncome: bounds('### Add your first income source', '### Add your expenses'),
      overview: bounds('### See your overview', '### Next steps'),
    }
  }

  it('tells you in the income steps that the amount is take-home pay (story 46.1)', () => {
    const { addIncome } = gettingStartedSections()

    // Anchored on the distinguishing clause. "income" and "amount" appear all
    // over this page — and in this very section — so either would pass against
    // the pre-46.1 text, which said only "Enter the amount."
    expect(addIncome).toMatch(/reaches\s+your\s+bank\s+account/i)
    expect(addIncome).toMatch(/after\s+tax/i)
    expect(addIncome).toMatch(/deductions/i)
  })

  it('uses "net" on this page ONLY for net worth (story 46.1)', () => {
    // `netIncome` in core means income MINUS EXPENSES, and the docs must not
    // introduce a second meaning for the same word.
    //
    // ⚠️ An earlier version of this guard banned three exact collocations
    // (`net\s+(pay|income|salary)`). That let "net monthly income", "net
    // earnings" and hyphenated "net-pay" straight through — an intervening
    // adjective, a synonym, or a hyphen each defeated it, and the test's own
    // title claimed far more than it checked. Ban the WORD and carve out the
    // one legitimate term instead of trying to enumerate the illegitimate ones.
    expect(contentFor('getting-started')).not.toMatch(/\bnet\b(?!\s+worth)/i)
    // The carve-out is real, not theoretical — the overview names net worth.
    expect(contentFor('getting-started')).toMatch(/\bnet\s+worth\b/i)
  })

  it('does not claim the overview shows a figure it no longer renders (story 46.1)', () => {
    const { overview } = gettingStartedSections()

    // The page said "your net period income" — a second meaning of "net", and
    // ALSO a claim that has been false since story 12.1 removed that card on
    // 2026-07-07. `HomePage.tsx:172-178` reads only `.grossIncome` and
    // `.totalExpenses` from `calculateNetIncomeResult`; `.netIncome` is never
    // rendered. The overview shows three cards: Total Income, Total Expenses,
    // Net Worth. Re-pointing the sentence at "the gap between them" would have
    // kept the falsehood and pinned it; the clause is gone instead.
    expect(overview).not.toMatch(/net\s+period\s+income/i)
    expect(overview).not.toMatch(/gap\s+between\s+them/i)
    // What the overview DOES render must still be named.
    expect(overview).toMatch(/net\s+worth/i)
    expect(overview).toMatch(/income\s+and\s+expenses/i)
  })

  /**
   * ════════════════════════════════════════════════════════════════════════
   * "How totals are calculated" (story 32.3, CONTENT-P)
   * ════════════════════════════════════════════════════════════════════════
   *
   * ⚠️ Every guard below anchors on phrasing that ONLY THIS PAGE carries. `4.33`
   * and `estimate` already appear in faq.md and features.md, so asserting them
   * here would be true-by-construction and would prove nothing about the new
   * page (the batch-5/23 lesson, and the reason the 23-1 guard above had to be
   * re-anchored).
   *
   * ⚠️ Every interior space is `\s+`. Markdown hard-wraps at ~76 columns, so a
   * literal-space `toContain` goes red on a pure reflow — Epic 23's recorded
   * lesson, and the convention the four guards above already follow.
   */
  const howTotals = () => contentFor('how-totals-are-calculated')

  /**
   * The page's `###` sections, so a guard can prove WHERE a claim lives.
   *
   * ⚠️ AC-14's third rule ("assert the section, not just the page",
   * `featureSections()` being the precedent) was NOT applied on the first pass —
   * every guard matched the whole page, so moving the spreadsheet-equivalence
   * sentence into the rounding section would have kept them all green. Caught in
   * code review. Each heading is asserted to EXIST before slicing: `indexOf`
   * returning -1 would otherwise silently widen a slice to most of the document,
   * which is the 30-2 trap this file already records twice.
   */
  const howTotalsSections = () => {
    const content = howTotals()
    const bounds = [
      ['factors', '### The conversion factors'],
      ['spreadsheet', '### The same maths as your spreadsheet'],
      ['example', '### A worked example'],
      ['rounding', '### Why a few cents go missing'],
    ] as const
    const starts = bounds.map(([, heading]) => {
      const index = content.indexOf(heading)
      if (index === -1) throw new Error(`how-totals page is missing the heading: ${heading}`)
      return index
    })
    const sections = {} as Record<(typeof bounds)[number][0], string>
    for (const [i, [key]] of bounds.entries()) {
      sections[key] = content.slice(starts[i], starts[i + 1] ?? content.length)
    }
    return sections
  }

  it('states the conversion factors as DIVISIONS, not as a 4.33 rule of thumb', () => {
    // ⚠️ Scoped to the factors SECTION, not the page (AC-14 rule 3): the
    // divisions must live under the heading that promises them.
    const { factors } = howTotalsSections()
    expect(factors).toMatch(/×\s*52\s*÷\s*12/)
    expect(factors).toMatch(/×\s*26\s*÷\s*12/)
    // The inverse rule for re-expressing a monthly figure at another period.
    expect(factors).toMatch(/\*\*yearly\*\*\s*=\s*monthly\s*×\s*12/)
    expect(factors).toMatch(/\*\*weekly\*\*\s*=\s*monthly\s*×\s*12\s*÷\s*52/)
    // Names the period the SELECTOR shows, not only the prose form. The page
    // exists to be checked against the UI, so it must use the UI's word.
    expect(factors).toMatch(/\*\*Bi-weekly\*\*/)
  })

  it('tells a spreadsheet user the arithmetic is the SAME, so they check their data', () => {
    // The verified claim FR58 rests on: the conversions are algebraically
    // identical to the common spreadsheet approach, so a discrepancy points at
    // the entries, not at a different model. Anchored on the distinguishing
    // sentence rather than the word "spreadsheet", which the FAQ also uses, and
    // scoped to the section that makes the claim.
    const { spreadsheet } = howTotalsSections()
    expect(spreadsheet).toMatch(/the\s+same\s+arithmetic\s+you\s+are\s*\n?\s*already\s+doing/)
    expect(spreadsheet).toMatch(/algebraically\s+identical/)
    expect(spreadsheet).toMatch(/yearly\s*÷\s*52/)
    expect(spreadsheet).toMatch(/monthly\s*×\s*12\s*÷\s*52/)
    // ⚠️ Rounding must be offered as a CAUSE here. Without it a user with a 4c
    // gap audits every row, finds nothing, and files the "total is off" report
    // this page was written to prevent.
    expect(spreadsheet).toMatch(/only\s+a\s+few\s+cents/)
  })

  it('discloses BOTH rounding sources with their magnitudes, and the $99.96 case', () => {
    const { rounding } = howTotalsSections()
    // Source 1 — per-entry rounding on the way in, with its scale.
    expect(rounding).toMatch(/rounded\s+to\s+the\s+nearest\s+cent\s+as\s+it\s+is\s+converted/)
    expect(rounding).toMatch(/under\s+half\s+a\s+cent\s+per\s+entry/)
    expect(rounding).toMatch(/under\s+about\s+six\s+cents\s+per\s+entry/)
    // Source 2 — breakdown vs whole-set, consistent with the in-product notes.
    // The two must be told apart, not conflated.
    expect(rounding).toMatch(/rounded\s+separately\s+from\s+the\s+total/)
    // The documented app-wide convention behind the $100 → $99.96 report, so the
    // next sighting resolves against this page instead of a re-investigation.
    expect(rounding).toContain('$99.96')
  })

  it('makes no claim about WHERE entries are stored (the app stores what you entered)', () => {
    // ⚠️ The page said the monthly figure "is the one Longhand stores", and that
    // entries were "stored as" their rounded monthly value. Both are false — the
    // stores hold the ENTERED amount and frequency and derive monthly per render,
    // which is what `faq.md` already tells the user. A false persistence claim on
    // the one page whose purpose is to be reconcilable against is worse than no
    // page. Caught in code review 32.3.
    const page = howTotals()
    expect(page).not.toMatch(/\bstores\b/)
    expect(page).not.toMatch(/\bstored\s+as\b/)
    // And the positive claim that replaced it.
    expect(page).toMatch(/kept\s+exactly\s+as\s+you\s+typed\s+them/)
  })

  it('the worked example matches what core actually computes (computed, not retyped)', () => {
    // ⚠️ COMPUTED FROM CORE, never retyped as a literal. If core's factors or its
    // per-entry rounding ever change, this page's own numbers go red — whereas a
    // hard-coded '60,399.96' would let the doc rot into a lie while the suite
    // stayed green (the same failure family as 32.2's copied parity helper).
    const monthly = calculateTotalMonthlyNormalized([
      { amount: 200_000, frequency: 'biweekly' },
      { amount: 60_000, frequency: 'monthly' },
      { amount: 120_000, frequency: 'annually' },
    ])
    const yearly = denormalizeFromMonthly(monthly, 'annually')

    const { example } = howTotalsSections()
    expect(example).toContain(formatCents(monthly)) // 503_333c → '5,033.33'
    expect(example).toContain(formatCents(yearly)) // 6_039_996c → '60,399.96'

    // The spreadsheet comparison the example is built to expose: 4c apart.
    const spreadsheetYearly = 2_000_00 * 26 + 600_00 * 12 + 1_200_00
    expect(spreadsheetYearly - yearly).toBe(4)
    expect(example).toContain(formatCents(spreadsheetYearly)) // '60,400.00'

    // ⚠️ THE PER-ROW FIGURES ARE COMPUTED TOO, not just the totals. The first
    // version guarded only the three totals, so a core per-row change that a
    // later editor "fixed" by adjusting the totals alone would have left
    // row-level lies the suite could not see — a smaller instance of exactly the
    // rot this guard exists to stop. Caught in code review 32.3.
    for (const [amount, frequency] of [
      [200_000, 'biweekly'],
      [60_000, 'monthly'],
      [120_000, 'annually'],
    ] as const) {
      expect(example).toContain(formatCents(normalizeToMonthly(amount, frequency)))
    }
  })

  it('the FAQ lists all FOUR selectable durations, including biweekly (story 32.3, AC-7)', () => {
    // Story 32.1 added `biweekly` as a fourth selectable duration, which made
    // this FAQ sentence false; 32.3 repaired it. ⚠️ THIS GUARD WAS MISSING on
    // the first pass — the §6 mutation run reverted the repair and the whole
    // suite stayed green, i.e. the fix had shipped untested. Interior spaces are
    // `\s+`: the sentence hard-wraps between "duration" and "selector".
    const faq = contentFor('faq')
    expect(faq).toMatch(/weekly,\s+biweekly,\s+monthly,\s+and\s+annual\s+totals/)
    // The stale three-value claim must be gone, not merely supplemented.
    expect(faq).not.toMatch(/between\s+weekly,\s+monthly,\s+and\s+annual/)
  })

  it('all three existing surfaces link to the new page (story 32.3, AC-7)', () => {
    // Each of these already stated a FRAGMENT of the conversion model with
    // nowhere to send the reader. ⚠️ The internal-link guard below proves a link
    // RESOLVES; only this proves the links EXIST — deleting all three would
    // leave that guard perfectly green.
    const link = '(/docs/how-totals-are-calculated)'
    expect(contentFor('faq')).toContain(link)
    expect(contentFor('features')).toContain(link)
    expect(contentFor('getting-started')).toContain(link)
  })

  it('uses no markdown table — a bare <table> overflows the 320px floor', () => {
    // `MarkdownRenderer` renders a bare <table> inside `prose` with no
    // overflow-x wrapper, so a factor table would push the page into horizontal
    // overflow and fail `e2e/responsive-320.spec.ts`. No other doc or legal page
    // uses one; this page must not be the first.
    const page = howTotals()
    // Leading-pipe form: | a | b |
    expect(page).not.toMatch(/^\s*\|/m)
    // ⚠️ PIPELESS FORM TOO. GFM accepts `a | b` over `--- | ---` with no leading
    // pipe, which renders the same bare <table> and reintroduces the same 320px
    // overflow — and the leading-pipe regex above never sees it. Caught in code
    // review 32.3. The delimiter row is the reliable signature of either form.
    // ⚠️ `-+`, NOT `-{3,}`. GFM accepts ONE dash per delimiter cell, so `-|-`
    // and `:-:|:-:` are valid tables that a three-dash regex sails past. The
    // how-totals guard above still has the narrower form; widening it is not
    // this story's change to make, but the new page gets the correct one.
    expect(page).not.toMatch(/^\s*:?-+:?\s*\|/m)
  })

  it('every internal doc link targets a real app route', () => {
    // The routes referenced by the docs; each exists under apps/web/src/routes.
    const knownRoutes = new Set([
      '/docs/getting-started',
      '/docs/features',
      '/docs/faq',
      // Story 32.3 — linked from the FAQ, Features and Getting started.
      '/docs/how-totals-are-calculated',
      // Story 36.3 — linked from Features and Getting started.
      '/docs/where-a-mortgage-belongs',
      // Story 36.3: the mortgage page sends readers to the two entry surfaces.
      // Both routes have existed since epic 1 but no doc had ever linked them,
      // which is why they were absent from this allow-list rather than omitted
      // on purpose.
      '/expenses',
      '/balance',
      '/privacy',
      '/settings',
      '/contact',
      // Story 43.3 removed '/net-worth-projection'. This set is hand-maintained,
      // so a stale entry here would let this test bless a doc link to a 404 —
      // the entry must leave with the route, not after it.
      '/retirement',
      // Story 43.5: the mortgage page sends readers to the Savings page, because
      // an asset carries no contribution and money put aside toward one belongs
      // there instead (`BalancePage.tsx`'s asset hint says the same). The route
      // has existed since epic 1; it was absent here only because no doc linked it.
      '/savings',
    ])
    const internalLink = /\]\((\/[^)]*)\)/g
    for (const page of DOC_PAGES) {
      for (const match of page.content.matchAll(internalLink)) {
        expect(knownRoutes.has(match[1])).toBe(true)
      }
    }
  })

  /**
   * Story 36.3 (CONTENT-O). The mortgage page makes factual claims about which
   * calculations read which figure, so these guards pin the CLAIMS, not the
   * page's existence.
   *
   * ⚠️ Every interior space is `\s+`: the body hard-wraps at ~76 columns like
   * its siblings, so a literal-space `toContain` would go red on a pure reflow
   * (Epic 23's recorded lesson, and the reason the guards above are written the
   * same way).
   */
  const mortgage = () => contentFor('where-a-mortgage-belongs')

  /**
   * The page's `###` sections, so a guard can prove WHERE a claim lives.
   *
   * ⚠️ Added by story 43.5, and it is the single most important guard on this
   * page. Until now EVERY mortgage assertion matched the whole document, so
   * moving a claim from one section to another — attributing an effect to the
   * wrong figure — kept all of them green. "Which figure feeds which
   * calculation" is the only thing this article exists to say, which made its
   * central thesis the one property the suite could not see.
   *
   * Same shape as `howTotalsSections()` above: each heading must EXIST before
   * slicing, because `indexOf` returning -1 silently widens a slice to most of
   * the document and every negative guard inside it then passes vacuously.
   */
  const mortgageSections = () => {
    const content = mortgage()
    const bounds = [
      ['intro', '## Where a mortgage belongs'],
      ['where', '### Where each part goes'],
      // ⚠️ Story 49.2 inserted this heading BETWEEN `where` and `payment`, which
      // shortens the `where` slice. The 43.5 AC-1 guard below reads `where` and
      // still passes because every claim it pins sits above the new heading —
      // verified by running it, not assumed.
      ['example', '### A worked example'],
      ['payment', '### What the payment changes'],
      ['owed', '### What the amount still owed changes'],
      ['property', '### What the property is worth changes'],
      ['wrong', '### If your net worth looks wrong'],
    ] as const
    const starts = bounds.map(([, heading]) => {
      const index = content.indexOf(heading)
      if (index === -1) throw new Error(`mortgage page is missing the heading: ${heading}`)
      return index
    })
    // ⚠️ Ordering invariant, `featureSections()`'s precedent: if the file is
    // reordered, a slice becomes the EMPTY STRING and every negative assertion
    // below passes against nothing.
    for (const [i, start] of starts.entries()) {
      if (i > 0 && start <= starts[i - 1]) {
        throw new Error(`mortgage page sections are out of order at: ${bounds[i][1]}`)
      }
    }
    const sections = {} as Record<(typeof bounds)[number][0], string>
    for (const [i, [key]] of bounds.entries()) {
      sections[key] = content.slice(starts[i], starts[i + 1] ?? content.length)
    }
    return sections
  }

  it('the mortgage page states the three-part model and scopes the debt claims (43.5, AC-1)', () => {
    const page = mortgage()
    const { where } = mortgageSections()
    // ⚠️ Story 43.5: all three routing claims are scoped to `### Where each part
    // goes`. Page-wide, a rewrite could move "goes on the Expenses page" into the
    // section about what the DEBT changes and stay green — which is the exact
    // misattribution this article exists to prevent.
    // The payment goes to Expenses, the balance owing goes to Balance Tracking as a Debt.
    expect(where).toMatch(/recurring\s+\*\*payment\*\*\s+goes\s+on\s+the\s+\[Expenses\]/i)
    expect(where).toMatch(
      /\*\*amount\s+still\s+owed\*\*\s+goes\s+on\s+the\s+\[Balance\s+Tracking\]/i
    )
    expect(where).toMatch(/type\s+\*\*Debt\*\*/)
    // ⚠️ FR70's third part. The literal type name is `Asset` (D10) — NOT "Property"
    // and NOT "owned outright", which is prose in the corpus but not the label the
    // Type dropdown renders (`BalancePage.tsx` TYPE_OPTIONS).
    expect(where).toMatch(
      /\*\*property\s+itself\*\*\s+goes\s+on\s+the\s+same\s+page[^.]*type\s+\*\*Asset\*\*/i
    )
    // All three Type choices are named, so the page cannot go stale by listing two.
    expect(where).toMatch(/\*\*Investment\*\*,\s+\*\*Debt\*\*\s+and\s+\*\*Asset\*\*/)
    // ⚠️ The intro must announce the third figure. Without this the opening
    // reverts to a pure two-part framing ("The two figures are read by different
    // calculations") that contradicts the rest of the page — and the `intro`
    // slice was previously computed and never asserted against.
    const { intro } = mortgageSections()
    expect(intro).toMatch(/there\s+is\s+a\s+third\s+figure/i)
    // Both entry surfaces are linked, not merely named — Task 3's knownRoutes
    // entries are dead weight otherwise, and the mutation table's M7 depends on
    // the `/expenses` link existing.
    expect(page).toContain('(/expenses)')
    expect(page).toContain('(/balance)')
    // The reassurance is DEBT-SCOPED. Entering the same money as an expense and
    // as an INVESTMENT row's contribution IS double-counted today
    // (`savingsAllocation.ts` subtracts both), so the unqualified form of this
    // sentence would be false. The scoping list is the guard.
    // ⚠️ ONE regex spanning the debt list THROUGH the reassurance, deliberately.
    // Two independent assertions would both stay green if a future edit moved
    // the reassurance into an unqualified standalone sentence while the loan
    // list survived elsewhere on the page — which is precisely the failure this
    // guard exists to prevent (review 36.3).
    expect(page).toMatch(
      /car\s+loan,\s+a\s+student\s+loan,\s+or\s+a\s+credit-card\s+balance[^.]*does\s+not\s+count\s+the\s+same\s+money\s+twice/i
    )
  })

  /**
   * ⚠️ RESOLVED by story 43.5. The coupling 43.3's code review recorded here is
   * discharged: this article no longer describes the deleted net-worth projection
   * page, and the pins below now assert the corrected claims instead of the stale
   * ones. Nothing was relaxed — each retired pin was replaced by a positive pin on
   * the sentence that replaced it, plus a negative proving the old claim is gone.
   *
   * ⚠️ The projection sentences were DELETED, not re-pointed at Premium
   * forecasting. Forecasting has no debt term at all (`forecasting.ts` — grep it,
   * `netWorth = savings + investments`) and its inputs are typed by hand rather
   * than read from your stores, so "the projection holds your debts flat" has no
   * truthful home anywhere in the app. Re-pointing it would be a NEW false claim.
   */
  /**
   * Story 47.2 (FR74). "What the payment changes" listed the retirement planner,
   * "which works out what you save each month from the gap between your income
   * and your expenses". Once the planner reads investment CONTRIBUTIONS instead,
   * a mortgage payment stops affecting it by any route — so the bullet was
   * DELETED rather than re-pointed at the new source.
   *
   * ⚠️ Deleting rather than re-pointing is story 46.1's hard-won lesson, and it
   * cost that story a code-review finding: its AC re-aimed a sentence at a figure
   * that had not been rendered for seven weeks, and the new test PINNED the
   * falsehood. A guard that pins a false claim is worse than no guard. Here the
   * true statement is that the payment changes nothing on the planner, and a
   * bullet in a list of things it DOES change cannot say that.
   *
   * ⚠️ Scoped to the `payment` slice, and the two survivors below are the reason.
   * The planner's POT is legitimately named twice elsewhere on this page (the
   * mortgage balance and the property value both stay out of it, FR48 — unchanged
   * by 47.2). A page-wide ban would be red on arrival and a page-wide absence
   * check would pass while the bullet sat in the wrong section.
   */
  it('the payment section no longer claims to move the retirement planner (47.2, AC-13)', () => {
    const { payment, owed, property } = mortgageSections()

    // Positive anchors first: the section still lists what the payment DOES
    // change, so this cannot pass by the section having gone missing.
    expect(payment).toMatch(/the\s+total\s+on\s+the\s+Expenses\s+page/i)
    expect(payment).toMatch(
      /how\s+much\s+is\s+left\s+over\s+to\s+share\s+out\s+on\s+the\s+\[Savings\]/i
    )

    // The deleted claim, in both the literal and a reworded form.
    expect(payment).not.toMatch(/retirement/i)
    expect(payment).not.toMatch(/gap\s+between\s+your\s+income\s+and\s+your\s+expenses/i)

    // ⚠️ And the DELETION WAS NARROW. FR48 is untouched by story 47.2, so both
    // "stays out of the pot" claims must survive — an over-broad edit that
    // stripped every mention of the planner from this page would pass the
    // negatives above and quietly remove two true statements.
    expect(owed).toMatch(/retirement\s+planner's\s+pot/i)
    expect(property).toMatch(/retirement\s+planner's/i)
  })

  it('the mortgage page says what each figure does NOT affect (43.5, AC-3/AC-5)', () => {
    const page = mortgage()
    const { payment, owed, property } = mortgageSections()
    // The payment is cash flow, never net worth — and scoped to the payment section,
    // so the claim cannot drift onto the debt or the asset.
    expect(payment).toMatch(/does\s+\*\*not\*\*\s+change\s+your\s+net\s+worth,\s+on\s+any\s+page/i)
    // ⚠️ INVERTED by story 43.5, not relaxed. 36.3 needed the qualifier "only in
    // the forward direction" because the projection page WAS a live surface where
    // a payment reached a net-worth number. 43.3 deleted that page, so the
    // unqualified sentence is now the CORRECT one and the qualifier would be a
    // dangling reference. This proves the hedge is gone rather than merely
    // dropping the assertion that used to require it.
    expect(page).not.toMatch(/only\s+in\s+the\s+forward\s+direction/i)
    // ⚠️ `net[-\s]worth`, not `net-worth`: the unhyphenated "net worth
    // projection" is how most writers would type it and the hyphen-only form
    // let the dead surface back in.
    expect(page).not.toMatch(/net[-\s]worth\s+projection/i)
    // The balance owing is net worth, never cash flow.
    expect(owed).toMatch(/does\s+\*\*not\*\*\s+change\s+your\s+cash\s+flow/i)
    // The retirement pot deliberately excludes debts.
    expect(owed).toMatch(/left\s+out\s+of\s+the\s+retirement\s+planner/i)
    // ⚠️ FR70/D6: it excludes ASSETS too, and the recorded rationale is
    // CONSISTENCY (cash in a savings account is already excluded), NOT "a condo
    // is not retirement savings" — that phrasing is true for a condo and unargued
    // for the cash holding FR70 also names. Pin the reason, not just the fact.
    expect(property).toMatch(/stays\s+out\s+of\s+the\s+retirement\s+planner/i)
    expect(property).toMatch(/same\s+reason\s+cash\s+in\s+a\s+savings\s+account\s+does/i)
    // An asset carries no contribution; money toward one goes to the Savings page.
    expect(property).toMatch(/does\s+not\s+ask\s+you\s+to\s+set\s+a\s+contribution/i)
    expect(property).toContain('(/savings)')
  })

  it("each figure's effects are listed under THAT figure (43.5, AC-5)", () => {
    const { payment, owed, property } = mortgageSections()
    // ⚠️ ADDED IN CODE REVIEW, and it closes the hole the section-scoping was
    // introduced to close. The claim pins above scope the "It does **not** ..."
    // paragraphs, but every POSITIVE effect lives in an "It affects:" bullet and
    // NONE of those was scoped. The story's own motivating example — moving "how
    // much is left over to share out on the Savings page" out of the payment
    // section and into the debt section — ran 43/43 GREEN against the first pass.
    // A misattributed effect is the defect this page exists to prevent, so the
    // bullets are pinned to their own section AND denied to the others.
    // ⚠️ Story 47.2 REMOVED a fourth entry here:
    // `/retirement\s+planner,\s+which\s+works\s+out\s+what\s+you\s+save/i`.
    // The bullet it pinned is gone, because a mortgage payment no longer affects
    // the planner by any route once that page reads investment contributions
    // instead of income minus expenses. Its absence is asserted directly by "the
    // payment section no longer claims to move the retirement planner (47.2,
    // AC-13)" above — this list only pins what the payment DOES change.
    const paymentEffects = [
      /the\s+total\s+on\s+the\s+Expenses\s+page/i,
      /Total\s+Expenses\s+figure\s+on\s+the\s+home\s+page/i,
      /left\s+over\s+to\s+share\s+out\s+on\s+the\s+\[Savings\]/i,
    ]
    const owedEffects = [
      /Total\s+Debts\s+and\s+Net\s+Worth\s+on\s+the\s+Balance\s+Tracking\s+page/i,
      /debts\s+bar\s+in\s+the\s+balances\s+chart/i,
    ]
    const propertyEffects = [
      /Other\s+Assets\s+and\s+Net\s+Worth\s+on\s+the\s+Balance\s+Tracking\s+page/i,
      /assets\s+bar\s+in\s+the\s+balances\s+chart/i,
    ]
    for (const effect of paymentEffects) {
      expect(payment).toMatch(effect)
      expect(owed).not.toMatch(effect)
      expect(property).not.toMatch(effect)
    }
    for (const effect of owedEffects) {
      expect(owed).toMatch(effect)
      expect(payment).not.toMatch(effect)
    }
    for (const effect of propertyEffects) {
      expect(property).toMatch(effect)
      expect(payment).not.toMatch(effect)
    }
  })

  it('the mortgage page does not promise the debt shrinks (43.5, AC-4)', () => {
    const { owed, property } = mortgageSections()
    // ⚠️ REPOINTED by story 43.5. 36.3 anchored this on the projection page's
    // behaviour ("holds your debts at their current balance", "does not pay the
    // mortgage down"). That page is gone, but the underlying fact survives it and
    // is the half worth keeping: the FORM asks for six fields and none is a rate,
    // so no figure in Longhand amortises. Anchored on the form, not a surface.
    // ⚠️ Reworded in code review: the old sentence said Longhand "does not ask
    // for your repayment schedule", but a DEBT entry is shown and REQUIRES both
    // `Contribution *` and `Contribution Frequency *` (the form hides those only
    // for assets) — an amount plus a cadence is the shape of a repayment
    // schedule. What is actually true is that no rate is asked for and nothing
    // amortises, so no figure is ever recalculated.
    expect(owed).toMatch(/does\s+not\s+ask\s+for\s+your\s+interest\s+rate/i)
    expect(owed).toMatch(/does\s+not\s+work\s+out\s+how\s+a\s+loan\s+amortises/i)
    expect(owed).not.toMatch(/does\s+not\s+ask\s+for\s+your\s+repayment\s+schedule/i)
    expect(owed).toMatch(/stays\s+exactly\s+where\s+you\s+put\s+it\s+until\s+you\s+change\s+it/i)
    // The same is true in the other direction: an asset does not appreciate on its
    // own either. Omitting this would leave a reader expecting the house to track
    // the market while the loan sat still.
    expect(property).toMatch(/does\s+not\s+track\s+the\s+value\s+for\s+you/i)
    // ⚠️ STRENGTHENED by story 43.5 and REPAIRED in its code review, following
    // this file's own stem-x-object lesson. 36.3's pair banned two literal
    // phrasings and sailed past every other; "Your payment brings down what you
    // owe over time" is equally false and shipped GREEN under them.
    //
    // ⚠️ The first version of this guard had three holes, all found in review:
    //  1. It split on periods only. Bullets and headings end without one, so an
    //     "It affects:" list PLUS the "It does **not** ..." sentence after it was
    //     a single chunk — and one `not` anywhere in that chunk excused a false
    //     progress claim anywhere else in it. Now split on blank lines and line
    //     breaks as well, so a bullet is judged on its own.
    //  2. `pay\w*\s+(down|off)` required the particle adjacent to the verb, so
    //     the most natural order — "pays the mortgage down" — was invisible.
    //  3. `isDenial` tested `\bnot\b`, which does not match inside "cannot" and
    //     never matches "doesn't", so a TRUE denial would have FAILED this test.
    const progressVerb =
      /(reduc|lower|shrink|decreas|diminish|dwindl|erod|whittl|chip)\w*|\bpay\w*\b(?:[^.]{0,40}?)\b(down|off)\b|\bbring\w*\b(?:[^.]{0,40}?)\bdown\b|\bgo(?:es)?\s+down\b|\bfall\w*\b/i
    const debtObject = /(balance|principal|mortgage|loan|what\s+you\s+owe|debt)/i
    // Denials are legitimate — this page says Longhand does NOT do this three
    // times. Cover the contracted and prefixed forms too, or the guard forbids
    // the true sentences it exists to protect.
    const denial =
      /\b(not|never|no|cannot|can't|won't|doesn't|does not|isn't|nothing)\b|\bcannot\b/i
    // One claim per line-or-sentence, so a `not` in a neighbouring sentence
    // cannot vouch for a bullet three lines away.
    const chunks = mortgage()
      .split(/\n\s*\n|\n(?=\s*[-*#])|(?<=\.)\s+/)
      .map((chunk) => chunk.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
    const offenders = chunks.filter(
      (chunk) => progressVerb.test(chunk) && debtObject.test(chunk) && !denial.test(chunk)
    )
    // Name the offending text: "expected true to be false" is undiagnosable.
    expect(offenders).toEqual([])
  })

  it('the mortgage page tells a homeowner how to record the house (43.5, AC-2)', () => {
    const page = mortgage()
    const { property, wrong } = mortgageSections()
    // ⚠️ REPLACED, not deleted. Until story 43.4 the enum was `investment | debt`
    // and 36.3 correctly disclosed the gap: "cannot yet record a house", and "a
    // large negative net worth after adding a mortgage is expected". FR70 shipped
    // the third type, so BOTH sentences became false and the second became
    // actively misleading — it tells a user to accept a figure that is now simply
    // incomplete. These negatives prove the retired claims are gone; the positives
    // below prove the replacement claim is present, so the pin count never drops.
    expect(page).not.toMatch(/cannot\s+yet\s+record\s+a\s+house/i)
    expect(page).not.toMatch(
      /negative\s+net\s+worth\s+after\s+adding\s+a\s+mortgage\s+is\s+expected/i
    )
    expect(page).not.toMatch(/records\s+investments\s+and\s+debts\b/i)
    // The property's value counts on the asset side, on both surfaces that show it.
    // ⚠️ The Balance-page card is "Other Assets" (D10), NOT "Total Assets" — the
    // card deliberately differs from the type name because "Total Assets" beside
    // "Total Investments"/"Total Savings" invites the objection that those ARE
    // assets. A doc that says "Total Assets" names a control that does not exist.
    expect(property).toMatch(
      /Other\s+Assets\s+and\s+Net\s+Worth\s+on\s+the\s+Balance\s+Tracking\s+page/i
    )
    expect(property).toMatch(/assets\s+bar\s+in\s+the\s+balances\s+chart/i)
    // The reframed closing section: the diagnosis a confused homeowner needs.
    expect(wrong).toMatch(/property\s+itself\s+has\s+not\s+been\s+entered\s+yet/i)
    expect(wrong).toMatch(/add\s+it\s+as\s+an\s+\*\*Asset\*\*/i)
  })

  it('the mortgage page description matches the three-part model (43.5, AC-8)', () => {
    // ⚠️ The description is NOT in the .md — it lives in `content/docs/index.ts`
    // and renders as the page subtitle and on the /docs index card. Guarded only
    // by a `length > 0` check until now, so the article could become a three-part
    // model while its own subtitle still promised two, with every gate green.
    const page = DOC_PAGES.find((doc) => doc.slug === 'where-a-mortgage-belongs')
    if (!page) throw new Error('missing expected doc page: where-a-mortgage-belongs')
    // ⚠️ Corrected in code review. The first version read "Why a loan is a
    // recurring payment, a debt and a property all at once" — a loan is NOT a
    // property. The article is careful that the loan is two things and the
    // property is a separate, conditional third entry; the subtitle must not
    // collapse that, and this pin must not enforce the collapsed form.
    expect(page.description).toMatch(
      /both\s+a\s+recurring\s+payment\s+and\s+a\s+debt,\s+where\s+the\s+property\s+itself\s+goes/i
    )
    expect(page.description).not.toMatch(
      /a\s+loan\s+is\s+a\s+recurring\s+payment,\s+a\s+debt\s+and\s+a\s+property/i
    )
  })

  /**
   * Story 49.2 (UX-DR40 / CONTENT-O, both amended by addition): the article
   * gains a concrete three-entry example and the down-payment answer.
   *
   * ⚠️ Section-scoped to `example` on purpose. Every figure below ALREADY
   * appears in `### If your net worth looks wrong` ($400,000 / $300,000 /
   * $100,000, shipped by 43.5), so a page-wide guard on them would have been
   * green before this story wrote a single line. Only the slice proves the
   * worked example exists.
   *
   * ⚠️ CORRECTED in review 49.2: this docblock used to claim the scoping was
   * "M10's target". M10 moved the whole SECTION, heading included, which trips
   * `mortgageSections()`'s ordering invariant — it threw before the scoping was
   * ever exercised, so the arm was red for the wrong reason and proved nothing
   * about these assertions. **M13 is the real arm**: it moves the example's BODY
   * into the closing section and leaves the heading in place, so the invariant
   * stays silent and only the slice can fail. A red arm can be as misleading as
   * a green one when it fires on a different mechanism than the one you meant
   * to test.
   *
   * ⚠️ The figures are pinned as LITERALS, deliberately breaking from
   * `howTotalsSections()`'s worked-example guard, which derives its numbers from
   * `packages/core`. That one pins what the app actually renders for stated
   * inputs, so recomputing is what makes it honest. These are an illustrative
   * scenario that no function produces; deriving 400000 - 300000 through a core
   * call would dress arithmetic up as verification.
   */
  it('the worked example lays out three entries with their pages and fields (49.2, AC-7)', () => {
    const { example } = mortgageSections()

    // Each row names the PAGE, the Type and the figure. The Type names are the
    // literal dropdown labels (`Asset`, `Debt`) — `docs-content` already warns
    // that "Property" and "owned outright" are corpus prose, not labels.
    expect(example).toMatch(
      /Balance\s+Tracking\s+Condo\s+Asset\s+Current\s+Balance\/Value\s+\$400,000/
    )
    expect(example).toMatch(
      /Balance\s+Tracking\s+Condo\s+mortgage\s+Debt\s+Current\s+Balance\/Value\s+\$300,000/
    )
    // ⚠️ The PAYMENT row is the entry the article never put a number on before
    // this story — the other two figures were already in the closing section.
    expect(example).toMatch(/Expenses\s+Condo\s+mortgage\s+—\s+Amount\s+\(Monthly\)\s+\$1,800/)

    // ⚠️ The header row, added in review 49.2. Five whitespace-aligned columns in
    // a <pre> announce as one undifferentiated blob to a screen reader and give a
    // sighted reader nothing to read them against. Naming the columns also caught
    // a real inconsistency: the fourth column had held a FIELD name on two rows
    // and a FREQUENCY ("Monthly") on the third, so the expense row now reads
    // "Amount (Monthly)" and the column is homogeneous.
    expect(example).toMatch(/Page\s+Entry\s+Type\s+Field\s+Value/)

    // ⚠️ `Current Balance/Value`, not `Current Balance`. Story 49.1 renamed the
    // label and updated this doc's two other quotations of it; a new quotation
    // written from memory is exactly how the third one goes stale.
    //
    // ⚠️ Case-INSENSITIVE and token-bounded, both tightened in review 49.2. `/i`
    // catches a lowercase prose quotation ("enter it as the current balance"),
    // which the capitalised form sailed past; `\b` after `value` stops the
    // lookahead being satisfied by any six characters that merely START with
    // `/Value` — "Current Balance/Valued" was a false green. The lookahead is
    // safe across the ~76-column hard wrap: wraps only ever fall at spaces, which
    // `\s+` absorbs, and `Balance/Value` has no space to break at.
    expect(example).not.toMatch(/current\s+balance(?!\/value\b)/i)

    // The two-sided sum, which is the whole reason three entries are correct.
    expect(example).toMatch(/\$400,000\s+owned\s+less\s+\$300,000\s+owed\s+leaves\s+\$100,000/)
    expect(example).toMatch(/cash\s+flow\s+counts\s+only\s+the\s+third/i)
  })

  it('the worked example answers the down payment, and answers it there (49.2, AC-9)', () => {
    const { example } = mortgageSections()
    const page = mortgage()

    // ⚠️ THE distinguishing sentence. Before story 49.2 the phrase "down
    // payment" appeared nowhere in the app or its docs, so a guard on the word
    // "payment" alone would have passed against the pre-49.2 article — the
    // article has an entire section called "What the payment changes".
    expect(example).toMatch(/down\s+payment\s+is\s+not\s+entered\s+anywhere/i)
    expect(example).toMatch(
      /already\s+reflected\s+in\s+the\s+gap\s+between\s+what\s+the\s+property\s+is\s+worth\s+and\s+what\s+is\s+still\s+owed/i
    )

    // ⚠️ The article must not acquire a second, unscoped down-payment claim
    // elsewhere that could contradict this one. One mention, in one place.
    //
    // ⚠️ `[-\s]?`, widened in review 49.2. The original `\s+` matched neither
    // "down-payment" nor "downpayment" — and the comment directly above this one
    // spells it hyphenated, so the guard could not see the very spelling its own
    // prose uses. A contradicting second claim written either way was invisible.
    // The null path fails safe: `toHaveLength` on a null match throws.
    expect(page.match(/down[-\s]?payment/gi)).toHaveLength(1)
  })

  it('the mortgage page uses no markdown table (36.3, AC-8)', () => {
    // Same rationale as the how-totals guard above: `MarkdownRenderer` emits a
    // bare <table> inside `prose` with no overflow-x wrapper, which would fail
    // `e2e/responsive-320.spec.ts`. A payment-vs-principal comparison is the
    // most natural shape for this page, which is exactly why it needs its own
    // guard rather than relying on the one scoped to how-totals.
    const page = mortgage()
    expect(page).not.toMatch(/^\s*\|/m)
    // ⚠️ The pipeless GFM form too — it renders the same bare <table> and the
    // leading-pipe regex never sees it.
    // ⚠️ `-+`, NOT `-{3,}`. GFM accepts ONE dash per delimiter cell, so `-|-`
    // and `:-:|:-:` are valid tables that a three-dash regex sails past. The
    // how-totals guard above still has the narrower form; widening it is not
    // this story's change to make, but the new page gets the correct one.
    expect(page).not.toMatch(/^\s*:?-+:?\s*\|/m)
  })

  it('both doc surfaces still link to the mortgage page (36.3, AC-8)', () => {
    // The internal-link guard above proves a link RESOLVES; only this proves
    // the links EXIST — deleting both would leave that guard perfectly green.
    //
    // ⚠️ Renamed by story 49.2, which added a THIRD link from the Balance
    // Tracking form (`BalancePage.tsx`, both loan-shaped arms). This guard was
    // called "two existing surfaces" and only ever asserted these two DOC
    // surfaces; the count in its name is now wrong for the page as a whole
    // while its assertions are unchanged and still correct. The component link
    // is pinned in `BalancePage.test.tsx`, not here — this file reads the
    // markdown corpus and cannot see a `.tsx` anchor.
    const link = '(/docs/where-a-mortgage-belongs)'
    expect(contentFor('getting-started')).toContain(link)
    expect(contentFor('features')).toContain(link)
  })
})
