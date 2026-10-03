/**
 * Every row money figure on the four finance tables breaks only between digit
 * groups (story 91.1, FR146, AC 2 / AC 6).
 *
 * Below `sm` each row cell inherits `overflow-wrap: anywhere`, which split
 * figures inside a group: measured at 320px under CI's font before 91.1,
 * `$12,345,67` / `8.90` (Savings Current Balance) and `$12,345,6` / `78.90`
 * (Balance). The fix is two halves on the figure's element, and this pins both:
 * the `RESPONSIVE_AMOUNT_CLASS` token (`overflow-wrap: normal`) and a
 * `GroupedAmount` inside it (one `<wbr>` straight after each digit-flanked
 * group separator, text unchanged).
 *
 * ⚠️ jsdom computes no layout: this pins the WIRING, never "it fits". The CI
 * screenshots (`income-320-light`, `savings-320-light`, `balance-320-light`)
 * are the layout guard.
 *
 * ⚠️ Every figure is found by ITERATING its column's cells and compared by the
 * exact expected set, never `[0]`: a page that forgot one cell would otherwise
 * pass on the cells it did wire.
 */

import { renderWithProviders } from '@/test/utils'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'
import { useBalanceStore } from '../../stores/balanceStore'
import { useCategoryStore } from '../../stores/categoryStore'
import { useCurrencyStore } from '../../stores/currencyStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { useSavingsStore } from '../../stores/savingsStore'
import { BalancePage } from '../BalancePage'
import { ExpensesPage } from '../ExpensesPage'
import { IncomePage } from '../IncomePage'
import { SavingsPage } from '../SavingsPage'
import { RESPONSIVE_AMOUNT_CLASS } from '../ui/ResponsiveTable'

const premiumTier = vi.hoisted(() => ({
  status: {
    hasAccess: false,
    subscriptionStatus: 'free',
    isLoading: false,
    error: null,
    isAuthenticated: false,
  } as PremiumAccessStatus,
}))

vi.mock('../../hooks/usePremiumAccess', () => ({
  usePremiumAccess: () => ({ status: premiumTier.status }),
}))

function clearStores(): void {
  useIncomeStore.setState({ incomeSources: [] })
  useExpenseStore.setState({ expenses: [] })
  useCategoryStore.setState({ categories: [] })
  useSavingsStore.setState({ savingsGoals: [] })
  useBalanceStore.setState({ entries: [] })
  localStorage.clear()
}

beforeEach(() => {
  clearStores()
  // Symbol mode, USD: the widest rendering, and the seed CI's shots use.
  useCurrencyStore.setState({ mode: 'symbol', currency: 'USD' })
})

afterEach(clearStores)

/** The text runs between `<wbr>`s; a plain string comes back as ONE run. */
function runsOf(el: Element): string[] {
  const out = ['']
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeName === 'WBR') out.push('')
      else if (child.nodeType === Node.TEXT_NODE) out[out.length - 1] += child.textContent ?? ''
      else walk(child)
    }
  }
  walk(el)
  return out
}

const tokens = (value: string | null | undefined): string[] =>
  (value ?? '').split(/\s+/).filter(Boolean)

const AMOUNT_TOKENS = tokens(RESPONSIVE_AMOUNT_CLASS)

/** Whether an element carries EVERY token of the amount class. */
const isAmount = (el: Element): boolean => {
  const own = tokens(el.getAttribute('class'))
  return AMOUNT_TOKENS.length > 0 && AMOUNT_TOKENS.every((t) => own.includes(t))
}

/** Every row cell whose mobile label reads `label`, in row order. */
function cellsLabelled(container: HTMLElement, label: string): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('tbody td')].filter(
    (td) => td.querySelector(':scope > span.uppercase')?.textContent === label
  )
}

/** The one element in a cell carrying the amount class. The mobile label carries
 * the same `overflow-wrap: normal` token (it must not break mid-word either), so
 * it is excluded by being the cell's label, not by its classes. */
function figureIn(td: HTMLElement): HTMLElement {
  const label = td.querySelector(':scope > span.uppercase')
  const figures = [...td.querySelectorAll<HTMLElement>('*')].filter(
    (el) => el !== label && isAmount(el)
  )
  expect(figures, `cell "${td.textContent}" has ${figures.length} amount elements`).toHaveLength(1)
  return figures[0] as HTMLElement
}

interface PageCase {
  name: string
  seed: () => void
  render: () => ReactElement
  /** label → the expected runs of each row's figure, in rendered row order */
  figures: Record<string, string[][]>
}

const CASES: PageCase[] = [
  {
    name: 'Income',
    seed: () => {
      useIncomeStore
        .getState()
        .addIncomeSource({ name: 'Salary', amount: 1_234_567_890, frequency: 'monthly' })
    },
    render: () => <IncomePage />,
    figures: { Amount: [['$12,', '345,', '678.90']] },
  },
  {
    name: 'Expenses',
    seed: () => {
      useExpenseStore
        .getState()
        .addExpense({ name: 'Rent', amount: 987_654_321, frequency: 'monthly' })
    },
    render: () => <ExpensesPage />,
    figures: { Amount: [['$9,', '876,', '543.21']] },
  },
  {
    name: 'Savings',
    seed: () => {
      useSavingsStore.getState().addSavingsGoal({
        name: 'House',
        targetAmount: 5_000_000_000,
        currentBalance: 1_234_567_890,
        allocationMode: 'manual',
        monthlyAllocation: 98_765_400,
      })
    },
    render: () => <SavingsPage />,
    figures: {
      Target: [['$50,', '000,', '000.00']],
      'Current Balance': [['$12,', '345,', '678.90']],
      'Monthly Allocation': [['$987,', '654.00']],
    },
  },
  {
    name: 'Balance',
    seed: () => {
      useBalanceStore.getState().addBalanceEntry({
        type: 'investment',
        name: 'Brokerage',
        currentBalance: 1_234_567_890,
        monthlyContribution: 45_678_900,
        frequency: 'monthly',
      })
    },
    render: () => <BalancePage />,
    figures: {
      'Current Balance/Value': [['$12,', '345,', '678.90']],
      Contribution: [['$456,', '789.00']],
    },
  },
]

describe('row money figures wrap only between digit groups (story 91.1)', () => {
  for (const page of CASES) {
    for (const [label, expectedRuns] of Object.entries(page.figures)) {
      it(`${page.name} › every "${label}" figure is a GroupedAmount inside the amount class`, () => {
        page.seed()
        const { container } = renderWithProviders(page.render())

        const cells = cellsLabelled(container, label)
        expect(cells, `no "${label}" cells rendered on ${page.name}`).toHaveLength(
          expectedRuns.length
        )
        cells.forEach((td, i) => {
          const figure = figureIn(td)
          const runs = expectedRuns[i] as string[]
          // The `<wbr>` sits straight after each group separator, nowhere else.
          expect(runsOf(figure)).toEqual(runs)
          // `<wbr>` carries no text: copy-paste and screen readers read the figure.
          expect(figure.textContent).toBe(runs.join(''))
        })
      })
    }
  }

  // ⚠️ The converse, and the one a "consistency" tidy-up would break: the
  // free-text NAME must keep the cell's inherited `anywhere`. Measured (story
  // 91.1 arm N1): with the amount class on `/income`'s name, the 138-character
  // seeded name overflowed its 240px wrapper by 921px at 320px.
  for (const page of CASES) {
    it(`${page.name} › the free-text Name never carries the amount class`, () => {
      page.seed()
      const { container } = renderWithProviders(page.render())
      const cells = cellsLabelled(container, 'Name')
      expect(cells, `no Name cells rendered on ${page.name}`).toHaveLength(1)
      for (const td of cells) {
        const label = td.querySelector(':scope > span.uppercase')
        // ANY amount token, not all: `overflow-wrap: normal` alone is the revert.
        const carriers = [...td.querySelectorAll('*')].filter(
          (el) =>
            el !== label && tokens(el.getAttribute('class')).some((t) => AMOUNT_TOKENS.includes(t))
        )
        expect(carriers, `${page.name}'s Name cell carries the amount class`).toHaveLength(0)
      }
    })
  }

  it('Savings › "No target" stays plain words inside the same amount element', () => {
    useSavingsStore
      .getState()
      .addSavingsGoal({ name: 'Rainy Day', targetAmount: null, currentBalance: 50_000 })
    const { container } = renderWithProviders(<SavingsPage />)
    const [td] = cellsLabelled(container, 'Target')
    expect(td, 'no Target cell rendered').toBeDefined()
    const figure = figureIn(td as HTMLElement)
    expect(runsOf(figure)).toEqual(['No target'])
  })

  it('Balance › the "Current Balance/Value" label may break after its slash, and still reads whole', () => {
    // Story 91.1 D4: measured at 320px, `BALANCE/VALUE` was the widest
    // unbreakable label (106.5px) and pushed the figure onto two lines.
    useBalanceStore.getState().addBalanceEntry({
      type: 'investment',
      name: 'Brokerage',
      currentBalance: 100_00,
      monthlyContribution: 0,
      frequency: 'monthly',
    })
    const { container } = renderWithProviders(<BalancePage />)
    const [td] = cellsLabelled(container, 'Current Balance/Value')
    const label = td?.querySelector(':scope > span.uppercase') as HTMLElement
    expect(runsOf(label)).toEqual(['Current Balance/', 'Value'])
  })
})
