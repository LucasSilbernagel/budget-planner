/**
 * The `/forecasting` page intro (story 57.1, FR86, AC-3; copy amended by `forecast-1`).
 *
 * ⚠️ The intro named "a one-off windfall" until story `forecast-1` made outflows
 * enterable; it now names "a big one-off cost", the situation 57.1 originally wanted
 * and had to retract in review because the tool could not model it.
 *
 * ⚠️ THIS IS THE FIRST TEST THAT RENDERS `ForecastingPage` AT ALL. Before story
 * 57.1 the route had no unit coverage.
 *
 * ⚠️ CORRECTED 2026-09-21 (`forecast-3` review): this header used to say the
 * entitled surface is "unreachable in Playwright". That was true when written and
 * is now STALE — story 58.2 shipped a dev-only session seed (`E2E_SESSION_SEED`)
 * and `nav-tier-aware.paid.spec.ts` / `tier-aware-surfaces.paid.spec.ts` do render
 * a paid session. What remains true is narrower and is the reason this file still
 * matters: those specs assert NAV anchors only and never navigate into the page,
 * so nothing in e2e asserts this route's header or intro. If you add paid-session
 * page coverage, revisit this comment rather than inheriting it.
 *
 * The component is reached through `Route.options.component` rather than a
 * separate export, so these assertions cover it exactly as the router invokes it
 * — the pattern `retirement-route-gate.test.tsx` established.
 *
 * ⚠️ The page returns the `PremiumPrompt` branch unless `usePremiumAccess` reports
 * access, so the intro is NOT in the DOM for a free user. That is intended (the
 * free user's pitch is the Overview box's subtitle, which story 57.1 rewrote in
 * the same pass) — the `hasAccess: false` case below pins it rather than leaving
 * it to be rediscovered as a bug.
 */

import { renderWithRouter, screen } from '@/test/utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'
import { Route } from '../forecasting'

const usePremiumAccess = vi.fn()

vi.mock('../../hooks/usePremiumAccess', () => ({
  usePremiumAccess: () => usePremiumAccess(),
}))

// The page resolves a default profile and its saved forecasts in a mount effect
// via dynamic import. These stubs keep the test off the real server functions.
//
// ⚠️ They are NOT guards: the component wraps both imports in a try/catch that only
// `console.error`s (`forecasting.tsx:191-227`), and this suite does not fail on
// console errors — MEASURED by deleting both `vi.mock` blocks, after which all four
// tests still pass. Nothing here asserts they were called. Keep them for isolation,
// but do not read a green run as evidence that the data path works.
vi.mock('../../server/functions/profiles', () => ({
  getProfiles: vi.fn(async () => ({ success: true, data: [] })),
}))

vi.mock('../../server/functions/forecastingProfiles', () => ({
  getForecastingProfiles: vi.fn(async () => ({ success: true, data: [] })),
  createForecastingProfile: vi.fn(async () => ({ success: true, data: null })),
  deleteForecastingProfile: vi.fn(async () => ({ success: true, data: null })),
}))

const ForecastingPage = Route.options.component as () => React.ReactElement

/**
 * The intro's first sentence, pinned so situation-based wording cannot silently revert.
 *
 * ⚠️ Matched as a STRING, never `new RegExp(INTRO)`. The copy ends in `?`, which as a
 * regex is a quantifier making the preceding `t` optional — the earlier form of this
 * test matched "…a big one-off cos" and never asserted the question mark at all.
 */
const INTRO_SENTENCE =
  'Wondering how a raise, steadily rising bills or a big one-off cost would change things?'

/** The second sentence, pinned separately so it cannot be dropped unnoticed. */
const INTRO_SECOND_SENTENCE =
  'Build it out here and see how your finances track over the years ahead.'

/**
 * The free user's pitch and the `<meta>` description, pinned WHOLE so a near-miss
 * (a dropped clause, a reverted half) fails rather than slipping through a
 * substring check — the failure mode this suite exists to catch.
 *
 * Both are matched with exact comparison (`findByText` with a string, `toBe`), so
 * unlike `INTRO_SENTENCE` there is no regex-metacharacter hazard here; the reason
 * to pin them as constants is single-source, not escaping.
 */
const PROMPT_MESSAGE =
  'See how a raise, rising bills or a big one-off cost would change your finances over the years ahead — and save each scenario to reopen later.'

const META_DESCRIPTION =
  'Model how a raise, rising bills or a one-off cost changes your finances over the years ahead — with saved, reloadable scenarios.'

interface MetaEntry {
  title?: string
  name?: string
  property?: string
  content?: string
}

function mockStatus(overrides: Partial<PremiumAccessStatus>): void {
  const status: PremiumAccessStatus = {
    hasAccess: false,
    subscriptionStatus: null,
    isLoading: false,
    error: null,
    isAuthenticated: false,
    ...overrides,
  }
  usePremiumAccess.mockReturnValue({ status })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('the /forecasting page intro (57.1, AC-3)', () => {
  it('names situations the engine can actually model, in both sentences', async () => {
    mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
    renderWithRouter(<ForecastingPage />)

    const intro = await screen.findByTestId('forecasting-intro')
    // Normalize JSX's source-wrapping whitespace before comparing prose.
    const text = (intro.textContent ?? '').replace(/\s+/g, ' ').trim()

    expect(text).toContain(INTRO_SENTENCE)
    expect(text).toContain(INTRO_SECOND_SENTENCE)
  })

  it('places the intro inside <main>, ahead of the tab strip and not within it', async () => {
    mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
    renderWithRouter(<ForecastingPage />)

    const intro = await screen.findByTestId('forecasting-intro')

    // AC-3 says "inside <main>" — assert it, rather than leaving it to be inferred
    // from the ordering check below. Relocating the intro into the sticky PageHeader
    // would satisfy every ordering assertion while violating the AC.
    expect(intro.closest('main')).not.toBeNull()

    // The tab strip is located through a tab BUTTON rather than a class string, so
    // restyling it cannot quietly retarget this assertion.
    // ⚠️ NAMING: `closest('div')` resolves to the button's nearest ancestor div —
    // the inner pill strip, NOT the outer `mb-8` tab section. So this proves
    // "precedes and is not inside the tab STRIP". Moving the intro inside `mb-8`
    // but before <TabNavigation> keeps this green, and that is correct: it still
    // renders above the tab bar, which is what the AC requires.
    const tabStrip = screen.getByRole('button', { name: /scenario builder/i }).closest('div')
    expect(tabStrip).not.toBeNull()

    const position = intro.compareDocumentPosition(tabStrip as Node)

    // ⚠️ DOCUMENT_POSITION_FOLLOWING is ALSO set when the other node is a
    // DESCENDANT (story 56.4's review found exactly this hole: `FOLLOWING`
    // alone passes for a control nested inside the very section it must
    // precede). Assert BOTH: the strip follows the intro, AND neither
    // contains the other.
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(position & Node.DOCUMENT_POSITION_CONTAINED_BY).toBeFalsy()
    expect(intro.contains(tabStrip as Node)).toBe(false)
    expect((tabStrip as HTMLElement).contains(intro)).toBe(false)
  })

  it('reads standalone for a nav arrival: it does not depend on the Overview copy', async () => {
    mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
    renderWithRouter(<ForecastingPage />)

    const intro = await screen.findByTestId('forecasting-intro')
    const text = intro.textContent ?? ''

    // Epic 58 adds a nav entry straight to this page FOR PAID SESSIONS, so the intro
    // has to stand on its own. Positive control first: the element really has prose
    // in it, so the assertions below cannot pass vacuously.
    expect(text.length).toBeGreaterThan(40)
    expect(text).toMatch(/one-off cost/i)

    // Two distinct properties, asserted separately.
    // (a) No reference to copy that lives on another page.
    expect(text).not.toMatch(
      /\b(overview|dashboard|home page|the card|that card|the tile|the box|benefit box|as shown|earlier)\b/i
    )
    // (b) No POSITIONAL wording. The intro renders above every tab, but the builder
    // is only on the first one, so "below"/"above" is false on two tabs out of three.
    // ⚠️ "below" was missing from the earlier version of this list while the shipped
    // copy said "Build the scenario below" — a forbidden-word list that happens to
    // exclude the word the copy uses asserts nothing.
    expect(text).not.toMatch(/\b(below|above|beneath|on the right|on the left)\b/i)
  })

  it('does not render the intro for a free user (the gate returns the upgrade prompt)', async () => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })
    renderWithRouter(<ForecastingPage />)

    // ⚠️ POSITIVE CONTROL FIRST, and it must be AWAITED. `renderWithRouter`
    // mounts asynchronously, so a synchronous `queryByTestId` runs against an
    // empty `<body><div /></body>` and returns null for EVERY input — the
    // absence assertion below would pass no matter what the gate did. Waiting
    // for the upgrade prompt is what makes the absence mean something.
    // `findAllBy*`, not `findBy*`: a singular query THROWS on multiple matches,
    // which would fail this test for a reason that has nothing to do with the
    // intro. ⚠️ MEASURED on the real free branch (`forecast-3` review): the regex
    // matches TWO elements — the `featureName` span (`premium-prompt.tsx`, the
    // `"{featureName}"` node) and the benefit `<li>` rendered from
    // `PREMIUM_FEATURES.forecasting`, because RTL matches an element on its own
    // direct text nodes. Two independent sources, so this control survives either
    // one being reworded — but NOT both.
    // ⚠️ A previous version of this comment claimed the phrase used to appear in
    // the prompt's `message` and that the count was now 1. Both were false: the
    // old message read "Access advanced FINANCIAL forecasting", which this regex
    // never matched. Corrected rather than deleted, because the error is the
    // instructive part — it was written while rewriting a comment for accuracy.
    // The control DISCRIMINATES: the entitled branch renders no "advanced
    // forecasting" text at all, so this can only match the prompt.
    expect(await screen.findAllByText(/advanced forecasting/i)).not.toHaveLength(0)
    expect(screen.queryByTestId('forecasting-intro')).toBeNull()
  })
})

/**
 * Story 57.1 left three mechanism-describing strings on this route outside its own
 * ACs, all still reading "advanced tools for modeling your financial future" while
 * the intro had moved on to naming situations. Closed 2026-09-21 (follow-up #3).
 *
 * ⚠️ WHY THESE ARE PINNED AT ALL: before this pass NOTHING asserted any of the three
 * — MEASURED by grepping the repo for each literal, which found only the source
 * lines themselves. `route-head-coverage.test.ts` requires every route description
 * to be truthy, to differ from the root default, and to be the only one on its
 * route — but says nothing about what it CLAIMS. (Cross-route UNIQUENESS is
 * asserted for titles only, not descriptions; an earlier version of this comment
 * had that wrong.) So a revert to the vague copy would have shipped green.
 */
describe('the /forecasting mechanism copy (57.1 follow-up #3)', () => {
  /** The exact subtitle deleted from the sticky `PageHeader`. */
  const DELETED_SUBTITLE = 'Advanced tools for modeling your financial future'

  it('renders no subtitle under the page heading, so the page opens with one tagline', async () => {
    mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
    renderWithRouter(<ForecastingPage />)

    // POSITIVE CONTROL FIRST, and awaited: `renderWithRouter` mounts async, so a
    // synchronous absence check runs against an empty body and passes for EVERY
    // input. Finding the heading proves the header actually rendered, which is
    // what makes the two absence assertions below mean something.
    const heading = await screen.findByRole('heading', { name: 'Financial Forecasting' })
    const header = heading.closest('header')
    expect(header).not.toBeNull()

    // (a) STRUCTURAL, and ELEMENT-AGNOSTIC: the `<h1>`'s own wrapper holds the
    // heading and nothing else. ⚠️ This replaces a `querySelectorAll('p')` count,
    // which was only `<p>`-shaped — a subtitle reinstated as a `<span>` or `<div>`
    // passed it, while the comment claimed it caught "whatever its wording"
    // (`forecast-3` review). Asserting the child COUNT catches any element.
    const headingWrapper = heading.parentElement as HTMLElement
    expect(headingWrapper.children).toHaveLength(1)
    expect(headingWrapper.children[0]).toBe(heading)

    // (b) LITERAL: the specific deleted string is gone from the whole document.
    // Document-wide rather than header-scoped because the point of the decision
    // was to retire this sentence, not to relocate it.
    // ⚠️ Exact-string, so a REWORDED subtitle ("Model your financial future")
    // is caught by (a) alone — which is why (a) had to stop being `<p>`-shaped.
    expect(screen.queryByText(DELETED_SUBTITLE)).toBeNull()

    // The intro is still there doing the explaining — the half of the decision
    // that a subtitle-absence assertion alone would not capture.
    expect(await screen.findByTestId('forecasting-intro')).toBeInTheDocument()
  })

  it("pitches concrete situations to a free user, not 'advanced' tooling", async () => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })
    renderWithRouter(<ForecastingPage />)

    const message = await screen.findByText(PROMPT_MESSAGE)
    expect(message).toBeInTheDocument()

    // The vague predecessor must not come back alongside it.
    expect(screen.queryByText(/access advanced financial forecasting/i)).toBeNull()
  })

  it('describes the same situations in the meta description', () => {
    const meta = (Route.options.head as (arg: unknown) => { meta?: MetaEntry[] })({})?.meta ?? []
    const description = meta.find((m) => m.name === 'description')?.content

    // Positive control: there IS a description. `toContain` on `undefined` throws
    // rather than passing, but an explicit control names the failure properly.
    expect(description).toBeTruthy()
    expect(description).toBe(META_DESCRIPTION)
    expect(description).not.toContain(DELETED_SUBTITLE)
  })

  /**
   * The three surfaces must stay in step — that is the whole point of the
   * follow-up. Asserted as a SHARED VOCABULARY rather than three copies of one
   * sentence, so the copy can be tuned per audience without going vague again.
   *
   * ⚠️ Each situation named must be expressible by what `calculateFinancialForecast`
   * READS (the two growth rates and the signed `oneTimeEvents`). ⚠️ THAT RULE IS
   * NOT ENFORCED HERE — this test denies exactly two phrases, `mortgage` and
   * `early retirement`. "A new car loan from 2030", "inflation" or "retiring at 55"
   * all pass it. Treat the denials as regression pins for two known overpromises,
   * not as a check that new copy is honest; that judgement stays with the author.
   *
   * ⚠️ EVERY SURFACE IS READ FROM ITS REAL SOURCE — intro and prompt from the
   * rendered DOM, description from `Route.options.head()`. Two earlier drafts got
   * this wrong and both were caught by mutation, not by a green run:
   *   1. the "premium prompt" row was the test-local `PROMPT_MESSAGE` CONSTANT —
   *      a copy asserted against itself, green when the source was mutated;
   *   2. replacing it with `document.body.textContent` over-corrected — that
   *      sweeps in the prompt's benefit list and static chrome, so the positive
   *      checks were satisfiable by copy this test is not meant to be reading,
   *      and the `length > 40` control could never fail.
   * It now reads the message's OWN element via `premium-prompt-message`.
   */
  it('names the same modellable situations on all three surfaces', async () => {
    mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
    const entitled = renderWithRouter(<ForecastingPage />)
    const intro = (await screen.findByTestId('forecasting-intro')).textContent ?? ''
    entitled.unmount()

    // The free branch, for the prompt's ACTUAL rendered message — scoped to the
    // message element, NOT the whole card and NOT the body.
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })
    renderWithRouter(<ForecastingPage />)
    const prompt = (await screen.findByTestId('premium-prompt-message')).textContent ?? ''

    const meta = (Route.options.head as (arg: unknown) => { meta?: MetaEntry[] })({})?.meta ?? []
    const description = meta.find((m) => m.name === 'description')?.content ?? ''

    for (const [surface, text] of [
      ['intro', intro],
      ['meta description', description],
      ['premium prompt', prompt],
    ] as const) {
      // A real control now that every row is scoped to one element: an empty or
      // missing surface fails here instead of being carried by page chrome.
      expect(
        text.length,
        `${surface} is empty — the checks below would be vacuous`
      ).toBeGreaterThan(40)
      // ⚠️ `\b` anchored: a bare /raise/i also matches "praise" and "raised".
      expect(text, `${surface} does not name a raise`).toMatch(/\braise\b/i)
      expect(text, `${surface} does not name rising bills`).toMatch(/rising bills/i)
      expect(text, `${surface} does not name a one-off cost`).toMatch(/one-off cost/i)

      // The situations the engine CANNOT model, kept off every surface. This is
      // the assertion 57.1's review had to add copy-side after shipping an
      // overpromise; it now covers all three strings, not just the intro.
      expect(
        text,
        `${surface} promises a mortgage, which needs a dated recurring change`
      ).not.toMatch(/\bmortgage\b/i)
      expect(
        text,
        `${surface} promises early retirement, which the engine cannot express`
      ).not.toMatch(/early retirement/i)
    }
  })
})
