import { describe, expect, it } from 'vitest'
import { DOC_PAGES, getDocPage } from '../index'

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

  // The Features page splits into a Free section and a Premium section; the two
  // guards below assert *which* section a claim lives in, not just that a
  // substring appears somewhere on the page.
  const featureSections = () => {
    const content = getDocPage('features')?.content ?? ''
    const premiumIndex = content.indexOf('### Premium tier')
    if (premiumIndex === -1) throw new Error('Features page is missing the Premium tier section')
    return {
      free: content.slice(0, premiumIndex).toLowerCase(),
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
    // Story 25-3 moved dark mode to Free: it must appear in the Free section and
    // NOT be advertised under Premium.
    const { free, premium } = featureSections()
    expect(free).toContain('dark mode')
    expect(premium).not.toContain('dark mode')
  })

  it('the Features page keeps Retirement modeling under the Free tier (story 13-1, AC-4)', () => {
    // AC-4 do-not-regress guard: retirement stays Free (decided 2026-07-06) — it
    // must appear in the Free section and NOT be advertised under Premium.
    const { free, premium } = featureSections()
    expect(free).toContain('retirement modeling')
    expect(premium).not.toContain('retirement modeling')
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

  it('contrasts the free projection charts with Premium forecasting (story 30-2, AC-3)', () => {
    // FR52 requires Advanced forecasting to read as distinct from the FREE
    // net-worth and retirement projections. The contrast is written into the
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
    expect(free).toMatch(
      /free\s+net-worth\s+and\s+retirement\s+projections\s+chart\s+where\s+your\s+current\s+numbers\s+lead/
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

  it('every internal doc link targets a real app route', () => {
    // The routes referenced by the docs; each exists under apps/web/src/routes.
    const knownRoutes = new Set([
      '/docs/getting-started',
      '/docs/features',
      '/docs/faq',
      '/privacy',
      '/settings',
      '/contact',
      '/net-worth-projection',
      '/retirement',
    ])
    const internalLink = /\]\((\/[^)]*)\)/g
    for (const page of DOC_PAGES) {
      for (const match of page.content.matchAll(internalLink)) {
        expect(knownRoutes.has(match[1])).toBe(true)
      }
    }
  })
})
