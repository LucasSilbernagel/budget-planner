// @vitest-environment node
// Pure helpers only: no DOM (the `components/**` glob would give it jsdom).
import type { ForecastingResult } from '@budget-planner/core'
import { describe, expect, it } from 'vitest'
import {
  SCENARIO_FALLBACK_NAME,
  formatProjectionAxisTick,
  getProjectionChartChrome,
  projectionSeriesName,
  projectionYAxis,
} from '../projection-chart'

/**
 * Story 97.2 (FR158): the Projections chart's series name and value axis.
 *
 * The chart is real Recharts, and jsdom measures no text, so whether a tick
 * FITS its axis is browser-only (`97-2-evidence/measure-after.jsonl`). What is
 * pinned here is the decision each helper makes, with concrete values.
 */

function resultNamed(name: unknown): ForecastingResult {
  return {
    scenario: { name, incomeGrowthRate: 0, expenseGrowthRate: 0 } as ForecastingResult['scenario'],
    baseline: [],
    projection: [],
    summary: { startingNetWorth: 0, endingNetWorth: 0, totalGrowth: 0, averageAnnualGrowth: 0 },
  }
}

describe('projectionSeriesName', () => {
  it('is the scenario name, trimmed', () => {
    expect(projectionSeriesName(resultNamed('  Buy a house  '))).toBe('Buy a house')
  })

  it('keeps an unsaved builder default name', () => {
    expect(projectionSeriesName(resultNamed('My Financial Forecast'))).toBe('My Financial Forecast')
  })

  it('passes a scenario literally named "Baseline" through unchanged', () => {
    expect(projectionSeriesName(resultNamed('Baseline'))).toBe('Baseline')
  })

  it('falls back for a blank, whitespace-only, missing or non-string name', () => {
    expect(SCENARIO_FALLBACK_NAME).toBe('Scenario')
    for (const name of ['', '   \t ', undefined, null, 42]) {
      expect(projectionSeriesName(resultNamed(name)), String(name)).toBe('Scenario')
    }
    expect(projectionSeriesName(null)).toBe('Scenario')
    // A parsed saved blob whose result has no `scenario` at all.
    expect(projectionSeriesName({ ...resultNamed('x'), scenario: undefined } as never)).toBe(
      'Scenario'
    )
  })
})

describe('getProjectionChartChrome', () => {
  // Widest compact tick of the seed's axis, MEASURED under the CI font
  // (DejaVu) in `97-2-evidence/measure-after.jsonl`: "$350.0M" is 52.3 px at
  // 12 px and 43.6 px at 10 px. Recharts draws the label after a 6 px tick
  // line and a 2 px gap, so the gutter must be at least text + 8. (At 52 px the
  // narrow tick's left edge measured 0.4 px inside the SVG: too tight.)
  it('wide: 12 px ticks in a gutter that holds "$350.0M"', () => {
    const chrome = getProjectionChartChrome(false)
    expect(chrome.tickFontSize).toBe(12)
    expect(chrome.yAxisWidth).toBeGreaterThanOrEqual(61)
    expect(chrome.marginRight).toBeGreaterThanOrEqual(24)
    expect(chrome.marginLeft).toBeGreaterThanOrEqual(0)
  })

  it('narrow: 10 px ticks in a gutter that holds "$350.0M"', () => {
    const chrome = getProjectionChartChrome(true)
    expect(chrome.tickFontSize).toBe(10)
    expect(chrome.yAxisWidth).toBeGreaterThanOrEqual(56)
    // A phone's plot needs the room: the gutter + margins leave at least
    // 150 px of a 230 px chart for the lines.
    expect(chrome.yAxisWidth + chrome.marginLeft + chrome.marginRight).toBeLessThanOrEqual(80)
  })
})

describe('formatProjectionAxisTick (cents in, compact label out)', () => {
  it('prints a 9-digit amount in the M band without cents', () => {
    expect(formatProjectionAxisTick(31_000_000_000, 5_000_000_000, 'symbol', 'USD')).toBe('$310.0M')
  })

  it('prints a 7-digit amount in the M band', () => {
    expect(formatProjectionAxisTick(250_000_000, 10_000_000, 'symbol', 'USD')).toBe('$2.5M')
  })

  it('adds the decimals a fine step needs, so adjacent ticks differ', () => {
    // A $10,000 step around $1.2M: one decimal would print "$1.2M" three times.
    const labels = [119_000_000, 120_000_000, 121_000_000].map((c) =>
      formatProjectionAxisTick(c, 1_000_000, 'symbol', 'USD')
    )
    expect(labels).toEqual(['$1.19M', '$1.20M', '$1.21M'])
  })

  it('uses the K band and plain units below a million', () => {
    expect(formatProjectionAxisTick(50_000_000, 10_000_000, 'symbol', 'USD')).toBe('$500K')
    expect(formatProjectionAxisTick(50_000, 50_000, 'symbol', 'USD')).toBe('$500')
    expect(formatProjectionAxisTick(0, 50_000, 'symbol', 'USD')).toBe('$0')
  })

  it('has no symbol in currency-less mode, or with currency NONE', () => {
    expect(formatProjectionAxisTick(31_000_000_000, 5_000_000_000, 'none', 'USD')).toBe('310.0M')
    expect(formatProjectionAxisTick(31_000_000_000, 5_000_000_000, 'symbol', 'NONE')).toBe('310.0M')
  })

  it('never prints NaN', () => {
    expect(formatProjectionAxisTick(Number.NaN, 100, 'none', 'NONE')).toBe('0')
  })
})

describe('projectionYAxis', () => {
  function labels(values: number[], mode: 'symbol' | 'none' = 'symbol') {
    const axis = projectionYAxis(values)
    return {
      axis,
      text: axis.ticks.map((t) => formatProjectionAxisTick(t, axis.step, mode, 'USD')),
    }
  }

  function expectWellFormed(values: number[]) {
    const { axis, text } = labels(values)
    expect(axis.ticks.length, 'at least two ticks').toBeGreaterThanOrEqual(2)
    // The domain IS the nice tick range, so every tick is drawn.
    expect(axis.domain).toEqual([axis.ticks[0], axis.ticks.at(-1)])
    // Every plotted value is inside the domain.
    expect(axis.domain[0]).toBeLessThanOrEqual(Math.min(...values))
    expect(axis.domain[1]).toBeGreaterThanOrEqual(Math.max(...values))
    // Adjacent labels are distinct strings.
    for (let i = 1; i < text.length; i++) expect(text[i], text.join(' ')).not.toBe(text[i - 1])
    return text
  }

  it('9-digit (the seed): compact, distinct labels', () => {
    const text = expectWellFormed([5_369_034_260, 31_010_148_369])
    for (const label of text) expect(label).toMatch(/^\$\d+(\.\d)?M$/)
  })

  it('7-digit: compact, distinct labels', () => {
    const text = expectWellFormed([203_400_000, 248_457_568])
    for (const label of text) expect(label).toMatch(/^\$\d\.\d{1,2}M$/)
  })

  it('a flat $1.2M net worth: still distinct (the one-decimal trap)', () => {
    const text = expectWellFormed([120_000_000, 120_000_000])
    expect(new Set(text).size).toBe(text.length)
  })

  it('a slow-growing $1.2M net worth: distinct', () => {
    expectWellFormed([119_900_000, 120_300_000])
  })

  it('a range crossing 0: distinct, with a zero tick', () => {
    const text = expectWellFormed([-25_000_000, 75_000_000])
    expect(text).toContain('$0')
  })

  it('an all-zero series: distinct', () => {
    expectWellFormed([0, 0, 0])
  })

  it('currency-less mode has no symbol', () => {
    const { text } = labels([5_369_034_260, 31_010_148_369], 'none')
    for (const label of text) expect(label).not.toContain('$')
  })
})
