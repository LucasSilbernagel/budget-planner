/**
 * The forecasting headline figures break only between digit groups (story 88.4,
 * FR142, decision D1).
 *
 * The Scenario Builder's "Forecast Summary" stat cards and the Projections tab's
 * summary cards render their value through `GroupedAmount`. Measured in Chromium
 * under CI's font (story 88.4 Dev Agent Record): with the seed's figures
 * (`$310,100,483.69`, 171 px at 18 px semibold) the four-column grid overran its
 * cards by up to 63 px at 768 and 3 px at 1024.
 *
 * ⚠️ jsdom computes no layout: this pins the WIRING (exact text, one `<wbr>`
 * straight after each digit-flanked group separator), never "it fits".
 *
 * The engine is mocked to a fixed summary so every figure is known in advance;
 * the real currency store renders in symbol mode (USD), the widest rendering.
 */

import type { ForecastingResult } from '@budget-planner/core'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCurrencyStore } from '../../../stores/currencyStore'
import { useProfileStore } from '../../../stores/profileStore'
import { ProjectionChart } from '../projection-chart'
import { ScenarioBuilder } from '../scenario-builder'

const SUMMARY = {
  startingNetWorth: 2_556_790_080,
  endingNetWorth: 31_010_048_369,
  totalGrowth: 28_453_258_289,
  averageAnnualGrowth: 2_845_325_829,
}

const point = (netWorth: number) => ({
  year: 1,
  income: 0,
  expenses: 0,
  netIncome: 0,
  savings: 0,
  investments: 0,
  netWorth,
})

const RESULT: ForecastingResult = {
  scenario: { name: 'Scenario', incomeGrowthRate: 0.03, expenseGrowthRate: 0.02 },
  baseline: [point(SUMMARY.startingNetWorth)],
  projection: [point(SUMMARY.endingNetWorth)],
  summary: SUMMARY,
}

vi.mock('@budget-planner/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@budget-planner/core')>()
  return { ...real, calculateFinancialForecast: () => RESULT }
})

vi.mock('../../../lib/chartTheme', () => ({
  useChartColors: () => ({ grid: '#cccccc', axis: '#333333', tooltipText: '#333333' }),
}))

/**
 * The text runs between `<wbr>`s; a plain string comes back as ONE run.
 *
 * Skips the Projections card's change line ("+$…"), which story 116.1 moved
 * INSIDE the `<dd>` as a block span (a `<dl>` group may hold only `<dt>`/`<dd>`):
 * it is a second figure under the headline one, not part of it.
 */
function runsOf(el: Element): string[] {
  const out = ['']
  for (const node of Array.from(el.childNodes)) {
    if (node instanceof HTMLElement && node.matches('dd > span.block')) continue
    if (node.nodeName === 'WBR') out.push('')
    else out[out.length - 1] += node.textContent ?? ''
  }
  return out
}

/** The `<dd>` a card pairs with its `<dt>` label. */
function figureOf(label: string): HTMLElement {
  return screen.getByText(label, { selector: 'dt' }).nextElementSibling as HTMLElement
}

const EXPECTED: [string, string[]][] = [
  ['Starting Net Worth', ['$25,', '567,', '900.80']],
  ['Ending Net Worth', ['$310,', '100,', '483.69']],
  ['Total Growth', ['$284,', '532,', '582.89']],
  ['Avg Annual Growth', ['$28,', '453,', '258.29']],
  // Story 107.1: ending minus the (mocked) one-row baseline, signed.
  ['vs. today', ['+$284,', '532,', '582.89']],
]

beforeEach(() => {
  useCurrencyStore.setState({ mode: 'symbol', currency: 'USD' })
  useProfileStore.setState({ activeProfileId: 'profile-test' })
})

const initialActiveProfileId = useProfileStore.getState().activeProfileId

afterEach(() => {
  useCurrencyStore.setState({ mode: 'none', currency: 'NONE' })
  useProfileStore.setState({ activeProfileId: initialActiveProfileId })
})

describe('forecasting headline figures break only between digit groups (story 88.4)', () => {
  it('the Scenario Builder: the Forecast Summary stat cards (five since story 107.1)', async () => {
    render(<ScenarioBuilder onSave={vi.fn()} />)
    await waitFor(() => expect(figureOf('Ending Net Worth').textContent).toBe('$310,100,483.69'))
    for (const [label, runs] of EXPECTED) {
      expect(runsOf(figureOf(label)), label).toEqual(runs)
    }
    // Story 115.2: the card labels read `.text-body`. `.text-muted` on the
    // blue-100 card was 3.96:1, below AA (tokens, not paint: no Tailwind in jsdom).
    for (const [label] of EXPECTED) {
      const term = screen.getByText(label, { selector: 'dt' })
      expect([...term.classList], label).toContain('text-body')
      expect([...term.classList], label).not.toContain('text-muted')
    }
  })

  it('the Projections tab: the summary cards (five since story 107.1)', () => {
    render(<ProjectionChart result={RESULT} />)
    for (const [label, runs] of EXPECTED) {
      expect(runsOf(figureOf(label)), label).toEqual(runs)
    }
  })
})
