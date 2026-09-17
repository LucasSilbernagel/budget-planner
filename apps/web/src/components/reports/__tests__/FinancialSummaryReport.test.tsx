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
import userEvent from '@testing-library/user-event'
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

// Story 43.4: widened from `'investment' | 'debt'`. A hand-written union in a
// test factory is exactly the kind of two-value assumption the compiler cannot
// connect back to the enum.
const balanceRow = (
  id: string,
  name: string,
  type: 'investment' | 'debt' | 'asset',
  balance: number
) => ({
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

/**
 * The print button's accessible name.
 *
 * ⚠️ A REGEX, not a string: `getByRole`'s `name` is a FULL-STRING match when
 * given a string, so a later label change would turn these queries into throws
 * rather than silent passes — and the repo's standing lesson is the mirror case
 * (an absence probe against a renamed label going quietly green).
 */
const PRINT_BUTTON_NAME = /print \/ save as pdf/i

/**
 * The print buttons, and each one addressed by WHERE IT LIVES (story 56.4).
 *
 * Since 56.4 there are TWO buttons carrying this name — one above the document
 * and one at the end of it — so the singular `getByRole` these tests used
 * throws on multiple matches.
 *
 * ⚠️ They are distinguished by article containment, NEVER by array index.
 * `getAllByRole(...)[0]` binds the assertion to DOM order and reads as an
 * arbitrary number at the call site; `closest('#financial-summary-report')`
 * states the actual distinction — the top button sits outside the printed
 * subtree, the bottom one inside it.
 */
function printButtons(): HTMLElement[] {
  return screen.getAllByRole('button', { name: PRINT_BUTTON_NAME })
}

function topPrintButton(): HTMLElement {
  const button = printButtons().find((element) => !element.closest('#financial-summary-report'))
  if (!button) {
    // An explicit throw, because `find` returns `undefined` and the failure
    // would otherwise surface as a type error on `.click()` — illegible, and
    // indistinguishable from the button having moved.
    throw new Error('No print button outside #financial-summary-report')
  }
  return button
}

function bottomPrintButton(): HTMLElement {
  const button = printButtons().find((element) => element.closest('#financial-summary-report'))
  if (!button) {
    throw new Error('No print button inside #financial-summary-report')
  }
  return button
}

/**
 * An element's class attribute as TOKENS.
 *
 * Membership is asserted against this array, never as a substring of the raw
 * string — a substring match on class names is how a rename turns a real
 * assertion into a silent pass.
 */
function tokensOf(element: Element): string[] {
  return element.className.split(/\s+/)
}

/** Every Tailwind text-align utility. */
const ALIGNMENT_TOKEN = /^text-(left|center|right|justify|start|end)$/

/**
 * The alignment utilities on an element, in class-attribute order.
 *
 * ⚠️ Alignment must be asserted as an EXCLUSIVE set, never as membership.
 * Tailwind emits `.text-left` before `.text-center` before `.text-right` at
 * equal specificity (all single-class), so the LAST one in the stylesheet wins
 * regardless of class-attribute order — a class string that *contains*
 * `text-left` can still render centered or right-aligned.
 *
 * This file contains the existence proof: `TH_NUMERIC_CLASS` is
 * `` `${TH_CLASS} text-right` `` and therefore carries the `text-left` token
 * while rendering right-aligned. A `toContain('text-left')` check would pass on
 * it. Verified by mutation: hoisting `text-center` into `TD_CLASS` re-centers
 * every row header — the exact UX-DR63 defect — and left a membership-based
 * guard at 28/28 green.
 */
function alignmentTokensOf(element: Element): string[] {
  return tokensOf(element).filter((token) => ALIGNMENT_TOKEN.test(token))
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

  /**
   * Story 56.1 (UX-DR61, UX-DR62 as amended): the report renders the user's
   * figures and their date, but no currency note and no privacy disclaimer.
   *
   * The disclaimer lived inside the `data-print-hide` row, so it only ever
   * appeared ON SCREEN — removing it changes the screen, not the printout. The
   * currency note was inside the article and did print.
   *
   * ⚠️ The removals are ABSENCE assertions, and absence is vacuous on its own:
   * with unseeded stores the component renders the "There is nothing to report
   * yet" branch, which satisfies every `not.toMatch` below while proving
   * nothing. So each one seeds real data and anchors on the report having
   * actually rendered — the <h1> plus a figure — before asserting what is gone.
   *
   * ⚠️ The absence regexes are deliberately BROADER than the exact copy that
   * was deleted. Pinning the old sentence verbatim would let the note return
   * under any rewording ("Amounts in $", "No currency symbol shown") while
   * staying green. Verified safe: the word "currency" appears in no remaining
   * rendered string, and the symbols-mode figures render as `$5,433.33` with no
   * `USD` anywhere.
   */
  it('renders the generated-at stamp but no currency note or privacy disclaimer', () => {
    seedTypicalData()
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    // Positive anchor: the report really did render its figures.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Financial summary')
    expect(totalFor('Monthly income')).toHaveTextContent('5,433.33')

    // UX-DR62 as amended: the date is RETAINED — a filed printout has to be
    // datable. It is asserted inside the article, which is what prints.
    const article = document.querySelector('#financial-summary-report') as HTMLElement
    expect(within(article).getByText(/generated 2026-08-08/i)).toBeInTheDocument()

    expect(document.body.textContent).not.toMatch(/currency/i)
    expect(document.body.textContent).not.toMatch(/amounts\b/i)
    expect(document.body.textContent).not.toMatch(/nothing is sent anywhere to produce it/i)
  })

  it('formats through the selected currency when symbols mode is on (FR34)', () => {
    useCurrencyStore.setState({ mode: 'symbols', currency: 'USD' })
    seedTypicalData()
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    expect(totalFor('Monthly income')).toHaveTextContent('$5,433.33')

    // Story 56.1: the currency note is gone in SYMBOLS mode too — the branch
    // the currency-less test above cannot reach — while the date survives in
    // both modes.
    expect(document.body.textContent).not.toMatch(/currency/i)
    expect(document.body.textContent).not.toMatch(/amounts\b/i)
    expect(document.body.textContent).not.toMatch(/\bUSD\b/i)
    expect(screen.getByText(/generated 2026-08-08/i)).toBeInTheDocument()
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

/**
 * Row-header alignment (story 56.2, UX-DR63).
 *
 * `TH_CLASS` gives every COLUMN header `text-left`, but the row-header cells
 * (`<th scope="row">`) carried only `${TD_CLASS} font-normal`. Neither
 * Tailwind's Preflight (zero `text-align` declarations, no `th` reset — unlike
 * Bootstrap) nor `global.css` resets the UA default, so those cells rendered
 * CENTERED beneath a left-aligned header. The defect was at all three
 * `scope="row"` call sites: `CashflowTable`, the savings goals table and
 * `BalanceTable`.
 *
 * ⚠️ THIS IS A CLASS-TOKEN PIN, NOT A LAYOUT PROOF — the repo's accepted idiom
 * (see the print-row guard above). jsdom computes no layout, and here it is
 * worse than that: measured, jsdom returns `textAlign: ""` for BOTH a column
 * `<th>` and a row `<th>` (it models `th { font-weight: bold }` but not the
 * centering), and `vitest.config.ts` sets no `css` option while
 * `vitest.setup.ts` never imports `global.css`, so no Tailwind utility exists
 * in this environment at all. A `getComputedStyle(th).textAlign` assertion
 * would read `""` before AND after the fix — a guard that cannot fail. The
 * computed-style proof lives in `e2e/report-print.spec.ts`, where the real
 * stylesheet loads.
 *
 * ⚠️ Pins BOTH SIDES to `text-left`, not just the rows. A rows-only check would
 * stay green if a later edit centered the COLUMN header instead — the same
 * misalignment, mirrored. (It pins each side to the literal rather than
 * comparing them to each other: two cells that agree on `text-center` would be
 * mutually aligned but still wrong against `TH_CLASS`'s documented intent.)
 *
 * ⚠️ EXCLUSIVITY, not membership — see `alignmentTokensOf`. Asserting merely
 * that `text-left` is present accepts a class string that also carries
 * `text-center`, which renders centered because Tailwind emits the competing
 * utility later at equal specificity. That hole was real in this guard's first
 * version and is now covered by arm M5.
 */
describe('FinancialSummaryReport — table column alignment (story 56.2, UX-DR63)', () => {
  it('left-aligns every row-header cell to match its column header', () => {
    seedTypicalData()
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    const tables = screen.getAllByRole('table')
    // ⚠️ Non-vacuity. `getAllByRole` throws on zero matches, but a loop over a
    // one-table render would silently assert far less than this claims to.
    // `seedTypicalData()` yields exactly five: Income, Expenses (CashflowTable),
    // Investments, Debts (BalanceTable) and Goals and accounts.
    expect(tables).toHaveLength(5)

    for (const table of tables) {
      const caption = table.querySelector('caption')?.textContent ?? '(no caption)'

      // The Name column is first in all three renderers.
      const columnHeader = within(table).getAllByRole('columnheader')[0]
      expect(alignmentTokensOf(columnHeader), `${caption}: first column header`).toEqual([
        'text-left',
      ])

      // ⚠️ `queryAllByRole`, not `getAllByRole`: the getter THROWS on zero
      // matches, which would make the count assertion below unreachable —
      // a non-vacuity check that could itself never fail.
      const rowHeaders = within(table).queryAllByRole('rowheader')
      expect(rowHeaders.length, `${caption}: row header count`).toBeGreaterThan(0)
      for (const cell of rowHeaders) {
        expect(alignmentTokensOf(cell), `${caption}: row header "${cell.textContent}"`).toEqual([
          'text-left',
        ])
      }
    }
  })
})

describe('FinancialSummaryReport — printing and privacy', () => {
  it('hands the document to the browser print dialog and nothing else', async () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {})
    seedTypicalData()
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    topPrintButton().click()

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
    topPrintButton().click()

    expect(fetchSpy).not.toHaveBeenCalled()
    printSpy.mockRestore()
  })

  it('keeps the top print control out of the printed output', () => {
    seedTypicalData()
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    // The print stylesheet hides `[data-print-hide]`; the button must carry it,
    // or the report prints its own button.
    const button = topPrintButton()
    expect(button.closest('[data-print-hide]')).not.toBeNull()
    // …and this one must sit OUTSIDE the report article, which is what gets
    // printed.
    //
    // ⚠️ Scoped to the TOP button since story 56.4. "Print controls live
    // outside the printed subtree" was true of the only control that existed
    // when this was written; the bottom button deliberately sits inside the
    // article and relies on `data-print-hide` alone, exactly as 56.3's period
    // control does. The invariant is now per-button — see the 56.4 block below,
    // which asserts the other half rather than leaving it unstated.
    expect(button.closest('#financial-summary-report')).toBeNull()
  })

  it('keeps the print control at the end of its row now that it stands alone', () => {
    // Story 56.1 removed the disclaimer that used to sit opposite this button.
    // `justify-between` on a single child silently left-aligns it, so the row
    // was switched to `justify-end`. Nothing else pins button placement.
    //
    // ⚠️ The row is addressed DIRECTLY, not via the button's `parentElement`.
    // Story 56.4 has since added the second "Print / Save as PDF" button this
    // anticipated: `getByRole(..., { name })` now throws on multiple matches,
    // and the obvious repair (`getAllByRole(...)[0]`) would have quietly handed
    // the placement assertion to whoever wrote it. Querying the row directly is
    // child-count-agnostic, so this guard survived that story untouched — and
    // it still resolves to the TOP row, because `querySelector` returns the
    // first `[data-print-hide]` in document order and 56.4's row comes last.
    // The bottom row has its own guard in the 56.4 block below.
    //
    // ⚠️ This is a class-TOKEN pin, not a layout proof — jsdom computes no
    // layout. `flex` is asserted alongside `justify-end` because `justify-*` is
    // inert outside a flex/grid container, and `justify-between` is asserted
    // absent so the exact regression this replaced cannot come back.
    seedTypicalData()
    const { container } = render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    const row = container.querySelector('[data-print-hide]') as HTMLElement
    expect(row).not.toBeNull()
    const tokens = row.className.split(/\s+/)
    expect(tokens).toEqual(expect.arrayContaining(['flex', 'justify-end']))
    expect(tokens).not.toContain('justify-between')
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

describe('FinancialSummaryReport — bottom print button (story 56.4, FR83)', () => {
  it('offers a second print button at the end of the document (AC-1, AC-4)', () => {
    seedTypicalData()
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    // Exactly two: a third would mean a stray copy, and one would mean the
    // feature is gone. Both halves matter, so the count is asserted rather
    // than merely "more than one".
    expect(printButtons()).toHaveLength(2)

    // The bottom one comes AFTER the Savings section in document order — it is
    // the end-of-document affordance, not a duplicate of the top control.
    // `compareDocumentPosition` reads the real DOM order rather than trusting
    // the order `getAllByRole` happened to return.
    //
    // ⚠️ `& DOCUMENT_POSITION_FOLLOWING` ALONE IS NOT ENOUGH, and that is the
    // whole reason for the second assertion. The DOM returns
    // `CONTAINED_BY | FOLLOWING` (20) for a DESCENDANT, so the FOLLOWING bit is
    // set for a button nested INSIDE the Savings section too — which would put
    // it on a `.surface` card mid-document, `dark:bg-gray-800` on
    // `dark:bg-gray-800`. Found independently by all three review layers,
    // 2026-09-17. Asserting `closest('section')` is null is what makes this a
    // claim about the end of the document rather than "somewhere after the
    // Savings heading".
    const savings = screen.getByRole('heading', { name: 'Savings' }).closest('section')
    expect(savings).not.toBeNull()
    const button = bottomPrintButton()
    expect(
      (savings as HTMLElement).compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(button.closest('section')).toBeNull()
  })

  it('gives the bottom button the same row shape as the top one (AC-6)', () => {
    seedTypicalData()
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    // ⚠️ 56.1's placement guard does NOT cover this row: it reaches the row via
    // `container.querySelector('[data-print-hide]')`, which is the FIRST match
    // in document order — always the top row. Without this test, dropping
    // `${PRINT_ROW_CLASS}` from the bottom wrapper leaves all other guards
    // green while the button silently left-aligns, which is exactly the
    // UX-DR61 regression 56.1 fixed on the top row.
    const row = bottomPrintButton().closest('[data-print-hide]') as HTMLElement
    expect(row).not.toBeNull()
    const tokens = tokensOf(row)
    expect(tokens).toEqual(expect.arrayContaining(['flex', 'justify-end']))
    // `justify-*` is inert outside a flex/grid container, so `flex` above is
    // load-bearing; and the container the disclaimer once needed must not come
    // back here either.
    expect(tokens).not.toContain('justify-between')
  })

  it('renders the bottom button in the all-unreadable branch too (AC-5)', () => {
    // The third state of the gating ternary: rows EXIST but none can be read,
    // so `isEmpty` is true while `totalUnreadableCount > 0` — the document
    // still renders its sections, so it still ends with a print control.
    // Without this the gate could be narrowed to "the budget has rows" and
    // nothing would go red.
    useIncomeStore.setState({
      incomeSources: [incomeRow('i1', 'Corrupt', 100_000, 'fortnightly')],
    })
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    expect(screen.getByText(/none of your saved entries could be read/i)).toBeInTheDocument()
    expect(printButtons()).toHaveLength(2)
  })

  it('hands the document to the print dialog from the bottom button too (AC-4)', () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {})
    seedTypicalData()
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    // ⚠️ The BOTTOM button specifically. The existing guard above proves only
    // the top one calls `print()`; a bottom button wired to nothing would sail
    // through it.
    bottomPrintButton().click()

    expect(printSpy).toHaveBeenCalledTimes(1)
    printSpy.mockRestore()
  })

  it('keeps the bottom button off paper while sitting inside the article (AC-2)', () => {
    seedTypicalData()
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    const button = bottomPrintButton()
    // `global.css` hides `[data-print-hide]` under `@media print`, and that
    // rule is global — it applies inside the printed subtree too, which is
    // what 56.3's period control already relies on. Without the attribute this
    // button prints itself onto the user's own report.
    expect(button.closest('[data-print-hide]')).not.toBeNull()
    // Non-vacuity: this really is the in-article one, so the assertion above
    // is about the new button and not a second reading of the top row.
    expect(button.closest('#financial-summary-report')).not.toBeNull()
  })

  it('does not repeat itself on a report with nothing to print (AC-5)', () => {
    // Every store empty → "There is nothing to report yet". There is nothing
    // to scroll past, so a second print button would sit centimetres below the
    // first. `queryAllByRole` because the getter throws on zero matches, which
    // would fail for the wrong reason if the count ever hit 0.
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    expect(screen.getByText(/there is nothing to report yet/i)).toBeInTheDocument()
    expect(screen.queryAllByRole('button', { name: PRINT_BUTTON_NAME })).toHaveLength(1)
  })

  it('still offers both buttons when the sections exist but hold no figures (AC-5)', () => {
    // The other branch: a report whose every section renders its own empty
    // copy still renders the document, so the end-of-document button belongs
    // there. Without this, "gated on content" could have shipped as "gated on
    // the budget having rows".
    useBalanceStore.setState({ entries: [balanceRow('b1', 'ISA', 'investment', 100_000)] })
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    expect(screen.getByText(/no income or expenses have been added/i)).toBeInTheDocument()
    expect(printButtons()).toHaveLength(2)
  })

  it('renders the two buttons with identical class attributes (AC-6)', () => {
    seedTypicalData()
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    // Non-vacuity first: two EMPTY class attributes would also compare equal,
    // and a failure here should read as "the classes vanished", not as a
    // divergence.
    expect(topPrintButton().className).toMatch(/\S/)
    // Equality, not a token spot-check: focus ring, dark-mode variants, border
    // and padding all have to match, and enumerating them would pin some while
    // leaving the rest free to drift.
    //
    // ⚠️ What this observes is EQUALITY, not a single source. Two byte-identical
    // literals pass it just as well; `PRINT_BUTTON_CLASS` is what keeps them
    // equal, and only the component can state that. The title says what the
    // assertion sees.
    expect(bottomPrintButton().className).toBe(topPrintButton().className)
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
      screen.getByText(/no investments, savings, assets or debts have been added/i)
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

describe('FinancialSummaryReport — assets are printed, not just counted (Story 43.4, FR70)', () => {
  it('renders an Assets table and a Total assets row that reconcile with net worth', () => {
    // ⚠️ This test exists because the rendered Assets table and Total assets row
    // could be DELETED with the whole suite staying green: the model-level tests
    // in `build-financial-summary.test.ts` pin `totalAssetsCents`, not the render.
    // On a printed page the user keeps, that would show component rows that do not
    // add up to the net-worth figure beneath them — the exact reconciliation
    // failure the surrounding code comments say those rows exist to prevent.
    useBalanceStore.setState({
      entries: [
        balanceRow('b1', 'ISA', 'investment', 5_000_000),
        balanceRow('b2', 'Condo', 'asset', 40_000_000),
        balanceRow('b3', 'Mortgage', 'debt', 30_000_000),
      ],
    })

    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    // The asset appears BY NAME in its own captioned table...
    expect(screen.getByText('Assets')).toBeInTheDocument()
    expect(screen.getByText('Condo')).toBeInTheDocument()

    // ...and as its own total line. Hand-computed: 5,000,000 + 0 savings
    // + 40,000,000 − 30,000,000 = 15,000,000.
    const totalAssets = screen.getByText('Total assets')
    expect(totalAssets.parentElement).toHaveTextContent('400,000.00')
    // `Net worth` appears more than once on the page (section heading + total
    // row), so match the row that carries the figure rather than using a bare
    // getByText — an ambiguous selector fails for the wrong reason.
    const netWorthRows = screen.getAllByText('Net worth')
    expect(netWorthRows.some((el) => el.parentElement?.textContent?.includes('150,000.00'))).toBe(
      true
    )
  })

  it('does not report a valid asset row as unreadable', () => {
    // Before FR70 widened `KNOWN_FINANCE_TYPES`, an asset failed `isReadableBalance`
    // — excluded from net worth AND counted into the "could not be read" disclosure,
    // so the report accused the user's own freshly-entered condo of being corrupt.
    useBalanceStore.setState({ entries: [balanceRow('b1', 'Condo', 'asset', 40_000_000)] })

    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    expect(screen.queryByText(/could not be read/i)).toBeNull()
    const netWorthRows = screen.getAllByText('Net worth')
    expect(netWorthRows.some((el) => el.parentElement?.textContent?.includes('400,000.00'))).toBe(
      true
    )
  })
})

/**
 * Budget period toggle (story 56.3, FR84).
 *
 * The Budget section can be read as monthly or annual figures. Only the
 * DERIVED column and the three section totals respond; the entered Amount and
 * Frequency columns, and the Net Worth and Savings sections, do not.
 *
 * ⚠️ EVERY ASSERTION HERE MUST CROSS A STATE CHANGE. The default is monthly —
 * today's only behaviour — so a render-only test passes against a component
 * that has no toggle at all, and against one whose toggle is wired to nothing.
 * The switch is driven through `user.selectOptions` on the real control rather
 * than by reaching for a setter, so the control and the conversion are proven
 * wired to each other.
 *
 * ⚠️ NON-VACUITY. A switch that threw would unmount the figures and leave a
 * page on which most `queryBy`/absence-shaped checks still pass. Each test
 * therefore re-anchors on the report having actually rendered — the <h1> plus
 * one concrete figure — AFTER the switch, not just before it.
 *
 * ⚠️ The annual expectations are LITERALS, hand-computed from
 * `seedTypicalData()`'s known monthly figures (×12), never recomputed in the
 * test the same way the component computes them. Figures render currency-less
 * (the jsdom default, see the file header), so grouped digits and no symbol.
 */
describe('FinancialSummaryReport — Budget period toggle (story 56.3, FR84)', () => {
  /**
   * ⚠️ A REGEX, not a string. `getByRole`'s `name` option is a FULL-STRING
   * match when given a string, so a later label rename would turn every query
   * here into a throw rather than a silent pass — but the repo's standing
   * lesson is the mirror case (an absence probe against a renamed label going
   * silently green), and a regex keeps this robust to trailing punctuation.
   */
  function periodControl(): HTMLSelectElement {
    return screen.getByRole('combobox', { name: /show the budget per/i }) as HTMLSelectElement
  }

  /** The Nth `columnheader` of the named table. */
  function columnHeaders(tableName: RegExp): HTMLElement[] {
    return within(screen.getByRole('table', { name: tableName })).getAllByRole('columnheader')
  }

  /** The data cells of the row whose row-header is `name`. */
  function cellsOfRow(name: string): HTMLElement[] {
    const row = screen.getByRole('rowheader', { name }).closest('tr')
    expect(row).not.toBeNull()
    return within(row as HTMLElement).getAllByRole('cell')
  }

  /** Re-anchor after a switch: the report really is still rendering figures. */
  function expectReportStillRendered(): void {
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Financial summary')
    expect(screen.getAllByRole('table').length).toBeGreaterThan(0)
  }

  /**
   * ⚠️ Title says "figures and labels", NOT "byte-for-byte" — the default
   * render is NOT byte-identical to the pre-56.3 document: it gained a heading
   * wrapper, a `data-print-hide` div, a `<label>`, an `sr-only` span and a
   * `<select>`. The original title claimed an identity these assertions do not
   * and cannot make (code review 2026-09-17, raised independently by two
   * layers). What IS unchanged, and what this pins, is every figure and label.
   */
  it('defaults to monthly, leaving the figures and labels unchanged (AC-1)', () => {
    seedTypicalData()
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    expect(periodControl().value).toBe('monthly')
    expect(columnHeaders(/income/i)[3]).toHaveTextContent('Monthly')
    expect(totalFor('Monthly income')).toHaveTextContent('5,433.33')
    expect(totalFor('Monthly expenses')).toHaveTextContent('1,500.00')
    expect(totalFor('Monthly surplus')).toHaveTextContent('3,933.33')
    // The normalization note keeps 56.1's exact monthly wording by default.
    expect(
      screen.getByText(/every entry is converted to a monthly figure so the totals are comparable/i)
    ).toBeInTheDocument()
  })

  /**
   * The section's explanatory note must not contradict the column above it.
   * Under Annual it used to read "converted to a monthly figure" beside a
   * column headed "Annual" — and it PRINTS, while the control explaining it is
   * `data-print-hide`, so the paper offered no cue.
   */
  it('re-words the conversion note so the printed page cannot contradict itself', async () => {
    const user = userEvent.setup()
    seedTypicalData()
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    await user.selectOptions(periodControl(), 'annually')
    expectReportStillRendered()

    const article = document.querySelector('#financial-summary-report') as HTMLElement
    expect(within(article).getByText(/converted to a yearly figure/i)).toBeInTheDocument()
    expect(within(article).queryByText(/converted to a monthly figure/i)).not.toBeInTheDocument()

    // ⚠️ The new copy must still clear 56.1's reserved words, in this branch
    // too — the existing guards only ever render the MONTHLY wording.
    expect(document.body.textContent).not.toMatch(/currency/i)
    expect(document.body.textContent).not.toMatch(/amounts\b/i)
  })

  it('annualizes the derived column and all three totals when switched (AC-3, AC-4)', async () => {
    const user = userEvent.setup()
    seedTypicalData()
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    await user.selectOptions(periodControl(), 'annually')
    expectReportStillRendered()

    // Column header flips — scoped to the table, because the option list also
    // contains the word and a page-wide getByText would match it instead.
    expect(columnHeaders(/income/i)[3]).toHaveTextContent('Annual')
    expect(columnHeaders(/expenses/i)[3]).toHaveTextContent('Annual')

    // Per-row derived figures: monthly ×12, as literals.
    // Salary   500,000c/mo → 6,000,000c   Freelance 43,333c/mo → 519,996c
    expect(cellsOfRow('Salary')[2]).toHaveTextContent('60,000.00')
    expect(cellsOfRow('Freelance')[2]).toHaveTextContent('5,199.96')

    // Totals relabel AND revalue. 543,333×12 / 150,000×12 / 393,333×12.
    expect(totalFor('Annual income')).toHaveTextContent('65,199.96')
    expect(totalFor('Annual expenses')).toHaveTextContent('18,000.00')
    expect(totalFor('Annual surplus')).toHaveTextContent('47,199.96')

    // The monthly labels are GONE, not merely joined by annual ones.
    expect(screen.queryByText('Monthly income', { selector: 'dt' })).not.toBeInTheDocument()
  })

  it('leaves the entered Amount and Frequency columns untouched (AC-5)', async () => {
    const user = userEvent.setup()
    seedTypicalData()
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    // Entered weekly 100.00, which is NOT what the derived column shows.
    expect(cellsOfRow('Freelance')[0]).toHaveTextContent('100.00')
    expect(cellsOfRow('Freelance')[1]).toHaveTextContent('Weekly')

    await user.selectOptions(periodControl(), 'annually')
    expectReportStillRendered()

    // Unchanged — these state what the user typed, at the cadence they typed it.
    expect(cellsOfRow('Freelance')[0]).toHaveTextContent('100.00')
    expect(cellsOfRow('Freelance')[1]).toHaveTextContent('Weekly')
    // …while the derived column beside them DID move, so this is not a test of
    // a component that ignored the switch entirely.
    expect(cellsOfRow('Freelance')[2]).toHaveTextContent('5,199.96')
  })

  it('keeps the status word when relabelling a break-even budget (AC-4)', async () => {
    const user = userEvent.setup()
    useIncomeStore.setState({ incomeSources: [incomeRow('i1', 'Salary', 200_000, 'monthly')] })
    useExpenseStore.setState({ expenses: [incomeRow('e1', 'Rent', 200_000, 'monthly')] })
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    expect(screen.getByText('Monthly net (break-even)')).toBeInTheDocument()

    await user.selectOptions(periodControl(), 'annually')
    expectReportStillRendered()

    // Only the PERIOD word changes. A story that rebuilt this label from
    // scratch would most likely drop the "(break-even)" qualifier.
    expect(screen.getByText('Annual net (break-even)')).toBeInTheDocument()
    expect(screen.queryByText('Annual shortfall')).not.toBeInTheDocument()
    expect(screen.queryByText('Annual surplus')).not.toBeInTheDocument()
  })

  it('keeps the status word when relabelling a deficit budget (AC-4)', async () => {
    const user = userEvent.setup()
    useIncomeStore.setState({ incomeSources: [incomeRow('i1', 'Salary', 100_000, 'monthly')] })
    useExpenseStore.setState({ expenses: [incomeRow('e1', 'Rent', 200_000, 'monthly')] })
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    expect(screen.getByText('Monthly shortfall')).toBeInTheDocument()

    await user.selectOptions(periodControl(), 'annually')
    expectReportStillRendered()

    expect(screen.getByText('Annual shortfall')).toBeInTheDocument()
    // −100,000c/mo × 12.
    expect(totalFor('Annual shortfall')).toHaveTextContent('-12,000.00')
  })

  it('leaves the Net Worth and Savings sections alone (AC-6)', async () => {
    const user = userEvent.setup()
    seedTypicalData()
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    const before = {
      netWorth: totalFor('Net worth').textContent,
      investments: totalFor('Total investments').textContent,
      saved: totalFor('Total saved').textContent,
      progress: totalFor('Overall progress').textContent,
    }
    // Non-vacuity: these are real figures, not empty strings being compared.
    expect(before.netWorth).toMatch(/-139,000\.00/)
    expect(before.saved).toMatch(/3,000\.00/)

    await user.selectOptions(periodControl(), 'annually')
    expectReportStillRendered()
    // The Budget section really did respond, so this is not a no-op switch.
    expect(totalFor('Annual income')).toHaveTextContent('65,199.96')

    expect(totalFor('Net worth').textContent).toBe(before.netWorth)
    expect(totalFor('Total investments').textContent).toBe(before.investments)
    expect(totalFor('Total saved').textContent).toBe(before.saved)
    expect(totalFor('Overall progress').textContent).toBe(before.progress)
  })

  it('keeps the control off the printed page while the figures print (AC-7)', () => {
    seedTypicalData()
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    // ⚠️ Reached via the CONTROL, not `querySelector('[data-print-hide]')` —
    // that returns the print-button row (first in document order) and would
    // assert nothing whatsoever about this element.
    const hidden = periodControl().closest('[data-print-hide]')
    expect(hidden).not.toBeNull()

    // …and unlike the print button, the control lives INSIDE the article, so
    // the section it governs still prints with the selected figures.
    expect(periodControl().closest('#financial-summary-report')).not.toBeNull()
  })

  /**
   * Round-trip fidelity (code review 2026-09-17, Blind Hunter HIGH).
   *
   * `monthlyCents` is a ROUNDED intermediate, so re-expressing it at the row's
   * OWN entered cadence is lossy whenever the entered cents are not divisible
   * by 12. Before the fix this rendered "100.00 | Annually | 99.96" — one row
   * disagreeing with itself by four cents, on a document users print and file.
   *
   * ⚠️ THE FIXTURE IS THE WHOLE TEST. Round numbers hide this completely:
   * 1,200.00/Annually round-trips exactly (÷12 = 10,000c, ×12 = 1,200.00), and
   * a suite seeded only with round figures — as this file's `seedTypicalData`
   * is — passes against the defect. Both amounts below are chosen because they
   * do NOT survive the round trip: 10,000c → 833c → 9,996c (−4), and
   * 100,001c → 8,333c → 99,996c (−5).
   */
  it('shows the entered figure when the period IS the row’s own cadence', async () => {
    const user = userEvent.setup()
    useIncomeStore.setState({
      incomeSources: [
        incomeRow('i1', 'Insurance', 10_000, 'annually'),
        incomeRow('i2', 'Bonus', 100_001, 'annually'),
        // A control on a DIFFERENT cadence: this one must still convert.
        incomeRow('i3', 'Freelance', 10_000, 'weekly'),
      ],
    })
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    await user.selectOptions(periodControl(), 'annually')
    expectReportStillRendered()

    // The user typed these exact annual figures; the Annual column must agree.
    expect(cellsOfRow('Insurance')[2]).toHaveTextContent('100.00')
    expect(cellsOfRow('Bonus')[2]).toHaveTextContent('1,000.01')
    // …and the pre-fix values must NOT come back.
    expect(cellsOfRow('Insurance')[2]).not.toHaveTextContent('99.96')
    expect(cellsOfRow('Bonus')[2]).not.toHaveTextContent('999.96')

    // ⚠️ NON-VACUITY / SCOPE: a weekly row has no entered annual figure, so it
    // still converts. Without this the fix could have been "never convert".
    expect(cellsOfRow('Freelance')[2]).toHaveTextContent('5,199.96')

    // And in the MONTHLY view nothing changed for any of them.
    await user.selectOptions(periodControl(), 'monthly')
    expect(cellsOfRow('Insurance')[2]).toHaveTextContent('8.33')
    expect(cellsOfRow('Freelance')[2]).toHaveTextContent('433.33')
  })

  it('is absent when the budget has no figures to re-express', () => {
    // A period control over "No income or expenses have been added" is an
    // affordance that does nothing. Only a seeded balance here, so the Budget
    // section renders its empty branch while other sections still show.
    useBalanceStore.setState({ entries: [balanceRow('b1', 'ISA', 'investment', 100_000)] })
    render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

    expect(screen.getByRole('heading', { name: 'Budget' })).toBeInTheDocument()
    expect(screen.getByText(/no income or expenses have been added/i)).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: /show the budget per/i })).not.toBeInTheDocument()
  })
})
