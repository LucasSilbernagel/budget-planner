import { act, fireEvent, renderWithProviders, screen, within } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useBalanceStore } from '../../stores/balanceStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { useSavingsStore } from '../../stores/savingsStore'
import { ErrorBoundary } from '../ErrorBoundary'
import { NetWorthProjectionPage } from '../NetWorthProjectionPage'

/**
 * NetWorthProjectionPage "Annual Return Rate" input tests (story 6-7, BUG-B).
 *
 * The rate was stored as a decimal (0.07) while the input bound `value={rate * 100}`
 * and `onChange` did `parseFloat / 100`. That divide-then-remultiply round-trip
 * surfaced IEEE-754 noise (type 7.2 -> 0.072 -> *100 = 7.199999999999999). It also
 * fed 0 to `calculateCompoundingProjection` when the field was cleared, and that core
 * fn throws for a rate <= 0 / < 0.1% while being called unconditionally in render ->
 * the page crashed. These tests pin: quantized 2-decimal display, no crash on an
 * empty/zero rate, and that the math still uses the true decimal rate (NFR3).
 */
describe('NetWorthProjectionPage annual return rate input', () => {
  beforeEach(() => {
    useBalanceStore.setState({ entries: [] })
  })

  afterEach(() => {
    useBalanceStore.setState({ entries: [] })
  })

  function seedInvestment(currentBalance: number) {
    useBalanceStore.getState().addBalanceEntry({
      type: 'investment',
      name: 'Brokerage',
      currentBalance,
      maxContributionLimit: null,
      monthlyContribution: 0,
      frequency: 'monthly',
    })
  }

  it('renders the rate input with a 2-decimal step and the default 7% (AC-1)', () => {
    renderWithProviders(<NetWorthProjectionPage />)
    const input = screen.getByLabelText(/annual return rate/i)
    expect(input).toHaveAttribute('step', '0.01')
    expect(input).toHaveAttribute('max', '100')
    expect(input).toHaveValue(7)
  })

  it('quantizes a floating-point-noisy value to at most 2 decimals (AC-2)', () => {
    renderWithProviders(<NetWorthProjectionPage />)
    const input = screen.getByLabelText(/annual return rate/i) as HTMLInputElement

    // The exact string the old round-trip would surface — must be cleaned up.
    fireEvent.change(input, { target: { value: '7.199999999999999' } })
    expect(input.value).toBe('7.2')

    // Ordinary excess precision is rounded to 2 decimals.
    fireEvent.change(input, { target: { value: '7.256' } })
    expect(input.value).toBe('7.26')
  })

  it('clamps out-of-range values to the [0, 100] percent window (AC-1)', () => {
    renderWithProviders(<NetWorthProjectionPage />)
    const input = screen.getByLabelText(/annual return rate/i) as HTMLInputElement

    fireEvent.change(input, { target: { value: '150' } })
    expect(input.value).toBe('100')
  })

  it('projects a flat series when the rate is cleared or zero, without crashing (AC-4, story 28-2)', () => {
    // Pre-28.2 a 0% rate was blocked behind an "enter at least 0.1%" hint, because the
    // old compounding model threw below that floor. `createNetWorthProjection` accepts
    // 0%, which is a meaningful scenario — assets simply do not grow — so the projection
    // must render instead of an empty state.
    seedInvestment(1_000_000) // $10,000, and ensures hasData === true
    renderWithProviders(<NetWorthProjectionPage />)
    const input = screen.getByLabelText(/annual return rate/i) as HTMLInputElement

    // Clearing the field must not throw.
    fireEvent.change(input, { target: { value: '' } })

    expect(input.value).toBe('0')
    expect(screen.queryByText(/enter an annual return rate of at least/i)).not.toBeInTheDocument()
    expect(screen.getByText('Projection Summary')).toBeInTheDocument()

    // No growth and no income in this store, so every year holds the $10,000 principal.
    const summary = screen.getByText('Projection Summary').closest('section') as HTMLElement
    const valueEls = within(summary).getAllByText((content, el) => {
      return el?.tagName === 'P' && /^-?[\d,]+(?:\.\d+)?$/.test(content.trim())
    })
    expect(valueEls).toHaveLength(3)
    for (const el of valueEls) {
      expect(Number.parseFloat((el.textContent ?? '').replace(/,/g, ''))).toBe(10_000)
    }
  })

  it('gives the rate input a min of 0 now that a zero rate is projectable (AC-5, story 28-2)', () => {
    renderWithProviders(<NetWorthProjectionPage />)
    expect(screen.getByLabelText(/annual return rate/i)).toHaveAttribute('min', '0')
  })

  it('projects using the decimal rate, not the raw percent (AC-3, NFR3)', () => {
    // $10,000 principal, no income → pure compounding on principal.
    seedInvestment(1_000_000)
    renderWithProviders(<NetWorthProjectionPage />)

    // Default rate 7% over 10 years ≈ $19,671 (1.07^10 ≈ 1.967).
    // If the code wrongly passed 7 (i.e. 700%) as the decimal, the final value
    // would be astronomically larger — this range check disproves that.
    expect(screen.getByText('Projection Summary')).toBeInTheDocument()
    const summary = screen.getByText('Projection Summary').closest('section') as HTMLElement
    // Read only the value paragraphs (pure numbers), not the "Year N" labels.
    const valueEls = within(summary).getAllByText((content, el) => {
      return el?.tagName === 'P' && /^[\d,]+(?:\.\d+)?$/.test(content.trim())
    })
    const values = valueEls.map((el) => Number.parseFloat((el.textContent ?? '').replace(/,/g, '')))
    const maxValue = Math.max(...values)
    expect(maxValue).toBeGreaterThan(10_000) // grew above the $10,000 principal
    expect(maxValue).toBeLessThan(30_000) // consistent with 7%, impossible at 700%
  })
})

/**
 * NetWorthProjectionPage input hardening (story BUG-1 — Epic-6 retro action item #1,
 * the twice-surfaced Infinity/overflow HIGH from 6-7).
 *
 * The rate input was already guarded (6-7), but the sibling `years` and
 * `additionalContribution` inputs fed the unconditionally-called, throwing core calc
 * (`calculateCompoundingProjection`), and the route had no ErrorBoundary — so an
 * out-of-range or overflowing entry white-screened the whole page. These tests pin:
 * years clamped to the field max (50), contribution rejected/clamped so the core
 * never receives a non-finite or overflowing value, and a residual core throw
 * (e.g. from an overflowing derived principal) contained by the ErrorBoundary.
 */
describe('NetWorthProjectionPage input hardening (story bug-1)', () => {
  beforeEach(() => {
    useBalanceStore.setState({ entries: [] })
    useIncomeStore.setState({ incomeSources: [] })
  })

  afterEach(() => {
    useBalanceStore.setState({ entries: [] })
    useIncomeStore.setState({ incomeSources: [] })
  })

  function seedInvestment(currentBalance: number) {
    useBalanceStore.getState().addBalanceEntry({
      type: 'investment',
      name: 'Brokerage',
      currentBalance,
      maxContributionLimit: null,
      monthlyContribution: 0,
      frequency: 'monthly',
    })
  }

  it('clamps a Projection Period above the field max down to 50 without crashing (AC-1)', () => {
    seedInvestment(1_000_000)
    renderWithProviders(<NetWorthProjectionPage />)
    const input = screen.getByLabelText(/projection period/i) as HTMLInputElement

    // A type="number" field still accepts a *typed* value beyond `max`; pre-fix this
    // reached the core calc (years > MAX_PROJECTION_YEARS = 100) → throw → white-screen.
    fireEvent.change(input, { target: { value: '500' } })

    expect(input.value).toBe('50')
    // Projection still renders for the clamped value.
    expect(screen.getByText('Projection Summary')).toBeInTheDocument()
  })

  it('rejects a non-finite Additional Annual Contribution as 0 without crashing (AC-2)', () => {
    seedInvestment(1_000_000)
    renderWithProviders(<NetWorthProjectionPage />)
    const input = screen.getByLabelText(/additional annual contribution/i) as HTMLInputElement

    // `1e999` parses to Infinity → pre-fix the core calc threw "must be finite".
    fireEvent.change(input, { target: { value: '1e999' } })

    expect(input.value).toBe('0')
    expect(screen.getByText('Projection Summary')).toBeInTheDocument()
  })

  it('clamps an astronomically large finite contribution to a safe maximum (AC-2)', () => {
    seedInvestment(1_000_000)
    renderWithProviders(<NetWorthProjectionPage />)
    const input = screen.getByLabelText(/additional annual contribution/i) as HTMLInputElement

    // 1e16 in plain digits (the number input keeps it) would trip the per-year
    // Number.isSafeInteger overflow guard in the core calc → throw → white-screen, pre-fix.
    fireEvent.change(input, { target: { value: '10000000000000000' } })

    expect(input.value).toBe('1000000000') // clamped to MAX_CONTRIBUTION (1e9 units)
    expect(screen.getByText('Projection Summary')).toBeInTheDocument()
  })

  it('reports an overflowing derived principal as "too large", not a white-screen (AC-3, retargeted by story 28-2)', () => {
    // The *derived* starting assets (summed from stored balances) are a vector this
    // story does not sanitize at the input. A single balance is capped by store
    // validation at MAX_SAFE_INTEGER/100 (~9e13 cents), but many valid entries sum past
    // the safe-integer range once compounded. The old compounding model threw here and
    // the route ErrorBoundary caught it; `createNetWorthProjection` has no overflow
    // guard, so the page now detects the condition and says so explicitly. The
    // ErrorBoundary wrapper stays in this test to prove nothing throws past it.
    const NEAR_MAX_CENTS = 90_000_000_000_000 // 9e13, within the store's safe-integer bound
    for (let i = 0; i < 100; i++) {
      seedInvestment(NEAR_MAX_CENTS) // sum ≈ 9e15 → leaves safe-integer range once compounded
    }
    renderWithProviders(
      <ErrorBoundary>
        <NetWorthProjectionPage />
      </ErrorBoundary>
    )

    expect(screen.getByText(/too large to project/i)).toBeInTheDocument()
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument()
    // Precision-corrupted figures must not be rendered alongside the warning.
    expect(screen.queryByText('Projection Summary')).not.toBeInTheDocument()
  })

  it('reports an overflowing income-derived contribution as "too large" (AC-3, retargeted by story 28-2)', () => {
    // Income/expense stores, unlike balances, have NO magnitude cap, so a single absurd
    // income overflows on its own. Kept separate from the balance vector above: this one
    // is the more easily reached of the two.
    useIncomeStore.getState().addIncomeSource({
      name: 'Windfall',
      amount: 1e18, // cents; the derived monthly inflow alone exceeds safe-integer range
      frequency: 'monthly',
    })
    renderWithProviders(
      <ErrorBoundary>
        <NetWorthProjectionPage />
      </ErrorBoundary>
    )

    expect(screen.getByText(/too large to project/i)).toBeInTheDocument()
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Projection Summary')).not.toBeInTheDocument()
  })

  it('distinguishes an unreadable figure from an over-large one (AC-6, review finding)', () => {
    // `validateBalanceTracking` rejects non-integer cents, but the sync applier writes
    // straight to the store without it (`lib/sync/applyServerChanges.ts`), so a corrupt
    // row can reach this page. Reproduce that write path exactly.
    useBalanceStore.setState({
      entries: [
        {
          id: '00000000-0000-4000-8000-000000000000',
          type: 'investment',
          name: 'Corrupt row',
          currentBalance: 10_050.5, // half a cent — never valid
          maxContributionLimit: null,
          monthlyContribution: 0,
          frequency: 'monthly',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          timeline: [],
        },
      ],
    } as unknown as Parameters<typeof useBalanceStore.setState>[0])

    renderWithProviders(
      <ErrorBoundary>
        <NetWorthProjectionPage />
      </ErrorBoundary>
    )

    // $100.50 is not "too large" — telling this user to reduce their balances would send
    // them chasing a problem that does not exist.
    expect(screen.getByText(/could not be read/i)).toBeInTheDocument()
    expect(screen.queryByText(/too large to project/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Projection Summary')).not.toBeInTheDocument()
  })
})

/**
 * NetWorthProjectionPage assets/liabilities separation (story 28-2, FR47).
 *
 * The page fed the *signed net* (`totalInvestments - totalDebts`) as a single principal
 * into a compounder that multiplies the whole balance by `(1 + returnRate)` each year.
 * For a debt-dominated user that multiplied the DEBT: a -$299,000 net worth "grew" to
 * -$588,178 over 10 years at 7%, inventing $289k of debt out of nothing. The page is now
 * routed through the core `createNetWorthProjection` model, which compounds assets only
 * and carries liabilities flat.
 */
describe('NetWorthProjectionPage assets/liabilities separation (story 28-2)', () => {
  beforeEach(() => {
    useBalanceStore.setState({ entries: [] })
    useIncomeStore.setState({ incomeSources: [] })
  })

  afterEach(() => {
    useBalanceStore.setState({ entries: [] })
    useIncomeStore.setState({ incomeSources: [] })
  })

  function seedEntry(type: 'investment' | 'debt', currentBalance: number) {
    useBalanceStore.getState().addBalanceEntry({
      type,
      name: type === 'debt' ? 'Mortgage' : 'Brokerage',
      currentBalance,
      maxContributionLimit: null,
      monthlyContribution: 0,
      frequency: 'monthly',
    })
  }

  /** Read the three Projection Summary figures as plain numbers (allowing a leading `-`). */
  function summaryValues(): number[] {
    const summary = screen.getByText('Projection Summary').closest('section') as HTMLElement
    const valueEls = within(summary).getAllByText((content, el) => {
      return el?.tagName === 'P' && /^-?[\d,]+(?:\.\d+)?$/.test(content.trim())
    })
    return valueEls.map((el) => Number.parseFloat((el.textContent ?? '').replace(/,/g, '')))
  }

  it('does not drive a debt-dominated net worth exponentially more negative (AC-1)', () => {
    seedEntry('investment', 100_000) // $1,000 of assets
    seedEntry('debt', 30_000_000) // $300,000 mortgage — net worth starts at -$299,000

    renderWithProviders(<NetWorthProjectionPage />)

    const values = summaryValues()
    // Guard against a vacuous pass: Math.min([]) is Infinity and would satisfy everything.
    expect(values).toHaveLength(3)

    const worst = Math.min(...values)
    // THE load-bearing bound. This store has no income or expenses, so assets only grow;
    // with liabilities flat, net worth cannot fall below -$300,000 (the liability alone).
    // The old single-principal model compounded the signed net to -$588,178, so any
    // return to geometric behaviour breaks this immediately. (Note the "assets only grow"
    // premise holds *because* this suite seeds no expenses — a spending deficit legitimately
    // draws assets down, and is covered in the core suite's SPENDING_DEFICIT tests.)
    expect(worst).toBeGreaterThanOrEqual(-300_000)
    // And the trajectory must IMPROVE — assets compound while the debt stands still.
    expect(values.at(-1) as number).toBeGreaterThan(values[0] as number)
  })

  it('keeps a debts-only projection flat at the liability (AC-1)', () => {
    seedEntry('debt', 30_000_000) // no assets at all

    renderWithProviders(<NetWorthProjectionPage />)

    const values = summaryValues()
    expect(values).toHaveLength(3)
    // Nothing to compound and nothing to contribute: -$300,000 every single year.
    for (const value of values) {
      expect(value).toBe(-300_000)
    }
  })
})

/**
 * NetWorthProjectionPage focus-ring a11y (story 28-2, AC-7).
 *
 * All three inputs carried `focus:outline-none` plus a ring COLOUR but no ring WIDTH, so
 * they had no visible focus indicator at all — the 4th recurrence of this defect after
 * Epics 15/24 and story 28.1. Kept in its own suite: it is unrelated to the projection
 * model, and filing it under the assets/liabilities tests would invite deletion alongside
 * them and misattribute its failures.
 */
describe('NetWorthProjectionPage focus rings (story 28-2)', () => {
  it('gives all three projection inputs a visible focus ring (AC-7)', () => {
    renderWithProviders(<NetWorthProjectionPage />)

    // Assert token membership, not substring: `focus:ring-purple-500` contains the
    // substring "focus:ring-" and would satisfy a naive `toContain` check.
    for (const label of [/projection period/i, /annual return rate/i, /additional annual/i]) {
      const tokens = (screen.getByLabelText(label).className ?? '').split(/\s+/)
      expect(tokens).toContain('focus:ring-2')
      expect(tokens).toContain('focus:ring-purple-500')
    }
  })
})

/**
 * NetWorthProjectionPage savings inclusion (story 32.2, FR59).
 *
 * Net worth is now `investments + savings − debts` everywhere. On this page that
 * has to be true of BOTH the "Current Net Worth" card and the figure the model
 * projects from — a card showing one starting point while the projection solves
 * from another is the exact failure `RetirementAccumulationPlanner.tsx:311` calls
 * out ("shows one number and solves another").
 *
 * ⚠️ HAND-COMPUTED, currency-less mode:
 *   investments 2,000,000c + savings 300,000c − debts 15,000,000c = −12,700,000c
 *   the pre-32.2 card showed −13,000,000c → "-130,000.00"
 */
describe('NetWorthProjectionPage includes savings (story 32.2)', () => {
  const reset = () => {
    useBalanceStore.setState({ entries: [] })
    useIncomeStore.setState({ incomeSources: [] })
    useSavingsStore.setState({ savingsGoals: [] })
  }

  beforeEach(reset)
  afterEach(reset)

  function seedBalances(): void {
    const add = useBalanceStore.getState().addBalanceEntry
    add({
      type: 'investment',
      name: 'ISA',
      currentBalance: 800_000,
      maxContributionLimit: null,
      monthlyContribution: 0,
      frequency: 'monthly',
    })
    add({
      type: 'investment',
      name: 'Pension',
      currentBalance: 1_200_000,
      maxContributionLimit: null,
      monthlyContribution: 0,
      frequency: 'monthly',
    })
    add({
      type: 'debt',
      name: 'Mortgage',
      currentBalance: 15_000_000,
      maxContributionLimit: null,
      monthlyContribution: 0,
      frequency: 'monthly',
    })
  }

  function seedSavings(): void {
    const add = useSavingsStore.getState().addSavingsGoal
    add({ name: 'Emergency fund', targetAmount: 1_000_000, currentBalance: 250_000 })
    add({ name: 'Rainy day', targetAmount: null, currentBalance: 50_000 })
  }

  it('counts savings in the "Current Net Worth" card (AC-7)', () => {
    seedBalances()
    seedSavings()
    renderWithProviders(<NetWorthProjectionPage />)

    const card = screen.getByTestId('projection-current-net-worth')
    expect(card).toHaveTextContent('-127,000.00')
    expect(card).not.toHaveTextContent('-130,000.00')
  })

  it('projects from the same figure it displays (AC-7)', () => {
    seedBalances()
    seedSavings()
    renderWithProviders(<NetWorthProjectionPage />)

    // Year 0 of the Projection Summary is the model's starting point. If savings
    // reached the card but not `currentAssetsCents`, these two disagree.
    const summary = screen.getByText('Projection Summary').closest('section') as HTMLElement
    const yearZero = within(summary).getByText('Year 0').parentElement as HTMLElement
    expect(yearZero).toHaveTextContent('-127,000.00')
  })

  it('gives a savings-only user a positive current net worth (AC-6)', () => {
    seedSavings()
    renderWithProviders(<NetWorthProjectionPage />)

    expect(screen.getByTestId('projection-current-net-worth')).toHaveTextContent('3,000.00')
  })
})

/**
 * The projection must not go stale when savings change (story 32.2).
 *
 * Savings feed `currentAssetsCents`, so they belong in the `useMemo` dependency
 * list. Omitting them keeps the memoized projection from an earlier render while
 * the "Current Net Worth" card — which is not memoized — updates immediately, so
 * the page shows one figure and projects another. Every other test in this file
 * seeds before the first render and cannot detect that.
 */
describe('NetWorthProjectionPage recomputes when savings change (story 32.2)', () => {
  const reset = () => {
    useBalanceStore.setState({ entries: [] })
    useIncomeStore.setState({ incomeSources: [] })
    useSavingsStore.setState({ savingsGoals: [] })
  }

  beforeEach(reset)
  afterEach(reset)

  it('updates both the card and the projection when a savings balance is added', async () => {
    useBalanceStore.getState().addBalanceEntry({
      type: 'investment',
      name: 'ISA',
      currentBalance: 1_000_000,
      maxContributionLimit: null,
      monthlyContribution: 0,
      frequency: 'monthly',
    })

    renderWithProviders(<NetWorthProjectionPage />)
    expect(screen.getByTestId('projection-current-net-worth')).toHaveTextContent('10,000.00')

    await act(async () => {
      useSavingsStore.getState().addSavingsGoal({
        name: 'Emergency fund',
        targetAmount: null,
        currentBalance: 500_000,
      })
    })

    // Card: 1,000,000 + 500,000 = 1,500,000c
    expect(screen.getByTestId('projection-current-net-worth')).toHaveTextContent('15,000.00')

    // ...and the model's year 0 must move with it, not stay memoized at 10,000.00.
    const summary = screen.getByText('Projection Summary').closest('section') as HTMLElement
    const yearZero = within(summary).getByText('Year 0').parentElement as HTMLElement
    expect(yearZero).toHaveTextContent('15,000.00')
  })
})
