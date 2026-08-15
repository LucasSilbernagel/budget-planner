/**
 * FinancialSummaryReport tests (story 30-3, FR53).
 *
 * ⚠️ These assert the HYDRATED client render. Every persisted store is
 * `skipHydration: true` and rehydrates on mount via `StoreHydration`, so the
 * server render and the first client paint both see EMPTY stores — an SSR or
 * raw-HTML smoke would pass against a report containing nothing at all. The
 * stores are therefore seeded directly with `setState`, exactly as the finance
 * page suites do.
 *
 * ⚠️ `vitest.setup.ts` resets the currency store to `{ mode: 'none', currency:
 * 'NONE' }` before every jsdom test, so the DEFAULT here is currency-less mode,
 * not $/USD. The symbols path is covered by setting the mode explicitly.
 */

import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBalanceStore } from '../../../stores/balanceStore'
import { useCurrencyStore } from '../../../stores/currencyStore'
import { useExpenseStore } from '../../../stores/expenseStore'
import { useIncomeStore } from '../../../stores/incomeStore'
import { useSavingsStore } from '../../../stores/savingsStore'
import { FinancialSummaryReport } from '../FinancialSummaryReport'

const ISO = '2026-01-01T00:00:00.000Z'
const GENERATED_AT = new Date('2026-08-08T12:00:00.000Z')

const incomeRow = (id: string, name: string, amount: number, frequency: string) => ({
  id,
  userId: 0,
  name,
  amount,
  frequency: frequency as 'weekly' | 'biweekly' | 'monthly' | 'annually',
  createdAt: ISO,
  updatedAt: ISO,
})

const balanceRow = (id: string, name: string, type: 'investment' | 'debt', balance: number) => ({
  id,
  type,
  name,
  currentBalance: balance,
  monthlyContribution: 0,
  frequency: 'monthly' as const,
  createdAt: ISO,
  updatedAt: ISO,
})

const savingsRow = (id: string, name: string, target: number | null, current: number) => ({
  id,
  name,
  targetAmount: target,
  currentBalance: current,
  createdAt: ISO,
  updatedAt: ISO,
})

/**
 * The `<dd>` paired with a totals `<dt>`.
 *
 * Totals are queried this way rather than by their text because a figure is
 * legitimately repeated on the page — a single monthly row's entered amount, its
 * normalized amount and the section total are all the same number — so a
 * page-wide `getByText` for the figure is ambiguous by construction and would
 * have to be weakened to `getAllByText`, which asserts far less.
 */
function totalFor(label: string): HTMLElement {
  // Scoped to `dt` because a label can legitimately also be a section heading —
  // "Net worth" is both the <h2> and the total's term.
  const term = screen.getByText(label, { selector: 'dt' })
  return term.nextElementSibling as HTMLElement
}

function clearStores(): void {
  useIncomeStore.setState({ incomeSources: [] })
  useExpenseStore.setState({ expenses: [] })
  useBalanceStore.setState({ entries: [] })
  useSavingsStore.setState({ savingsGoals: [] })
}

/** A representative, fully-populated set of figures used by several tests. */
function seedTypicalData(): void {
  useIncomeStore.setState({
    incomeSources: [
      incomeRow('i1', 'Salary', 500_000, 'monthly'),
      incomeRow('i2', 'Freelance', 10_000, 'weekly'),
    ],
  })
  useExpenseStore.setState({
    expenses: [incomeRow('e1', 'Rent', 150_000, 'monthly')],
  })
  useBalanceStore.setState({
    entries: [
      balanceRow('b1', 'ISA', 'investment', 800_000),
      balanceRow('b2', 'Mortgage', 'debt', 15_000_000),
    ],
  })
  useSavingsStore.setState({
    savingsGoals: [
      savingsRow('s1', 'Emergency fund', 1_000_000, 250_000),
      savingsRow('s2', 'Rainy day', null, 50_000),
    ],
  })
}

const originalFetch = global.fetch

beforeEach(() => {
  vi.clearAllMocks()
  clearStores()
})

afterEach(() => {
  global.fetch = originalFetch
  clearStores()
})

describe('FinancialSummaryReport — content', () => {
  it('renders the monthly-normalized budget totals from the seeded stores', () => {
    seedTypicalData()
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    // 500000×1 + round(10000 × 52/12) = 500000 + 43333 = 543333 cents.
    // Rendered currency-less (the jsdom default), so grouped digits, no symbol.
    expect(totalFor('Monthly income')).toHaveTextContent('5,433.33')
    expect(totalFor('Monthly expenses')).toHaveTextContent('1,500.00')
    // 543333 − 150000 = 393333 cents.
    expect(totalFor('Monthly surplus')).toHaveTextContent('3,933.33')
  })

  it('renders the per-row entered amount alongside its monthly equivalent', () => {
    seedTypicalData()
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    const freelanceRow = screen.getByRole('rowheader', { name: 'Freelance' }).closest('tr')
    expect(freelanceRow).not.toBeNull()
    const cells = within(freelanceRow as HTMLElement).getAllByRole('cell')
    // Entered weekly 100.00 → 433.33 a month.
    expect(cells[0]).toHaveTextContent('100.00')
    expect(cells[1]).toHaveTextContent('Weekly')
    expect(cells[2]).toHaveTextContent('433.33')
  })

  it('renders net worth with savings added and debts subtracted (story 32.2)', () => {
    seedTypicalData()
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    expect(totalFor('Total investments')).toHaveTextContent('8,000.00')
    // The contributing savings figure is printed in the net-worth section too, so
    // the arithmetic on the page reconciles without flipping back to the savings
    // section for the number.
    expect(totalFor('Total savings')).toHaveTextContent('3,000.00')
    expect(totalFor('Total debts')).toHaveTextContent('150,000.00')
    // 800000 + 300000 − 15000000 = −13900000 cents. Savings ADD, debts SUBTRACT.
    expect(totalFor('Net worth')).toHaveTextContent('-139,000.00')
    // The pre-32.2 figure, which omitted savings.
    expect(totalFor('Net worth')).not.toHaveTextContent('-142,000.00')
  })

  it('summarizes a savings-only user instead of claiming they have no net worth (story 32.2)', () => {
    useSavingsStore.setState({
      savingsGoals: [savingsRow('s1', 'Emergency fund', 1_000_000, 250_000)],
    })
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    // Previously this section keyed emptiness on balance rows alone, so a real
    // +2,500.00 net worth was replaced by "there is no net worth to summarize".
    expect(totalFor('Net worth')).toHaveTextContent('2,500.00')
    expect(screen.queryByText(/there is no net worth to summarize/i)).not.toBeInTheDocument()
  })

  it('renders savings progress, and a dash where there is no target', () => {
    seedTypicalData()
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    const accountRow = screen.getByRole('rowheader', { name: 'Rainy day' }).closest('tr')
    const accountCells = within(accountRow as HTMLElement).getAllByRole('cell')
    expect(accountCells[1]).toHaveTextContent('—')
    expect(accountCells[2]).toHaveTextContent('—')

    // The untargeted account is excluded from BOTH sides of progress, so overall
    // is 250000/1000000 = 25% — the same figure `/savings` shows for this data.
    expect(totalFor('Overall progress')).toHaveTextContent('25%')
    expect(totalFor('Total saved')).toHaveTextContent('3,000.00')
  })

  it('stamps the report with the generated date and the currency in effect', () => {
    seedTypicalData()
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)
    expect(
      screen.getByText(/generated 2026-08-08 · amounts shown without a currency symbol/i)
    ).toBeInTheDocument()
  })

  it('formats through the selected currency when symbols mode is on (FR34)', () => {
    useCurrencyStore.setState({ mode: 'symbols', currency: 'USD' })
    seedTypicalData()
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    expect(totalFor('Monthly income')).toHaveTextContent('$5,433.33')
    expect(screen.getByText(/amounts in usd/i)).toBeInTheDocument()
  })
})

describe('FinancialSummaryReport — degenerate data states', () => {
  it('states plainly that there is nothing to report when every store is empty', () => {
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)
    expect(screen.getByText(/there is nothing to report yet/i)).toBeInTheDocument()
    // No bare headings over a wall of zeros.
    expect(screen.queryByRole('heading', { name: 'Budget' })).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('explains an individually empty section while other sections still render', () => {
    useBalanceStore.setState({ entries: [balanceRow('b1', 'ISA', 'investment', 100_000)] })
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    expect(screen.getByRole('heading', { name: 'Budget' })).toBeInTheDocument()
    expect(screen.getByText(/no income or expenses have been added/i)).toBeInTheDocument()
    expect(screen.getByText(/no savings goals or accounts have been added/i)).toBeInTheDocument()
    expect(totalFor('Net worth')).toHaveTextContent('1,000.00')
  })

  it('excludes unreadable rows, discloses the count, and never renders NaN', () => {
    useIncomeStore.setState({
      incomeSources: [
        incomeRow('i1', 'Salary', 500_000, 'monthly'),
        incomeRow('i2', 'Corrupt', 100_000, 'fortnightly'),
      ],
    })
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    expect(screen.getByText(/1 entry could not be read/i)).toBeInTheDocument()
    expect(screen.queryByRole('rowheader', { name: 'Corrupt' })).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/NaN/)
    // Only the readable row is counted — the corrupt 100000c is excluded.
    expect(totalFor('Monthly income')).toHaveTextContent('5,000.00')
  })

  it('renders a break-even budget as break-even, not as a shortfall', () => {
    useIncomeStore.setState({ incomeSources: [incomeRow('i1', 'Salary', 200_000, 'monthly')] })
    useExpenseStore.setState({ expenses: [incomeRow('e1', 'Rent', 200_000, 'monthly')] })
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    expect(screen.getByText('Monthly net (break-even)')).toBeInTheDocument()
    expect(screen.queryByText('Monthly shortfall')).not.toBeInTheDocument()
  })
})

describe('FinancialSummaryReport — unreadable data is disclosed, not hidden', () => {
  it('does NOT claim there is nothing to report when every row is merely unreadable', () => {
    // The worst state this report can be in: real data exists but none of it can
    // be read. The user used to be told "There is nothing to report yet. Add your
    // income…" with no hint anything was dropped, because the disclosure lived in
    // the branch the empty-state check skipped.
    useIncomeStore.setState({
      incomeSources: [incomeRow('i1', 'Salary', 500_000, 'fortnightly')],
    })
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    expect(screen.queryByText(/there is nothing to report yet/i)).not.toBeInTheDocument()
    expect(screen.getByText(/none of your saved entries could be read/i)).toBeInTheDocument()
    expect(screen.getByText(/1 entry could not be read/i)).toBeInTheDocument()
  })

  it('says a section could not be read, rather than that nothing was added', () => {
    // These two lines used to contradict each other on the same page: "No income
    // or expenses have been added" directly above "1 entry could not be read".
    useIncomeStore.setState({
      incomeSources: [incomeRow('i1', 'Salary', 500_000, 'fortnightly')],
    })
    useBalanceStore.setState({ entries: [balanceRow('b1', 'ISA', 'investment', 100_000)] })
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    expect(screen.getByText(/none of the entries saved for this section/i)).toBeInTheDocument()
    expect(screen.queryByText(/no income or expenses have been added/i)).not.toBeInTheDocument()
  })

  it('renders a large multi-page data set without crashing or dropping rows', () => {
    // AC-4 names "large" as a state the RENDERED report must be coherent at; the
    // 120-row case previously existed only at the pure-model layer.
    useIncomeStore.setState({
      incomeSources: Array.from({ length: 120 }, (_, i) =>
        incomeRow(`i${i}`, `Source ${i}`, 1_000, 'monthly')
      ),
    })
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    const incomeTable = screen.getByRole('table', { name: /income/i })
    expect(within(incomeTable).getAllByRole('rowheader')).toHaveLength(120)
    expect(totalFor('Monthly income')).toHaveTextContent('1,200.00')
    expect(document.body.textContent).not.toMatch(/NaN/)
  })
})

describe('FinancialSummaryReport — printing and privacy', () => {
  it('hands the document to the browser print dialog and nothing else', async () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {})
    seedTypicalData()
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    const button = screen.getByRole('button', { name: /print \/ save as pdf/i })
    button.click()

    expect(printSpy).toHaveBeenCalledTimes(1)
    printSpy.mockRestore()
  })

  it('makes NO network request to build or print the report (AC-3, NFR1/NFR2)', () => {
    // The whole privacy claim rests on this: the report is assembled from local
    // stores and printed by the browser, so nothing is transmitted. Asserted,
    // not merely commented.
    const fetchSpy = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })))
    global.fetch = fetchSpy as unknown as typeof global.fetch
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {})

    seedTypicalData()
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)
    screen.getByRole('button', { name: /print \/ save as pdf/i }).click()

    expect(fetchSpy).not.toHaveBeenCalled()
    printSpy.mockRestore()
  })

  it('keeps the print control out of the printed output', () => {
    seedTypicalData()
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    // The print stylesheet hides `[data-print-hide]`; the button must carry it,
    // or the report prints its own button.
    const button = screen.getByRole('button', { name: /print \/ save as pdf/i })
    expect(button.closest('[data-print-hide]')).not.toBeNull()
    // …and must sit OUTSIDE the report article, which is what gets printed.
    expect(button.closest('#financial-summary-report')).toBeNull()
  })

  it('exposes the report subtree under the id the print stylesheet targets', () => {
    seedTypicalData()
    const { container } = render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)
    const article = container.querySelector('#financial-summary-report')
    expect(article).not.toBeNull()
    expect(within(article as HTMLElement).getByRole('heading', { level: 1 })).toHaveTextContent(
      'Financial summary'
    )
  })
})

describe('FinancialSummaryReport — scope (story 30-3, Decision 1)', () => {
  it('does not claim a retirement outlook or a forward projection', () => {
    // Both are driven entirely by ephemeral component state, so a report opened
    // from /settings has no data for them. Claiming either would be inventing
    // the user's assumptions — this pins the exclusion so a later edit cannot
    // reintroduce the claim without failing here.
    //
    // ⚠️ Guards the CLAIM, not the token. The net-worth section legitimately
    // says "This is not a projection" — a bare `not.toMatch(/projection/)`
    // would fail against correct, honest copy, and the instinct would be to
    // delete the disclaimer to make the test pass. So: no section may be ABOUT
    // these things, and no forward-looking figure may be asserted.
    seedTypicalData()
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    expect(
      screen.queryByRole('heading', { name: /retirement|projection|forecast/i })
    ).not.toBeInTheDocument()

    const text = document.body.textContent ?? ''
    // "retirement" has no honest use anywhere in this report.
    expect(text).not.toMatch(/retirement/i)
    expect(text).not.toMatch(/\bforecast/i)
    // No forward-looking claim: nothing is projected, estimated or predicted.
    expect(text).not.toMatch(/\bprojected\b/i)
    expect(text).not.toMatch(/\byears? from now\b/i)
    // And the disclaimer that makes the net-worth figure unambiguous is present.
    expect(screen.getByText(/this is not a projection/i)).toBeInTheDocument()
  })
})

/**
 * Net-worth section copy and disclosure (code review 32.2).
 *
 * The empty-state sentence was rewritten by story 32.2 but pinned by nothing —
 * reverting it to the pre-32.2 wording failed zero tests. And a user whose only
 * savings rows are corrupt was told, as fact, that nothing had been added.
 */
describe('FinancialSummaryReport — net worth copy and savings disclosure (32.2 review)', () => {
  it('names savings in the empty-state sentence', () => {
    // Seed an unrelated section so the report renders its sections at all — with
    // every store empty it shows the whole-document "nothing to report" state and
    // this copy never appears.
    useIncomeStore.setState({ incomeSources: [incomeRow('i1', 'Salary', 500_000, 'monthly')] })
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)
    expect(
      screen.getByText(/no investments, savings or debts have been added/i)
    ).toBeInTheDocument()
    // The superseded wording, which omitted savings from the definition.
    expect(
      screen.queryByText(
        'No investments or debts have been added, so there is no net worth to summarize.'
      )
    ).not.toBeInTheDocument()
  })

  it('discloses savings entries excluded from the net-worth figure', () => {
    useBalanceStore.setState({ entries: [balanceRow('b1', 'ISA', 'investment', 800_000)] })
    useSavingsStore.setState({
      savingsGoals: [savingsRow('s1', 'Corrupt', null, Number.NaN)],
    })
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    expect(
      screen.getByText(/1 savings entry could not be read and is not included in this net worth/i)
    ).toBeInTheDocument()
  })

  it('does not claim nothing was added when the only savings rows are unreadable', () => {
    useSavingsStore.setState({
      savingsGoals: [savingsRow('s1', 'Corrupt', null, Number.NaN)],
    })
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    expect(
      screen.queryByText(/no investments, savings or debts have been added/i)
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(/1 savings entry could not be read and is not included in this net worth/i)
    ).toBeInTheDocument()
  })
})

/**
 * Corrupt-target disclosure in the savings section (32.2 review, decision fix).
 *
 * A row kept for its balance but stripped of an unreadable target renders "—" for
 * both target and progress — visually identical to a genuine no-target account.
 * Without this note the document cannot tell the two apart.
 */
describe('FinancialSummaryReport — corrupt savings targets are disclosed (32.2 review)', () => {
  it('explains that a balance counted but its target could not be read', () => {
    useSavingsStore.setState({
      savingsGoals: [savingsRow('s1', 'Legacy goal', 0, 100_000)],
    })
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    // The money is on the page...
    expect(totalFor('Total saved')).toHaveTextContent('1,000.00')
    // ...and the reason it shows no progress is stated, not left to look like an account.
    expect(
      screen.getByText(
        /target could not be read, so its balance is included but its progress is not shown/i
      )
    ).toBeInTheDocument()
  })

  it('says nothing when every target is readable', () => {
    useSavingsStore.setState({
      savingsGoals: [
        savingsRow('s1', 'Emergency fund', 1_000_000, 250_000),
        savingsRow('s2', 'Rainy day', null, 50_000),
      ],
    })
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    expect(screen.queryByText(/target could not be read/i)).not.toBeInTheDocument()
  })
})
