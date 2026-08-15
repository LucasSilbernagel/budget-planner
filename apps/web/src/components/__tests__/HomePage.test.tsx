/**
 * HomePage premium-discovery tests (story 7-2, FR24).
 *
 * FR24 requires premium features be discoverable-but-locked, not hidden. Before
 * this story `/forecasting` was linked from nowhere. These tests assert the
 * homepage now surfaces Advanced Forecasting:
 *   - free user → a locked control with a "Premium" badge (no working link).
 *   - paid user → a working link to /forecasting with no badge.
 *
 * `usePremiumAccess` is mocked to drive the tier. We assert the HYDRATED client
 * DOM (the resolved tier), not the SSR/loading skeleton — the unlock transition
 * is exactly what SSR-only smoke misses (project memory, 4-11).
 */

import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'
import {
  useBalanceStore,
  useExpenseStore,
  useIncomeStore,
  useOverviewDurationStore,
  useSavingsStore,
} from '../../stores'

const usePremiumAccess = vi.fn()

vi.mock('../../hooks/usePremiumAccess', () => ({
  usePremiumAccess: () => usePremiumAccess(),
}))

import { HomePage } from '../HomePage'

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

describe('HomePage premium discovery', () => {
  it('AC-1: shows Advanced Forecasting locked with a Premium badge for a free user', () => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })
    render(<HomePage />)

    // Scope the badge to the forecasting control: the Premium Features section
    // now also carries a locked Custom Profiles entry (story 13-3), so there is
    // more than one "Premium" badge on the page for a free user.
    const forecasting = screen.getByRole('button', {
      name: /advanced forecasting — premium, locked/i,
    })
    expect(within(forecasting).getByText('Premium')).toBeInTheDocument()
    // Not a usable link for free users.
    expect(screen.queryByRole('link', { name: /advanced forecasting/i })).not.toBeInTheDocument()
  })

  it('AC-3: shows a working /forecasting link with no badge for a paid user', () => {
    mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
    render(<HomePage />)

    const link = screen.getByRole('link', { name: /advanced forecasting/i })
    expect(link).toHaveAttribute('href', '/forecasting')
    expect(screen.queryByText('Premium')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /premium, locked/i })).not.toBeInTheDocument()
  })

  it('30-2: pins the Advanced Forecasting subtitle to the honest capability copy', () => {
    // The tile subtitle (shared by locked + unlocked states) must describe only
    // what ships. Story 20-1 wrote this pin when saved forecasts could NOT be
    // reloaded and the Projections chart showed canned sample data, so it
    // deliberately withheld the reload claim. Story bug-3 shipped both — reload
    // is wired end-to-end (`routes/forecasting.tsx:381,395`) and the chart takes
    // the user's own result (`:387`) — so story 30-2 adds "reloadable", which the
    // in-app copy at `routes/forecasting.tsx:5,:351` had already been stating.
    // Pin the exact string so future overpromising drift breaks this test.
    mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
    render(<HomePage />)

    expect(
      screen.getByText('What-if scenario modeling with saved, searchable, reloadable forecasts')
    ).toBeInTheDocument()
  })

  it('AC-1: shows Custom Profiles locked with a Premium badge for a free user (13-3)', () => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })
    render(<HomePage />)

    const profiles = screen.getByRole('button', { name: /custom profiles — premium, locked/i })
    expect(within(profiles).getByText('Premium')).toBeInTheDocument()
    // Not a usable link for free users.
    expect(screen.queryByRole('link', { name: /custom profiles/i })).not.toBeInTheDocument()
  })

  it('AC-3: shows a working /profiles link with no badge for a paid user (13-3)', () => {
    mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
    render(<HomePage />)

    const link = screen.getByRole('link', { name: /custom profiles/i })
    expect(link).toHaveAttribute('href', '/profiles')
    expect(
      screen.queryByRole('button', { name: /custom profiles — premium, locked/i })
    ).not.toBeInTheDocument()
  })

  it('20-2: lists Multi-device sync as an account-wide benefit — not a link or a locked page', () => {
    // Story 20-2 (CONTENT-G): the Premium section must present the full canonical
    // benefit set. Multi-device sync is an account-wide benefit, NOT a route — so
    // it is LISTED (static copy), never a PremiumFeatureGate. It must not be a
    // link, not a "premium, locked" button, and must not add a third "Premium"
    // lock badge (only Forecasting + Custom Profiles are gated tiles).
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })
    render(<HomePage />)

    // The benefit is surfaced as text.
    expect(screen.getByText('Multi-device sync')).toBeInTheDocument()
    // …but never as an openable page or a lock affordance.
    expect(screen.queryByRole('link', { name: /multi-device sync/i })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /multi-device sync — premium, locked/i })
    ).not.toBeInTheDocument()
    // Exactly the two gated tiles carry a lock badge — sync adds none.
    expect(screen.getAllByText('Premium')).toHaveLength(2)
  })

  it('30-1: all three premium benefit boxes share one chassis (AC-1/AC-3)', () => {
    // FR51: the section must read as ONE set. Every benefit box — the listed sync
    // benefit and the two gated tiles — carries an identical base class string.
    // Asserted by class-TOKEN membership (never substring), so `sm:p-6` can never
    // be mistaken for `p-6` (batch-4 lesson, mirrored from the 19-4 test below).
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })
    render(<HomePage />)

    const sync = screen.getByTestId('premium-benefit-sync')
    // Two locked tiles render for a free user, so getBy* would throw here.
    const tiles = screen.getAllByTestId('premium-gate-locked')
    expect(tiles).toHaveLength(2)

    const CHASSIS = [
      'flex',
      'w-full',
      'items-center',
      'justify-between',
      'gap-3',
      'rounded-md',
      'border',
      'border-default',
      'px-4',
      'py-3',
    ]

    for (const box of [sync, ...tiles]) {
      const tokens = box.className.split(/\s+/)
      for (const token of CHASSIS) {
        expect(tokens, `${box.dataset.testid ?? 'tile'} is missing "${token}"`).toContain(token)
      }
      // AC-3: no hand-rolled colour + dark: pair survives on any box. Compared
      // as EXACT tokens — `t.includes('blue-50')` would also match the legitimate
      // `focus-visible:ring-blue-500`, which is the very substring trap this
      // file's other class assertions exist to avoid.
      expect(tokens.filter((t) => t.startsWith('dark:'))).toEqual([])
      const RETIRED = ['bg-blue-50', 'border-blue-200', 'hover:bg-blue-100']
      expect(tokens.filter((t) => RETIRED.includes(t))).toEqual([])
    }

    // AC-4: only the two route-backed tiles carry the interactive extras.
    for (const tile of tiles) {
      const tokens = tile.className.split(/\s+/)
      expect(tokens).toContain('surface-interactive')
      expect(tokens).toContain('focus-visible:ring-2')
      expect(tokens).toContain('focus-visible:ring-blue-500')
      // Both directions of the collision rule. Asserting only the sync side
      // leaves the likelier mistake — editing PREMIUM_BOX_INTERACTIVE — green.
      expect(tokens).not.toContain('surface-inset')
    }
    const syncTokens = sync.className.split(/\s+/)
    expect(syncTokens).toContain('surface-inset')
    // Never both background tokens on one element — they collide by source order.
    expect(syncTokens).not.toContain('surface-interactive')
    expect(syncTokens).not.toContain('transition-colors')
  })

  it('30-1: the unlocked (paid) tiles carry the chassis and the accent (AC-1/AC-4)', () => {
    // The paid path renders a different element (`<a>`, not the gate's button),
    // so nothing in the free-tier test above touches it. Without this, dropping
    // PREMIUM_BOX_INTERACTIVE or `text-accent` from both links leaves the whole
    // suite green — verified by mutation during review.
    mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
    render(<HomePage />)

    const links = [
      screen.getByRole('link', { name: /advanced forecasting/i }),
      screen.getByRole('link', { name: /custom profiles/i }),
    ]

    for (const link of links) {
      const tokens = link.className.split(/\s+/)
      for (const token of ['flex', 'w-full', 'rounded-md', 'border', 'border-default', 'px-4']) {
        expect(tokens).toContain(token)
      }
      expect(tokens).toContain('surface-interactive')
      expect(tokens).toContain('focus-visible:ring-blue-500')
      expect(tokens.filter((t) => t.startsWith('dark:'))).toEqual([])

      // "Open →" is the paid tier's clickability signal — it must stay accented.
      const open = within(link).getByText('Open →')
      expect(open.className.split(/\s+/)).toContain('text-accent')
    }
  })

  it('30-1: locked tiles carry a persistent chevron; the sync benefit does not (AC-4)', () => {
    // Hover does not exist on touch and the locked state has no "Open →", so
    // the chevron is the only cue a free visitor on a phone gets that these two
    // boxes do something and the sync box does not.
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })
    render(<HomePage />)

    const tiles = screen.getAllByTestId('premium-gate-locked')
    expect(tiles).toHaveLength(2)
    for (const tile of tiles) {
      const chevron = within(tile).getByText('›')
      expect(chevron.className.split(/\s+/)).toContain('text-accent')
      // Decorative: the button already announces "<feature> — premium, locked".
      expect(chevron).toHaveAttribute('aria-hidden', 'true')
    }

    expect(within(screen.getByTestId('premium-benefit-sync')).queryByText('›')).toBeNull()
  })

  it('20-2: explains Custom Profiles with a concrete example (CONTENT-H)', () => {
    // The Custom Profiles subtitle (shared by locked + unlocked states) must name
    // a concrete use case so a user grasps what a profile is for, kept consistent
    // with the Features/Pricing wording ("personal vs. household"). Pin the exact
    // string so vague drift breaks this test.
    mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
    render(<HomePage />)

    expect(
      screen.getByText(
        'Keep separate finances — e.g. personal vs. household — and switch without mixing the numbers'
      )
    ).toBeInTheDocument()
  })
})

/**
 * Privacy-first tagline (story 27-4, FR44 — amends story 25-4 / CONTENT-F).
 *
 * The overview header leads with the tagline "The budget app that minds its own
 * business." as the single subtitle beneath the app-name heading. This
 * supersedes the old "The budget planner that never sees your money" tagline and
 * the 19-4 "bird's-eye" secondary subtitle (both removed). Tier-independent, so a
 * single free-user render is sufficient.
 */
describe('HomePage tagline (story 27-4)', () => {
  beforeEach(() => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: false })
  })

  it('surfaces the privacy-first tagline while keeping the app name', () => {
    render(<HomePage />)
    expect(screen.getByText('The budget app that minds its own business.')).toBeInTheDocument()
    // The app name still appears as the header heading.
    expect(screen.getByRole('heading', { name: 'Longhand Budget', level: 1 })).toBeInTheDocument()
    // Guard: the retired SoluBudget wordmark must not return (story brand-1).
    expect(screen.queryByText(/solubudget/i)).toBeNull()
    // Guard: the superseded tagline must not return (batch-5 regression lesson).
    expect(screen.queryByText('The budget planner that never sees your money')).toBeNull()
  })
})

/**
 * Overview subtitle + mobile section padding (story 19-4, CONTENT-F / UX-DR32).
 *
 * Story 27-4 superseded the two-line header: the "bird's-eye" secondary subtitle
 * that 19-4 added is REMOVED, leaving the single 27-4 tagline as the only
 * subtitle. The mobile-padding coverage from 19-4 is independent of the header
 * copy and remains in force — the empty-state onboarding and Premium Features
 * sections stay tightened with responsive utilities (p-4 sm:p-6 / p-6 sm:p-8) so
 * the ≥640px desktop spacing is unchanged.
 *
 * Padding is asserted by class-token membership (not substring regex) so a
 * Tailwind class like `sm:p-6` cannot be mistaken for `p-6` (project memory,
 * batch-4 lesson).
 */
describe('HomePage overview subtitle + mobile padding (story 19-4)', () => {
  beforeEach(() => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: false })
  })

  it("no longer renders the bird's-eye secondary subtitle (removed by story 27-4)", () => {
    render(<HomePage />)
    // The 27-4 tagline is the single subtitle; the 19-4 supporting line is gone.
    expect(screen.getByText('The budget app that minds its own business.')).toBeInTheDocument()
    expect(
      screen.queryByText("Get a bird's-eye view of your income, expenses, savings, and more!")
    ).toBeNull()
  })

  it('AC-2: Premium Features section is mobile-tight (p-4) and restores padding at sm (sm:p-6)', () => {
    render(<HomePage />)
    const section = screen
      .getByRole('heading', { name: 'Premium Features', level: 2 })
      .closest('section')
    expect(section).not.toBeNull()
    const tokens = (section as HTMLElement).className.split(/\s+/)
    expect(tokens).toContain('p-4')
    expect(tokens).toContain('sm:p-6')
  })

  it('AC-2: empty-state onboarding section is mobile-tight (p-4) and restores padding at sm (sm:p-6)', () => {
    // The onboarding section renders only when there is NO financial data at all —
    // since the ux-2 review fix, `hasData` counts savings/balances too, so all
    // four stores must be empty for this state.
    useIncomeStore.setState({ incomeSources: [] })
    useExpenseStore.setState({ expenses: [] })
    useSavingsStore.setState({ savingsGoals: [] })
    useBalanceStore.setState({ entries: [] })
    render(<HomePage />)
    const section = screen.getByText("Let's set up your budget").closest('section')
    expect(section).not.toBeNull()
    const tokens = (section as HTMLElement).className.split(/\s+/)
    expect(tokens).toContain('p-4')
    expect(tokens).toContain('sm:p-6')
  })
})

/**
 * Privacy positioning strip (story 27-5, FR45).
 *
 * Beneath the 27-4 tagline the header carries a compact strip that states the
 * three privacy pillars — usable with no account, an optional EU-hosted sync,
 * and no bank connection — under the "intentional budgeting without the bank
 * sync" framing. Every claim is true: the Free tier is client-only (no account,
 * data stays in the browser), EU-hosting is scoped to the OPTIONAL Premium sync
 * (so the copy never implies free-tier data touches a server), and there is no
 * bank/transaction-import integration. Tier-independent, so a single free-user
 * render suffices.
 *
 * The load-bearing assertion anchors on the distinguishing framing sentence:
 * generic words like "account"/"bank"/"EU" appear elsewhere on the page and in
 * the docs, so asserting them alone would pass by construction (batch-5/23
 * lesson). This strip is ADDITIVE — it must not disturb the 27-4 tagline or the
 * 19-4 mobile-padding coverage above.
 */
describe('HomePage privacy positioning (story 27-5)', () => {
  beforeEach(() => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: false })
  })

  it('surfaces the "without bank sync or AI integrations" framing (FR45 as amended by brand-1)', () => {
    render(<HomePage />)
    expect(
      screen.getByText('Intentional budgeting without bank sync or AI integrations.')
    ).toBeInTheDocument()
    // Guard: the pre-amendment wording must not return. Note it is NOT a prefix
    // of the new copy ("the bank sync" vs "bank sync"), so this genuinely bites.
    expect(screen.queryByText('Intentional budgeting without the bank sync.')).toBeNull()
  })

  /**
   * brand-1 AC-6: the no-AI claim lands on the FRAMING line only.
   *
   * The positioning block holds two lines; stating "no AI" on both would repeat
   * the claim inside a two-line block. This pins the split so a later edit
   * cannot quietly duplicate it onto the three-pillar line.
   */
  it('states the no-AI claim once, on the framing line and not the pillars line', () => {
    render(<HomePage />)
    const pillars = screen.getByText(
      /No account needed · Optional sync is EU-hosted · No bank connection\./
    )
    expect(pillars).toBeInTheDocument()

    // Scoped to the two lines directly, not a whole-page count (code review): a
    // page-wide `queryAllByText(/\bAI\b/)` length of 1 would STILL read as 1 if
    // the claim were MOVED onto the pillars line, so it never pinned the split
    // its name promises. `artificial intelligence` is included because that is
    // the phrasing a copy edit would most plausibly introduce, and `\bAI\b`
    // alone is blind to it.
    const framing = screen.getByText('Intentional budgeting without bank sync or AI integrations.')
    expect(framing).toHaveTextContent(/\bAI\b/)
    expect(pillars).not.toHaveTextContent(/\bAI\b|artificial intelligence/i)
  })

  it('states the three privacy pillars with EU-hosting scoped to the optional sync (no over-claiming)', () => {
    render(<HomePage />)
    // One line covering all three pillars; "Optional sync is EU-hosted" keeps the
    // EU claim on the paid sync so free-tier (client-only) data is never implied
    // to reach a server.
    expect(
      screen.getByText('No account needed · Optional sync is EU-hosted · No bank connection.')
    ).toBeInTheDocument()
  })
})

/**
 * Overview "Manage Your Finances" tiles removed on desktop (story 19-1, UX-DR26).
 *
 * The tile grid linked Income/Expenses/Savings/Balance/Projections — the exact
 * five destinations the desktop top-bar GlobalNav already links at ≥640px, so on
 * the overview it was a second copy of the primary menu. Story 18-3 had already
 * hidden the section below 640px (the fixed bottom nav covers those links there);
 * story 19-1 removes it on desktop too, so the section is gone at every width.
 * Nothing is orphaned — every destination stays reachable via the top bar
 * (≥640px) and the fixed bottom bar (<640px), both owned by GlobalNav (which is
 * not rendered in this component-level harness).
 *
 * These assertions replace the former story-11-3 (color-as-meaning), 18-1
 * (label-overflow) and 18-3 (hidden-below-640px) tile blocks, all of which
 * asserted the now-removed tiles' presence/styling and would be vacuous.
 */
describe('HomePage "Manage Your Finances" tiles removed (story 19-1)', () => {
  beforeEach(() => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: false })
    // Force the empty-state branch so the assertions are independent of any
    // persisted store data — the removed section rendered regardless of data.
    useIncomeStore.setState({ incomeSources: [] })
    useExpenseStore.setState({ expenses: [] })
  })

  it('AC-2: the "Manage Your Finances" section is not rendered', () => {
    render(<HomePage />)
    // A DOM-presence check: the section was fully removed (not CSS-hidden), so
    // its heading is absent from the render tree. jsdom has no layout engine, so
    // this asserts non-rendering rather than any width-specific behavior — the
    // "gone at every width" guarantee comes from the removal itself, since there
    // is no longer a `hidden sm:block` branch that could reintroduce it.
    expect(screen.queryByRole('heading', { name: 'Manage Your Finances' })).toBeNull()
  })

  it('AC-2/AC-3: the tile-only "Projections" destination link is no longer on the overview', () => {
    render(<HomePage />)
    // "Projections" was unique to the removed tile grid; the surviving overview
    // surfaces (stat cards, empty-state CTAs, Premium section) never use that
    // label. Its absence proves the tile grid is gone without coupling to the
    // persistent nav (owned by GlobalNav, not rendered in this harness).
    expect(screen.queryByRole('link', { name: 'Projections' })).toBeNull()
  })
})

/**
 * Financial Overview copy (story 11-4, "Match between the system and the real
 * world"). The stat cards used to surface internal normalization vocabulary
 * ("(Monthly Normalized)", a bare "Raw: …" sub-line). These tests assert the
 * plain-language labels and that the monthly-conversion explanation is available
 * progressively via an info affordance rather than a jargon-y sub-line.
 */
describe('HomePage financial overview copy (story 11-4)', () => {
  beforeEach(() => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: false })
    useIncomeStore.setState({ incomeSources: [] })
  })

  afterEach(() => {
    useIncomeStore.setState({ incomeSources: [] })
  })

  it('AC-1: stat cards read in plain language with no "Normalized"/"Raw" jargon', () => {
    render(<HomePage />)
    // The duration suffix ("(per week/month/year)") is chosen by the story 12-2
    // selector; the plain-language intent is duration-agnostic.
    expect(screen.getByText(/^Total Income \(per (week|2 weeks|month|year)\)$/)).toBeInTheDocument()
    expect(
      screen.getByText(/^Total Expenses \(per (week|2 weeks|month|year)\)$/)
    ).toBeInTheDocument()
    expect(screen.queryByText(/Normalized/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Raw:/)).not.toBeInTheDocument()
  })

  it('AC-2: a normalized non-monthly amount drops the "Raw:" line and reveals the conversion (with the raw total) progressively on focus', async () => {
    // A weekly amount normalizes to ~4.33× its entry, so the monthly figure
    // differs from what was entered and the info affordance renders.
    useIncomeStore.setState({
      incomeSources: [
        {
          id: 'test-weekly',
          userId: 0,
          name: 'Weekly gig',
          amount: 10000,
          frequency: 'weekly',
          createdAt: '2026-07-04T00:00:00.000Z',
          updatedAt: '2026-07-04T00:00:00.000Z',
        },
      ],
    })
    render(<HomePage />)

    // No bare engineering sub-line.
    expect(screen.queryByText(/^Raw:/)).not.toBeInTheDocument()

    // Progressive disclosure: the explanation is not present until the trigger is
    // focused/hovered — no tooltip and no association at rest.
    const trigger = screen.getByRole('button', {
      name: /more information about the income figure/i,
    })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(trigger).not.toHaveAttribute('aria-describedby')

    // On focus, the tooltip appears, is associated for assistive tech, explains the
    // conversion, and surfaces the raw entered total.
    fireEvent.focus(trigger)
    const tooltip = await screen.findByRole('tooltip')
    expect(trigger).toHaveAttribute('aria-describedby')
    expect(tooltip).toHaveTextContent(
      /convert weekly, biweekly, monthly, and annual amounts to a common monthly basis so your totals are comparable/i
    )
    // Story 23-1: the tooltip must disclose the averaging (~4.33 weeks/month) that
    // makes the totals estimates, consistent with the FAQ + features copy. The
    // wording is duration-neutral ("these totals are estimates"), not "the monthly
    // figure", because the card can display per-week/per-year via the duration selector.
    expect(tooltip).toHaveTextContent(/about 4\.33 weeks a month/i)
    expect(tooltip).toHaveTextContent(/these totals are estimates/i)
    expect(tooltip).toHaveTextContent(/entered total before conversion/i)
  })
})

/**
 * Financial Overview no longer surfaces the opaque "Financial Health" score
 * (story 11-5, "Aesthetic-and-minimalist design" + Trust). The score was a
 * single uninterpretable percentage derived from arbitrary constants; it was
 * removed rather than explained. These tests assert the card is gone and the
 * overview grid reflows to the four remaining cards with no empty column.
 */
describe('HomePage financial overview — no Financial Health score (story 11-5)', () => {
  beforeEach(() => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: false })
    useIncomeStore.setState({ incomeSources: [] })
  })

  afterEach(() => {
    useIncomeStore.setState({ incomeSources: [] })
  })

  it('AC-1/AC-2: the "Financial Health" card and its percentage are gone', () => {
    render(<HomePage />)
    expect(screen.queryByText('Financial Health')).not.toBeInTheDocument()
    // No stray "NN%" score value remains in the overview.
    expect(screen.queryByText(/^\d+%$/)).not.toBeInTheDocument()
  })

  it('AC-1: the three remaining overview cards still render', () => {
    render(<HomePage />)
    expect(screen.getByText(/^Total Income \(per (week|2 weeks|month|year)\)$/)).toBeInTheDocument()
    expect(
      screen.getByText(/^Total Expenses \(per (week|2 weeks|month|year)\)$/)
    ).toBeInTheDocument()
    expect(screen.getByText('Net Worth')).toBeInTheDocument()
  })

  it('AC-1: the "Net Period Income" card and its figure are gone', () => {
    render(<HomePage />)
    expect(screen.queryByText('Net Period Income')).not.toBeInTheDocument()
  })

  it('AC-2: the overview grid reflows to three columns (no 4-column gap on desktop)', () => {
    render(<HomePage />)
    const heading = screen.getByRole('heading', { name: 'Financial Overview' })
    // The heading now shares a flex row with the duration selector (story 12-2),
    // so locate the stat grid from the enclosing section rather than the heading's
    // immediate parent.
    const grid = heading.closest('section')?.querySelector('div.grid')
    expect(grid).not.toBeNull()
    expect(grid?.className).toContain('md:grid-cols-3')
    expect(grid?.className).not.toContain('md:grid-cols-4')
    // Exactly three stat cards under the overview grid.
    expect(grid?.children.length).toBe(3)
  })
})

/**
 * Global income/expense duration selector (story 12-2, FR31).
 *
 * A single control on the Financial Overview re-expresses Total Income and Total
 * Expenses Weekly / Monthly / Annually, defaulting to Annually. The choice lives
 * in a persisted store (single source of truth), so it survives remount — one
 * control drives both figures with no per-card duplication.
 *
 * Currency mode defaults to `none`, so formatted amounts are `(cents/100).toFixed(2)`:
 * a monthly-normalized 120000c income → 14400.00 annually, 1200.00 monthly,
 * 276.92 weekly (120000 ÷ 52/12, rounded).
 */
describe('HomePage overview duration selector (story 12-2)', () => {
  function seedMonthly(): void {
    // Monthly amounts normalize 1:1, so raw === normalized (no InfoTooltip) and
    // the denormalized display values are exact and easy to reason about.
    useIncomeStore.setState({
      incomeSources: [
        {
          id: 'inc-monthly',
          userId: 0,
          name: 'Salary',
          amount: 120000,
          frequency: 'monthly',
          createdAt: '2026-07-04T00:00:00.000Z',
          updatedAt: '2026-07-04T00:00:00.000Z',
        },
      ],
    })
    useExpenseStore.setState({
      expenses: [
        {
          id: 'exp-monthly',
          userId: 0,
          name: 'Rent',
          amount: 60000,
          frequency: 'monthly',
          createdAt: '2026-07-04T00:00:00.000Z',
          updatedAt: '2026-07-04T00:00:00.000Z',
        },
      ],
    })
  }

  function incomeCard(): HTMLElement {
    return screen
      .getByText(/^Total Income \(per (week|2 weeks|month|year)\)$/)
      .closest('div.surface-inset') as HTMLElement
  }

  function expenseCard(): HTMLElement {
    return screen
      .getByText(/^Total Expenses \(per (week|2 weeks|month|year)\)$/)
      .closest('div.surface-inset') as HTMLElement
  }

  beforeEach(() => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: false })
    useIncomeStore.setState({ incomeSources: [] })
    useExpenseStore.setState({ expenses: [] })
    useOverviewDurationStore.setState({ duration: 'annually' })
  })

  afterEach(() => {
    useIncomeStore.setState({ incomeSources: [] })
    useExpenseStore.setState({ expenses: [] })
    useOverviewDurationStore.setState({ duration: 'annually' })
  })

  it('AC-1: renders one selector defaulting to Annually, with annual card labels', () => {
    render(<HomePage />)

    const select = screen.getByRole('combobox', {
      name: /show income and expenses per/i,
    }) as HTMLSelectElement
    expect(select.value).toBe('annually')

    // Exactly one duration selector (no per-card duplication).
    expect(screen.getAllByRole('combobox', { name: /show income and expenses per/i })).toHaveLength(
      1
    )
    expect(screen.getByText('Total Income (per year)')).toBeInTheDocument()
    expect(screen.getByText('Total Expenses (per year)')).toBeInTheDocument()

    // Story 32.1 widened the control to the FOUR entry frequencies. Counting the
    // options pins that the rendered list and the store's coercion set agree —
    // a selectable option the store would reject on reload is the exact trap
    // this story was written to close.
    expect(Array.from(select.options).map((option) => option.value)).toEqual([
      'weekly',
      'biweekly',
      'monthly',
      'annually',
    ])
  })

  it('AC-1/AC-2: figures start annual and re-express when the duration changes', () => {
    seedMonthly()
    render(<HomePage />)

    // Default: annual figures (monthly × 12). Currency-less mode groups
    // thousands (story 14-2), so 4+ digit figures carry a comma separator.
    expect(within(incomeCard()).getByText('14,400.00')).toBeInTheDocument()
    expect(within(expenseCard()).getByText('7,200.00')).toBeInTheDocument()

    // Switch to Monthly: labels and figures follow the one control.
    fireEvent.change(screen.getByRole('combobox', { name: /show income and expenses per/i }), {
      target: { value: 'monthly' },
    })
    expect(screen.getByText('Total Income (per month)')).toBeInTheDocument()
    expect(within(incomeCard()).getByText('1,200.00')).toBeInTheDocument()
    expect(within(expenseCard()).getByText('600.00')).toBeInTheDocument()

    // Switch to Weekly: monthly ÷ (52/12), rounded to the cent.
    fireEvent.change(screen.getByRole('combobox', { name: /show income and expenses per/i }), {
      target: { value: 'weekly' },
    })
    expect(screen.getByText('Total Income (per week)')).toBeInTheDocument()
    expect(within(incomeCard()).getByText('276.92')).toBeInTheDocument()
    expect(within(expenseCard()).getByText('138.46')).toBeInTheDocument()

    // Switch to Bi-weekly (story 32.1): monthly ÷ (26/12), rounded to the cent.
    //   income   round(120000 × 12/26) = round(55384.61…) = 55385 -> 553.85
    //   expenses round( 60000 × 12/26) = round(27692.30…) = 27692 -> 276.92
    fireEvent.change(screen.getByRole('combobox', { name: /show income and expenses per/i }), {
      target: { value: 'biweekly' },
    })
    expect(screen.getByText('Total Income (per 2 weeks)')).toBeInTheDocument()
    expect(within(incomeCard()).getByText('553.85')).toBeInTheDocument()
    expect(within(expenseCard()).getByText('276.92')).toBeInTheDocument()
  })

  /**
   * ⚠️ Story 32.1 code review. The conversion disclosure used to be gated on
   * `totalNormalizedIncome !== totalIncomeRaw`. That equality is only a PROXY for
   * "conversion happened", and it has a false negative:
   *
   *   $330 weekly  -> round(33000 × 52/12) = 143000c
   *   $1,200 annually ->      round(120000/12) =  10000c
   *   normalized total                        = 153000c
   *   raw total       33000 + 120000          = 153000c   <- identical
   *
   * Both rows were genuinely converted, yet the old gate rendered no explanation.
   * The gate now asks whether any row is non-monthly. Reverting it leaves every
   * other test green, so this is the only assertion standing between that bug and
   * a release.
   */
  it('AC-2: discloses the conversion even when it lands coincidentally on the raw sum', () => {
    useIncomeStore.setState({
      incomeSources: [
        {
          id: 'inc-weekly',
          userId: 0,
          name: 'Weekly',
          amount: 33000,
          frequency: 'weekly',
          createdAt: '2026-07-04T00:00:00.000Z',
          updatedAt: '2026-07-04T00:00:00.000Z',
        },
        {
          id: 'inc-annual',
          userId: 0,
          name: 'Annual',
          amount: 120000,
          frequency: 'annually',
          createdAt: '2026-07-04T00:00:00.000Z',
          updatedAt: '2026-07-04T00:00:00.000Z',
        },
      ],
    })
    useExpenseStore.setState({ expenses: [] })
    render(<HomePage />)

    expect(
      screen.getByRole('button', { name: /more information about the income figure/i })
    ).toBeInTheDocument()
  })

  it('AC-2: shows no conversion disclosure when every row is already monthly', () => {
    seedMonthly()
    render(<HomePage />)

    expect(
      screen.queryByRole('button', { name: /more information about the income figure/i })
    ).not.toBeInTheDocument()
  })

  it('AC-3: the selection is a single source of truth that survives remount', () => {
    const { unmount } = render(<HomePage />)

    fireEvent.change(screen.getByRole('combobox', { name: /show income and expenses per/i }), {
      target: { value: 'monthly' },
    })
    expect(
      (screen.getByRole('combobox', { name: /show income and expenses per/i }) as HTMLSelectElement)
        .value
    ).toBe('monthly')

    // Navigate away and back: a fresh mount reads the choice from the store.
    unmount()
    render(<HomePage />)
    const select = screen.getByRole('combobox', {
      name: /show income and expenses per/i,
    }) as HTMLSelectElement
    expect(select.value).toBe('monthly')
    expect(screen.getByText('Total Income (per month)')).toBeInTheDocument()
  })
})

/**
 * Income vs Expense Breakdown period control (story 12-3, UX-DR20).
 *
 * The six date-range presets are replaced with a plain Monthly/Annually toggle
 * defaulting to Annually, and the chart now re-aggregates through the core
 * frequency engine instead of summing raw amounts. This control is independent
 * of the overview duration selector (12-2) and has NO persistence.
 *
 * Currency mode defaults to `none`, so the "Top Categories" figures print as
 * locale-grouped decimals (story 14-2). Seeding two income sources with EQUAL
 * raw amounts (10000c) but different frequencies proves normalization is
 * applied: a weekly entry and an annual entry must NOT render as equal slices.
 *   weekly  10000c → monthly round(10000 × 52/12) = 43333c → annually ×12 = 519996c → "5,199.96"
 *   annual  10000c → monthly round(10000 × 1/12) = 833c   → annually ×12 = 9996c   → "99.96"
 * Switching to Monthly divides each annual figure by 12: "433.33" and "8.33".
 */
describe('HomePage income-vs-expense breakdown period control (story 12-3)', () => {
  function seedMixedFrequencyIncome(): void {
    useIncomeStore.setState({
      incomeSources: [
        {
          id: 'inc-weekly',
          userId: 0,
          name: 'Weekly gig',
          amount: 10000,
          frequency: 'weekly',
          createdAt: '2026-07-04T00:00:00.000Z',
          updatedAt: '2026-07-04T00:00:00.000Z',
        },
        {
          id: 'inc-annual',
          userId: 0,
          name: 'Annual bonus',
          amount: 10000,
          frequency: 'annually',
          createdAt: '2026-07-04T00:00:00.000Z',
          updatedAt: '2026-07-04T00:00:00.000Z',
        },
      ],
    })
  }

  function breakdownSelect(): HTMLSelectElement {
    return screen.getByRole('combobox', { name: /show breakdown per/i }) as HTMLSelectElement
  }

  beforeEach(() => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: false })
    useIncomeStore.setState({ incomeSources: [] })
    useExpenseStore.setState({ expenses: [] })
    useOverviewDurationStore.setState({ duration: 'annually' })
  })

  afterEach(() => {
    useIncomeStore.setState({ incomeSources: [] })
    useExpenseStore.setState({ expenses: [] })
    useOverviewDurationStore.setState({ duration: 'annually' })
  })

  it('AC-1: offers only Monthly and Annually, defaulting to Annually, with no preset labels', () => {
    seedMixedFrequencyIncome()
    render(<HomePage />)

    const select = breakdownSelect()
    expect(select.value).toBe('annually')

    const optionValues = Array.from(select.options).map((o) => o.value)
    expect(optionValues).toEqual(['monthly', 'annually'])
    const optionLabels = Array.from(select.options).map((o) => o.textContent)
    expect(optionLabels).toEqual(['Monthly', 'Annually'])

    // The old six-preset control and its labels are gone.
    expect(screen.queryByText(/Last Month/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Last 3 Months/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Year to Date/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Custom Range/i)).not.toBeInTheDocument()
  })

  it('AC-2: category figures are frequency-normalized and re-express when the period changes', () => {
    seedMixedFrequencyIncome()
    render(<HomePage />)

    // Annually (default): equal raw amounts render as UNEQUAL, normalized slices.
    // Currency-less mode groups thousands (story 14-2): 519996c → "5,199.96".
    expect(screen.getByText('5,199.96')).toBeInTheDocument() // weekly 10000c/yr
    expect(screen.getByText('99.96')).toBeInTheDocument() // annual 10000c/yr
    // Not the raw sum — a raw-amount chart would show both as "100.00".
    expect(screen.queryByText('100.00')).not.toBeInTheDocument()

    // Switch to Monthly: each figure becomes the Annually value ÷ 12.
    fireEvent.change(breakdownSelect(), { target: { value: 'monthly' } })
    expect(breakdownSelect().value).toBe('monthly')
    expect(screen.getByText('433.33')).toBeInTheDocument() // 5,199.96 ÷ 12
    expect(screen.getByText('8.33')).toBeInTheDocument() // 99.96 ÷ 12
    // The annual figures are no longer shown.
    expect(screen.queryByText('5,199.96')).not.toBeInTheDocument()
    expect(screen.queryByText('99.96')).not.toBeInTheDocument()
  })
})

/**
 * Asset & Liability breakdown pie removed (story 12-4, UX-DR21).
 *
 * The dashboard used to render an "Asset & Liability Breakdown" pie beside the
 * income-vs-expense pie, plotting Savings/Investments/Debts as three slices of
 * one whole. It was (a) redundant with the "Financial Category Summary" bar
 * chart directly below — the same three figures — and (b) conceptually muddled
 * (debts, a liability, shown as a proportional slice of an "asset" whole).
 * Product approved removing it; the bar chart is now the sole carrier of those
 * figures. These tests assert the asset pie is gone, the bar chart remains, and
 * the income/expense breakdown renders as two separate, distinctly-headed pies
 * (UX review #4 split it so each has its own correct 100% denominator).
 *
 * Assertions target the section/sub-headings, which render deterministically in
 * jsdom, rather than the Recharts SVG (which needs real layout to render).
 */
describe('HomePage asset/liability breakdown removed (story 12-4)', () => {
  function seedIncomeAndSavings(): void {
    // Income makes the visualization block render (hasData). A funded savings
    // goal is exactly the kind of figure the removed pie plotted, so seeding it
    // proves the pie is gone even when its data exists.
    useIncomeStore.setState({
      incomeSources: [
        {
          id: 'inc-1',
          userId: 0,
          name: 'Salary',
          amount: 500000,
          frequency: 'monthly',
          createdAt: '2026-07-04T00:00:00.000Z',
          updatedAt: '2026-07-04T00:00:00.000Z',
        },
      ],
    })
    useSavingsStore.setState({
      savingsGoals: [
        {
          id: 1,
          name: 'Emergency Fund',
          targetAmount: 1000000,
          currentBalance: 250000,
          createdAt: '2026-07-04T00:00:00.000Z',
          updatedAt: '2026-07-04T00:00:00.000Z',
        },
      ],
    })
  }

  beforeEach(() => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: false })
    useIncomeStore.setState({ incomeSources: [] })
    useExpenseStore.setState({ expenses: [] })
    useSavingsStore.setState({ savingsGoals: [] })
    useOverviewDurationStore.setState({ duration: 'annually' })
  })

  afterEach(() => {
    useIncomeStore.setState({ incomeSources: [] })
    useExpenseStore.setState({ expenses: [] })
    useSavingsStore.setState({ savingsGoals: [] })
    useOverviewDurationStore.setState({ duration: 'annually' })
  })

  it('AC-3: the redundant "Asset & Liability Breakdown" pie and its heading are gone', () => {
    seedIncomeAndSavings()
    render(<HomePage />)
    expect(
      screen.queryByRole('heading', { name: /asset & liability breakdown/i })
    ).not.toBeInTheDocument()
  })

  it('AC-2: the "Financial Category Summary" bar chart remains as the sole carrier of the Savings/Investments/Debts figures', () => {
    seedIncomeAndSavings()
    render(<HomePage />)
    expect(screen.getByRole('heading', { name: /financial category summary/i })).toBeInTheDocument()
  })

  it('AC-2/UX-#4: income and expenses render as two separately-headed breakdown pies (asset & liability pie still gone)', () => {
    seedIncomeAndSavings()
    render(<HomePage />)
    // The section keeps its "Income vs Expense Breakdown" heading...
    expect(
      screen.getByRole('heading', { name: /income vs expense breakdown/i })
    ).toBeInTheDocument()
    // ...but income and expenses are now split into two sub-pies, each with its
    // own correct 100% denominator and a distinct sub-heading (UX review #4).
    // Retitled by story 30.4b: the pie groups by the user's own category now,
    // not per income source, so "by source" had become a lie.
    expect(screen.getByRole('heading', { name: /income by category/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /income by source/i })).toBeNull()
    expect(screen.getByRole('heading', { name: /expenses by category/i })).toBeInTheDocument()
    // The removed asset & liability pie stays gone.
    expect(screen.queryByRole('heading', { name: /asset & liability breakdown/i })).toBeNull()
  })
})

/**
 * Flows and balances split into two sub-charts (story UX-2).
 *
 * The "Financial Category Summary" used to plot per-period FLOWS (Income /
 * Expenses) on the same value axis as point-in-time BALANCES (Savings /
 * Investments / Debts). At the "Annually" cadence a ~$93.6k income bar dwarfed a
 * ~$5k savings balance, crushing the balance bars to a sliver. UX-2 splits the
 * section into two sub-charts — "Income & expenses" and "Balances" — each on its
 * own axis, so neither can flatten the other.
 *
 * Assertions target the section + sub-headings (which render deterministically in
 * jsdom), not the Recharts SVG (which needs real layout). The parent "Financial
 * Category Summary" heading is preserved as the carrier the story-12-4 tests
 * assert.
 */
describe('HomePage flows/balances split (story UX-2)', () => {
  const TS = '2026-07-14T00:00:00.000Z'

  function seedIncome(amountCents: number): void {
    useIncomeStore.setState({
      incomeSources: [
        {
          id: 'inc-1',
          userId: 0,
          name: 'Salary',
          amount: amountCents,
          frequency: 'monthly',
          createdAt: TS,
          updatedAt: TS,
        },
      ],
    })
  }

  function seedExpense(amountCents: number): void {
    useExpenseStore.setState({
      expenses: [
        {
          id: 'exp-1',
          userId: 0,
          name: 'Rent',
          amount: amountCents,
          frequency: 'monthly',
          createdAt: TS,
          updatedAt: TS,
        },
      ],
    })
  }

  function seedSavings(balanceCents: number): void {
    useSavingsStore.setState({
      savingsGoals: [
        {
          id: 1,
          name: 'Emergency Fund',
          targetAmount: 1000000,
          currentBalance: balanceCents,
          createdAt: TS,
          updatedAt: TS,
        },
      ],
    })
  }

  function seedBalances(): void {
    useBalanceStore.setState({
      entries: [
        {
          id: 'inv-1',
          type: 'investment',
          name: '401k',
          currentBalance: 800000,
          monthlyContribution: 0,
          frequency: 'monthly',
          createdAt: TS,
          updatedAt: TS,
        },
        {
          id: 'debt-1',
          type: 'debt',
          name: 'Car Loan',
          currentBalance: 300000,
          monthlyContribution: 0,
          frequency: 'monthly',
          createdAt: TS,
          updatedAt: TS,
        },
      ],
    })
  }

  function resetAll(): void {
    useIncomeStore.setState({ incomeSources: [] })
    useExpenseStore.setState({ expenses: [] })
    useSavingsStore.setState({ savingsGoals: [] })
    useBalanceStore.setState({ entries: [] })
    useOverviewDurationStore.setState({ duration: 'annually' })
  }

  beforeEach(() => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: false })
    resetAll()
  })

  afterEach(resetAll)

  it('AC-1: renders separate "Income & expenses" and "Balances" sub-charts when both exist', () => {
    seedIncome(500000)
    seedExpense(200000)
    seedSavings(500000)
    seedBalances()
    render(<HomePage />)
    // The parent section heading is preserved (story-12-4 carrier guarantee).
    expect(screen.getByRole('heading', { name: /financial category summary/i })).toBeInTheDocument()
    // Flows and balances now have their own distinctly-headed sub-charts.
    expect(screen.getByRole('heading', { name: /^income & expenses/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^balances$/i })).toBeInTheDocument()
    // Both sections have data, so the empty fallback must not appear.
    expect(screen.queryByText(/no financial data to display/i)).not.toBeInTheDocument()
  })

  it('AC-2: the flows sub-heading carries the overview-duration suffix (not regressing #8)', () => {
    seedIncome(500000)
    seedExpense(200000)
    render(<HomePage />)
    // Default cadence (Annually) — the flows sub-heading reads "(per year)".
    expect(
      screen.getByRole('heading', { name: 'Income & expenses (per year)' })
    ).toBeInTheDocument()

    // Switching the ONE overview selector re-expresses the flows heading in
    // lockstep with the cards above (story 12-2 alignment).
    fireEvent.change(screen.getByRole('combobox', { name: /show income and expenses per/i }), {
      target: { value: 'monthly' },
    })
    expect(
      screen.getByRole('heading', { name: 'Income & expenses (per month)' })
    ).toBeInTheDocument()
    // The stale annual heading must be GONE (not merely joined by the monthly one)
    // — guards against a duplicate-render regression.
    expect(
      screen.queryByRole('heading', { name: 'Income & expenses (per year)' })
    ).not.toBeInTheDocument()
  })

  it('AC-5: a genuinely balances-only user (no income/expense rows) still reaches the Balances sub-chart', () => {
    // The real balances-only path — NO income or expense rows at all. This works
    // only because `hasData` counts savings/balances too (the ux-2 review fix);
    // before that, this user hit the "Let's set up your budget" onboarding and
    // never saw their balances. No zero-amount-income trick.
    seedSavings(250000)
    render(<HomePage />)
    // The onboarding screen must NOT show — the dashboard renders for this user.
    expect(screen.queryByText(/let's set up your budget/i)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^balances$/i })).toBeInTheDocument()
    // Flows are absent, so the flows sub-chart is hidden and no empty axis renders.
    expect(screen.queryByRole('heading', { name: /^income & expenses/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/no financial data to display/i)).not.toBeInTheDocument()
  })

  it('AC-5: with only flows (no balances), the balances sub-chart is hidden', () => {
    seedIncome(500000)
    seedExpense(200000)
    render(<HomePage />)
    expect(screen.getByRole('heading', { name: /^income & expenses/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /^balances$/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/no financial data to display/i)).not.toBeInTheDocument()
  })

  it('AC-5: with neither flows nor balances present, the section shows the empty hint', () => {
    // Income row exists (hasData → the summary section renders) but its amount is
    // zero and there are no balances, so both datasets are empty.
    seedIncome(0)
    render(<HomePage />)
    expect(screen.getByText(/no financial data to display/i)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /^income & expenses/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /^balances$/i })).not.toBeInTheDocument()
  })
})

/**
 * HomePage net-worth tests (Story 32.2, FR59).
 *
 * The Overview's "Net Worth" card now shows `investments + savings − debts`,
 * read through the one shared `useNetWorth()` hook, so it can no longer disagree
 * with the Balance page — or with the balances bar chart ten lines below it,
 * which has always plotted Savings + Investments − Debts.
 *
 * ⚠️ Expectations are HAND-COMPUTED from the story §3 fixture, in the suite-wide
 * currency-less mode:
 *
 *   2,000,000c investments + 300,000c savings − 15,000,000c debts = −12,700,000c
 *   the pre-32.2 formula gave −13,000,000c → "-130,000.00"
 *
 * The figure is located by `data-testid`, never by an accessible-name matcher:
 * story 32.1 measured that a heading/label containing an InfoTooltip button
 * resolves to a different accessible name under jsdom than under Chromium.
 */
describe('HomePage net worth includes savings (Story 32.2)', () => {
  const NW_TS = '2026-08-15T00:00:00.000Z'

  function resetAll(): void {
    useIncomeStore.setState({ incomeSources: [] })
    useExpenseStore.setState({ expenses: [] })
    useSavingsStore.setState({ savingsGoals: [] })
    useBalanceStore.setState({ entries: [] })
    useOverviewDurationStore.setState({ duration: 'annually' })
  }

  beforeEach(() => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: false })
    resetAll()
  })

  afterEach(resetAll)

  function seedSavings(): void {
    useSavingsStore.setState({
      savingsGoals: [
        {
          id: 'sav-1',
          name: 'Emergency fund',
          targetAmount: 1_000_000,
          currentBalance: 250_000,
          createdAt: NW_TS,
          updatedAt: NW_TS,
        },
        {
          id: 'sav-2',
          name: 'Rainy day',
          targetAmount: null,
          currentBalance: 50_000,
          createdAt: NW_TS,
          updatedAt: NW_TS,
        },
      ],
    })
  }

  function seedBalances(): void {
    useBalanceStore.setState({
      entries: [
        {
          id: 'inv-1',
          type: 'investment',
          name: 'ISA',
          currentBalance: 800_000,
          monthlyContribution: 0,
          frequency: 'monthly',
          createdAt: NW_TS,
          updatedAt: NW_TS,
        },
        {
          id: 'inv-2',
          type: 'investment',
          name: 'Pension',
          currentBalance: 1_200_000,
          monthlyContribution: 0,
          frequency: 'monthly',
          createdAt: NW_TS,
          updatedAt: NW_TS,
        },
        {
          id: 'debt-1',
          type: 'debt',
          name: 'Mortgage',
          currentBalance: 15_000_000,
          monthlyContribution: 0,
          frequency: 'monthly',
          createdAt: NW_TS,
          updatedAt: NW_TS,
        },
      ],
    })
  }

  it('AC-3: adds savings into the Overview net-worth figure', () => {
    seedSavings()
    seedBalances()
    render(<HomePage />)

    expect(screen.getByTestId('overview-net-worth')).toHaveTextContent('-127,000.00')
  })

  it('AC-3: no longer shows the pre-32.2 investments-minus-debts figure', () => {
    seedSavings()
    seedBalances()
    render(<HomePage />)

    expect(screen.getByTestId('overview-net-worth')).not.toHaveTextContent('-130,000.00')
  })

  it('AC-3: the net-worth tooltip names savings as a component', async () => {
    seedSavings()
    seedBalances()
    render(<HomePage />)

    // Progressive disclosure: the bubble exists only while the trigger is
    // focused/hovered, so focus it first (the story 11-4 pattern).
    const trigger = screen.getByRole('button', { name: /more information about net worth/i })
    fireEvent.focus(trigger)
    const tooltip = await screen.findByRole('tooltip')

    // Distinguishing phrasing, not a generic word (Epic 23 lesson): the copy has
    // to say savings count, and must no longer state the superseded definition
    // ("your investments minus your debts") as fact.
    expect(tooltip).toHaveTextContent(/savings/i)
    expect(tooltip).not.toHaveTextContent(/your investments minus your debts/i)
    // The Savings page is where that money is entered, so name it alongside Balance.
    expect(tooltip).toHaveTextContent(/balance/i)
  })

  it('AC-6: a savings-only user sees a positive net worth equal to their savings', () => {
    seedSavings()
    render(<HomePage />)

    expect(screen.getByTestId('overview-net-worth')).toHaveTextContent('3,000.00')
  })

  it('AC-3: a savings-only user is NOT told the figure is untracked', () => {
    seedSavings()
    render(<HomePage />)

    // The old gate keyed on balance rows alone, so this hint rendered beside a
    // real, positive net worth — the card contradicting itself.
    expect(screen.queryByTestId('net-worth-empty-hint')).not.toBeInTheDocument()
  })

  it('AC-3: a user with only flows still sees the hint, now naming both pages', () => {
    useIncomeStore.setState({
      incomeSources: [
        {
          id: 'inc-1',
          name: 'Salary',
          amount: 500_000,
          frequency: 'monthly',
          createdAt: NW_TS,
          updatedAt: NW_TS,
        },
      ],
    })
    render(<HomePage />)

    const hint = screen.getByTestId('net-worth-empty-hint')
    expect(hint).toBeInTheDocument()
    expect(hint.textContent).toMatch(/savings/i)
  })

  it('AC-6: shows zero, not NaN, with no balances and no savings', () => {
    useIncomeStore.setState({
      incomeSources: [
        {
          id: 'inc-1',
          name: 'Salary',
          amount: 500_000,
          frequency: 'monthly',
          createdAt: NW_TS,
          updatedAt: NW_TS,
        },
      ],
    })
    render(<HomePage />)

    const netWorth = screen.getByTestId('overview-net-worth')
    expect(netWorth).toHaveTextContent('0.00')
    expect(netWorth.textContent).not.toMatch(/NaN/)
  })
})
