/**
 * Overview breakdown pies → Recharts `label` wiring (story 36.2, UX-DR41).
 *
 * ⚠️ WHY THIS FILE EXISTS. jsdom gives `ResponsiveContainer` a 0×0 box, so
 * `generateCategoricalChart`'s `validateWidthHeight` rejects it and
 * `PieChart.render()` returns `null` — NO SVG ever reaches the DOM. Measured on
 * this page: 0 `.recharts-sector`, 0 `role="img"`, and the responsive container
 * renders as an empty `<div>`. So a DOM assertion that the in-plot labels are
 * absent passes against labels-ON code and can NEVER fail. `HomePage.tsx`'s own
 * history records the same trap from the other side: code review 32.3 deleted
 * the zero-total guard from the label callback and the whole suite stayed green.
 *
 * Recharts is therefore replaced with prop-capturing stubs, and the assertion is
 * made on what each `<Pie>` was HANDED.
 *
 * ⚠️ This pins the PROP, not the paint. That a real browser paints nothing is
 * `e2e/breakdown-pie-labels.spec.ts`'s job — and it has to be, because Recharts
 * only renders pie labels after its sector animation finishes.
 *
 * ⚠️ Kept in its own file because `vi.mock('recharts')` is module-scoped: doing
 * it in the main HomePage suite would silently convert every test there into a
 * mocked-chart test (the rule `CategoryBreakdown.chart-wiring.test.tsx` states).
 *
 * ⚠️ Known gap, closed elsewhere: `matchMedia` does not exist in jsdom, so
 * `useIsNarrowViewport()` is permanently `false` here and only the DESKTOP
 * branch is ever exercised. A regression to `label={isNarrow}` would pass every
 * assertion below while painting labels at 320px — that is what the 320px case
 * in `e2e/breakdown-pie-labels.spec.ts` exists to catch.
 */

import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'
import { useBalanceStore, useExpenseStore, useIncomeStore, useSavingsStore } from '../../stores'
import { useCategoryStore } from '../../stores/categoryStore'

interface CapturedPie {
  label: unknown
  labelLine: unknown
}

type TooltipFormatter = (value: number, name: string) => [string, string]

const captured = vi.hoisted(() => ({
  pies: [] as CapturedPie[],
  tooltipFormatters: [] as TooltipFormatter[],
}))

const usePremiumAccess = vi.fn()

vi.mock('../../hooks/usePremiumAccess', () => ({
  usePremiumAccess: () => usePremiumAccess(),
}))

vi.mock('recharts', () => {
  const Passthrough = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  return {
    // ⚠️ `ResponsiveContainer` and `PieChart` MUST render their children, or
    // `<Pie>` never mounts and `captured.pies` stays empty. A missing stub does
    // NOT throw — `HomePage.tsx` wraps each chart in an `ErrorBoundary` that
    // swallows React's "Element type is invalid" and renders its fallback — so
    // the symptom of a broken mock is an empty capture, not an exception.
    ResponsiveContainer: Passthrough,
    PieChart: Passthrough,
    Pie: ({ label, labelLine }: CapturedPie) => {
      captured.pies.push({ label, labelLine })
      return null
    },
    // The page also renders up to two `CategoryBarChart`s. Nothing here asserts
    // on them, so their parts can be inert.
    BarChart: Passthrough,
    Bar: () => null,
    CartesianGrid: () => null,
    Cell: () => null,
    // Captured, not inert: the pie Tooltip's `total > 0` guard is the LAST
    // surviving zero-total/NaN% guard on this page, and deleting the pie labels
    // deleted the only tests that pinned its twin. See the zero-total test below.
    Tooltip: ({ formatter }: { formatter?: TooltipFormatter }) => {
      if (formatter) {
        captured.tooltipFormatters.push(formatter)
      }
      return null
    },
    XAxis: () => null,
    YAxis: () => null,
  }
})

const { HomePage } = await import('../HomePage')

const NOW = '2026-01-01T00:00:00.000Z'

function row(id: string, name: string, amount: number) {
  return {
    id,
    userId: 0,
    name,
    amount,
    frequency: 'monthly' as const,
    // Uncategorized rows fall back to their own name (story 30.4b, Decision 10),
    // so distinct names become distinct slices without seeding categories.
    categoryId: null,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  captured.pies.length = 0
  captured.tooltipFormatters.length = 0
  usePremiumAccess.mockReturnValue({
    status: {
      hasAccess: false,
      subscriptionStatus: 'free',
      isLoading: false,
      error: null,
      isAuthenticated: false,
    } satisfies PremiumAccessStatus,
  })
  useSavingsStore.setState({ savingsGoals: [] })
  useBalanceStore.setState({ balanceEntries: [] })
  useCategoryStore.setState({ categories: [] })
  // ⚠️ BOTH pies must have data. `BreakdownPie` short-circuits to its
  // `emptyLabel` placeholder before `<Pie>` when its list is empty, so an
  // unseeded side captures nothing and every assertion below would pass
  // vacuously on a single pie.
  useIncomeStore.setState({
    incomeSources: [row('i1', 'Salary', 500_000), row('i2', 'Freelance', 120_000)],
  })
  useExpenseStore.setState({
    expenses: [row('e1', 'Rent', 200_000), row('e2', 'Groceries', 60_000)],
  })
})

describe('BreakdownPie in-plot slice labels (story 36.2)', () => {
  it('AC-1: hands BOTH pies `label={false}`, so no in-plot text can paint', () => {
    render(<HomePage />)

    // Two pies, income first (`HomePage.tsx` renders the income BreakdownPie
    // before the expense one). Asserting only `[0]` would let one pie stand in
    // for two — the per-surface blind spot stories 30-4b, 33.3, 34.1b and 34.2
    // each hit.
    expect(captured.pies).toHaveLength(2)

    for (const [index, pie] of captured.pies.entries()) {
      // `toBe(false)`, not a truthiness check: `label={undefined}` would also
      // suppress the labels today, but it does so by accident of Recharts'
      // `label && renderLabels(...)` guard rather than by stating the intent.
      expect(pie.label, `pies[${index}].label`).toBe(false)
    }
  })

  it('AC-1: keeps `labelLine={false}` on BOTH pies', () => {
    render(<HomePage />)

    expect(captured.pies).toHaveLength(2)

    for (const [index, pie] of captured.pies.entries()) {
      // Inert while `label` is false — Recharts reads `labelLine` only inside
      // `renderLabels`, which `label && …` never calls. Pinned anyway so that
      // restoring the labels cannot silently also restore the leader lines.
      expect(pie.labelLine, `pies[${index}].labelLine`).toBe(false)
    }
  })
})

/**
 * The zero-total / "NaN%" boundary, re-pinned after story 36.2.
 *
 * ⚠️⚠️ WHY THIS EXISTS. Removing the in-plot labels also removed
 * `pieSliceLabel` and its three tests — and those were the ONLY tests anywhere
 * pinning zero-total behaviour. The identical hazard survives in the pie
 * `<Tooltip>`'s formatter, which carries the twin `total > 0` guard: Recharts
 * derives a share as value/sum, so an all-zero dataset gives 0/0 = NaN and an
 * unguarded formatter reads "NaN%".
 *
 * That branch is reachable — `toPieChartData` keeps zero-value slices, and a 2c
 * monthly expense rounds to 0c at the weekly view (story 32.3 widened it). It is
 * also invisible to the new e2e spec, whose tooltip case seeds a large total and
 * asserts `/%/` — which "NaN%" would satisfy.
 *
 * This is the exact incident code review 32.3 recorded from the other side: the
 * zero-total guard was deleted from the label callback and the whole suite
 * stayed green. Deleting it from the tooltip must not be free.
 */
describe('pie tooltip zero-total guard (story 36.2, re-pinning story 32.3)', () => {
  it('emits no "NaN" when every slice is zero', () => {
    // Non-empty data with a zero total: `BreakdownPie` gates its chart on
    // `data.length`, not on the total, so both pies still render `<Pie>` and
    // hand their `<Tooltip>` a formatter closed over `total === 0`.
    useIncomeStore.setState({
      incomeSources: [row('i1', 'Salary', 0), row('i2', 'Freelance', 0)],
    })
    useExpenseStore.setState({
      expenses: [row('e1', 'Rent', 0), row('e2', 'Groceries', 0)],
    })

    render(<HomePage />)

    // Both pies rendered, so their formatters were captured — otherwise this
    // test would pass by asserting over an empty array.
    expect(captured.pies).toHaveLength(2)
    expect(captured.tooltipFormatters.length).toBeGreaterThanOrEqual(2)

    for (const [index, formatter] of captured.tooltipFormatters.entries()) {
      const [rendered] = formatter(0, 'Groceries')
      expect(rendered, `tooltipFormatters[${index}]`).not.toContain('NaN')
    }
  })
})
