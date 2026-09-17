/**
 * The `/forecasting` page intro (story 57.1, FR86, AC-3).
 *
 * ⚠️ THIS IS THE FIRST TEST THAT RENDERS `ForecastingPage` AT ALL. Before story
 * 57.1 the route had no unit coverage, and its entitled surface is unreachable in
 * Playwright — `/forecasting` is Premium and every e2e suite runs unauthenticated
 * (`report-print.spec.ts:12-27` states the same constraint for `/report`). The five
 * e2e specs that mention forecasting only ever exercise the LOCKED surface, so this
 * file is the only place the intro can be asserted at all.
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
  'Wondering how a raise, steadily rising bills or a one-off windfall would change things?'

/** The second sentence, pinned separately so it cannot be dropped unnoticed. */
const INTRO_SECOND_SENTENCE =
  'Build it out here and see how your finances track over the years ahead.'

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
    expect(text).toMatch(/windfall/i)

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
    // `findAllBy*`, not `findBy*`: the upgrade prompt names the feature in more
    // than one place, and a singular query THROWS on multiple matches — which
    // would fail this test for a reason that has nothing to do with the intro.
    // The control DISCRIMINATES: the entitled branch renders no "advanced
    // forecasting" text at all, so this can only match the prompt.
    expect(await screen.findAllByText(/advanced forecasting/i)).not.toHaveLength(0)
    expect(screen.queryByTestId('forecasting-intro')).toBeNull()
  })
})
