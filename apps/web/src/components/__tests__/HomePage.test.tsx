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
})

/**
 * Privacy-first tagline (story 25-4, AC-1).
 *
 * The overview header leads with the tagline "The budget planner that never
 * sees your money" as the primary message beneath the app-name heading. This is
 * tier-independent, so a single free-user render is sufficient.
 */
describe('HomePage tagline (story 25-4)', () => {
  beforeEach(() => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: false })
  })

  it('AC-1: surfaces the privacy-first tagline while keeping the app name', () => {
    render(<HomePage />)
    expect(screen.getByText('The budget planner that never sees your money')).toBeInTheDocument()
    // The app name still appears as the header heading.
    expect(screen.getByRole('heading', { name: 'Budget Planner', level: 1 })).toBeInTheDocument()
  })
})

/**
 * Overview subtitle + mobile section padding (story 19-4, CONTENT-F / UX-DR32).
 *
 * Story 25-4 already claimed the header subtitle slot with the tagline, so the
 * CONTENT-F "bird's-eye" line is ADDED as a SECONDARY subtitle beneath it (the
 * tagline is preserved, not replaced). Mobile padding on the empty-state
 * onboarding and Premium Features sections is tightened with responsive
 * utilities (p-4 sm:p-6 / p-6 sm:p-8) so the ≥640px desktop spacing is unchanged.
 *
 * Padding is asserted by class-token membership (not substring regex) so a
 * Tailwind class like `sm:p-6` cannot be mistaken for `p-6` (project memory,
 * batch-4 lesson).
 */
describe('HomePage overview subtitle + mobile padding (story 19-4)', () => {
  beforeEach(() => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: false })
  })

  it("AC-1: adds the bird's-eye secondary subtitle while keeping the 25-4 tagline", () => {
    render(<HomePage />)
    // Both lines coexist: the tagline (25-4) and the new supporting line (19-4).
    expect(screen.getByText('The budget planner that never sees your money')).toBeInTheDocument()
    expect(
      screen.getByText("Get a bird's-eye view of your income, expenses, savings, and more!")
    ).toBeInTheDocument()
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
    // The onboarding section only renders when there is no income/expense data.
    useIncomeStore.setState({ incomeSources: [] })
    useExpenseStore.setState({ expenses: [] })
    render(<HomePage />)
    const section = screen.getByText("Let's set up your budget").closest('section')
    expect(section).not.toBeNull()
    const tokens = (section as HTMLElement).className.split(/\s+/)
    expect(tokens).toContain('p-4')
    expect(tokens).toContain('sm:p-6')
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
    expect(screen.getByText(/^Total Income \(per (week|month|year)\)$/)).toBeInTheDocument()
    expect(screen.getByText(/^Total Expenses \(per (week|month|year)\)$/)).toBeInTheDocument()
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
      /convert weekly, monthly, and annual amounts to a common period so your totals are comparable/i
    )
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
    expect(screen.getByText(/^Total Income \(per (week|month|year)\)$/)).toBeInTheDocument()
    expect(screen.getByText(/^Total Expenses \(per (week|month|year)\)$/)).toBeInTheDocument()
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
      .getByText(/^Total Income \(per (week|month|year)\)$/)
      .closest('div.surface-inset') as HTMLElement
  }

  function expenseCard(): HTMLElement {
    return screen
      .getByText(/^Total Expenses \(per (week|month|year)\)$/)
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
    expect(screen.getByRole('heading', { name: /income by source/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /expenses by category/i })).toBeInTheDocument()
    // The removed asset & liability pie stays gone.
    expect(screen.queryByRole('heading', { name: /asset & liability breakdown/i })).toBeNull()
  })
})
