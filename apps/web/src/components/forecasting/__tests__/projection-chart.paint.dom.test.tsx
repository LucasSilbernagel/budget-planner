import type { ForecastingResult } from '@budget-planner/core'
import { render } from '@testing-library/react'
import { type ReactElement, cloneElement } from 'react'
import { Line } from 'recharts'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCurrencyStore } from '../../../stores/currencyStore'

/**
 * The Projections chart, painted by the REAL chart library (story 97.2, FR158).
 *
 * ⚠️ Recharts renders no SVG under jsdom's 0×0 `ResponsiveContainer`; only that
 * is replaced here, by one handing the chart a fixed 600×400 (the pattern of
 * `RetirementTimelineChart.paint.dom.test.tsx`). Line animation is switched off
 * through `Line.defaultProps`, so the series render without waiting.
 *
 * Pinned: the legend names the scenario; a long name keeps its full text (and
 * `title`) while CSS truncates it; the value axis prints compact labels; the
 * rotated "Net Worth" SVG title is gone (with the X title as positive control).
 * NOT pinned (browser-only, jsdom measures no text): that a label FITS, and
 * Recharts' tick thinning. Those are `97-2-evidence/measure-after.jsonl`.
 */

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children, { width: 600, height: 400 } as never),
  }
})

const { CustomTooltip, ProjectionChart } = await import('../projection-chart')

const LONG = 'Buy a house in the countryside and retire early with the kids'

function row(year: number, netWorth: number) {
  return { year, income: 0, expenses: 0, netIncome: 0, savings: 0, investments: 0, netWorth }
}

/** The seed's 9-digit shape: $53.7M → $310.1M. */
function result(name: string): ForecastingResult {
  return {
    scenario: { name, incomeGrowthRate: 0.03, expenseGrowthRate: 0.02 },
    baseline: [row(1, 5_369_034_260), row(2, 11_869_034_260), row(3, 18_369_034_260)],
    projection: [row(1, 5_369_034_260), row(2, 15_000_000_000), row(3, 31_010_148_369)],
    summary: {
      startingNetWorth: 2_560_000_000,
      endingNetWorth: 31_010_148_369,
      totalGrowth: 28_450_148_369,
      averageAnnualGrowth: 9_483_382_790,
    },
  }
}

/** Narrow for WIDTH queries only (copied from the Retirement paint test). */
function matchNarrow(narrow: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: narrow && /max-width/.test(query),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

const originalMatchMedia = window.matchMedia
const lineDefaults = Line.defaultProps as Record<string, unknown>
const originalAnimation = lineDefaults['isAnimationActive']

beforeAll(() => {
  lineDefaults['isAnimationActive'] = false
})
afterAll(() => {
  lineDefaults['isAnimationActive'] = originalAnimation
})
beforeEach(() => {
  useCurrencyStore.setState({ mode: 'symbol', currency: 'USD' })
})
afterEach(() => {
  window.matchMedia = originalMatchMedia
})

function legendTexts(container: HTMLElement) {
  return [...container.querySelectorAll('.recharts-legend-item-text')] as HTMLElement[]
}

function yTicks(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.recharts-yAxis .recharts-cartesian-axis-tick text')].map(
    (t) => t.textContent ?? ''
  )
}

describe('the legend names the scenario', () => {
  it('reads "Baseline" and the scenario name', () => {
    const { container } = render(<ProjectionChart result={result('Buy a house')} />)
    expect(legendTexts(container).map((t) => t.textContent)).toEqual(['Baseline', 'Buy a house'])
    // The series drew (animation off), so this is the real chart, not a shell.
    expect(container.querySelectorAll('.recharts-line-curve').length).toBe(2)
  })

  it('a long name: full text and title, truncated by CSS only', () => {
    const { container } = render(<ProjectionChart result={result(LONG)} />)
    const scenario = legendTexts(container)[1] as HTMLElement
    // Screen readers get the whole name.
    expect(scenario.textContent).toBe(LONG)
    const label = scenario.querySelector('[title]') as HTMLElement
    expect(label).not.toBeNull()
    expect(label.getAttribute('title')).toBe(LONG)
    expect(label.textContent).toBe(LONG)
    // jsdom computes no layout: pin the class TOKENS that truncate.
    expect(label.className.split(/\s+/)).toEqual(
      expect.arrayContaining(['inline-block', 'truncate', 'align-bottom', 'max-w-[5rem]'])
    )
  })

  it('the legend wrapper has no fixed height, so the plot starts below a wrapped legend', () => {
    // Recharts offsets the plot by the wrapper's measured height; a fixed
    // 36 px let a two-row legend paint over the top tick at 320 px (MEASURED,
    // `97-2-evidence/measure-before.jsonl`). An inline style, so jsdom reads it.
    const { container } = render(<ProjectionChart result={result('Buy a house')} />)
    const wrapper = container.querySelector('.recharts-legend-wrapper') as HTMLElement
    expect(wrapper).not.toBeNull()
    expect(wrapper.style.height).toBe('auto')
  })

  it('the subtitle names the measure and the full scenario name', () => {
    const { getByText } = render(<ProjectionChart result={result(LONG)} />)
    expect(getByText(`Net worth by year: Baseline vs. ${LONG}`)).toBeInTheDocument()
  })
})

describe('the tooltip', () => {
  it('shows a long name in full, wrapping inside a bounded box', () => {
    const { container, getByText } = render(
      <CustomTooltip
        active
        label="2"
        payload={[
          { name: 'Baseline', value: 100, dataKey: 'baselineNetWorth' },
          { name: LONG, value: 200, dataKey: 'scenarioNetWorth' },
        ]}
      />
    )
    const rowEl = getByText(
      (_, el) => el?.tagName === 'P' && el.textContent?.startsWith(LONG) === true
    )
    expect(rowEl.textContent).toBe(`${LONG}: $2.00`)
    expect(rowEl.className.split(/\s+/)).toEqual(expect.arrayContaining(['break-words']))
    const box = container.firstElementChild as HTMLElement
    expect(box.className.split(/\s+/)).toEqual(
      expect.arrayContaining(['max-w-[16rem]', 'whitespace-normal'])
    )
  })
})

for (const narrow of [false, true]) {
  describe(`the value axis (${narrow ? 'narrow' : 'wide'} viewport)`, () => {
    it('prints compact, distinct labels, never full amounts with cents', () => {
      matchNarrow(narrow)
      const { container } = render(<ProjectionChart result={result('Buy a house')} />)
      const ticks = yTicks(container)
      expect(ticks.length).toBeGreaterThanOrEqual(2)
      for (const tick of ticks) expect(tick).toMatch(/^\$\d+(\.\d+)?M$/)
      expect(new Set(ticks).size).toBe(ticks.length)
      // Tick font size follows the chrome selector.
      const tickText = container.querySelector(
        '.recharts-yAxis .recharts-cartesian-axis-tick text'
      ) as Element
      expect(tickText.getAttribute('font-size')).toBe(narrow ? '10' : '12')
    })

    it('has no rotated "Net Worth" title in the SVG', () => {
      matchNarrow(narrow)
      const { container } = render(<ProjectionChart result={result('Buy a house')} />)
      const svgText = container.querySelector('.recharts-surface')?.textContent ?? ''
      // Positive control: the X title is drawn, so the SVG has its labels.
      expect(svgText).toContain('Time (Years)')
      expect(container.querySelector('.recharts-yAxis .recharts-label')).toBeNull()
      expect(svgText).not.toContain('Net Worth')
    })
  })
}
