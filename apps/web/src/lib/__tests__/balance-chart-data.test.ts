import type { ClientBalanceTracking } from '@budget-planner/core/services/balanceTracking'
import { describe, expect, it } from 'vitest'
import {
  SAVINGS_SEGMENT_KEY,
  buildBalanceChartAriaLabel,
  buildBalanceChartModel,
  buildReferenceLineLabel,
  getBalanceChartChrome,
  getBalanceSeriesFills,
  hasPlottableData,
  segmentFill,
  truncateReferenceLabel,
} from '../balance-chart-data'

/**
 * Node-env tests for the Balance chart's pure layer (story 37.2).
 *
 * ⚠️ Every claim about WHAT IS PLOTTED lives here rather than in a component
 * test, because jsdom gives Recharts a 0×0 box and renders no SVG at all — a
 * `.recharts-*` assertion returns 0 on correct and broken code alike.
 */

function entry(over: Partial<ClientBalanceTracking> = {}): ClientBalanceTracking {
  return {
    id: 'id-1',
    type: 'investment',
    name: 'Brokerage',
    currentBalance: 100_000,
    monthlyContribution: 0,
    frequency: 'monthly',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  } as ClientBalanceTracking
}

const fmt = (cents: number): string => `${(cents / 100).toFixed(2)}`

describe('buildBalanceChartModel — the eight cases the chart must render sensibly', () => {
  it('case 1 — investments only: ONE datum, Assets', () => {
    const model = buildBalanceChartModel({
      entries: [entry({ id: 'a', currentBalance: 500_000 })],
      savingsCents: 0,
    })
    // ⚠️ length 1, not a padded 2. A fixed two-element array always paints BOTH
    // category ticks — Recharts suppresses the zero-height bar but not the tick —
    // which is the empty axis slot an investments-only user must not see.
    expect(model.data).toHaveLength(1)
    expect(model.data[0]?.category).toBe('Assets')
    expect(model.assetsTotal).toBe(500_000)
    expect(model.liabilitiesTotal).toBe(0)
  })

  it('case 2 — debts only: ONE datum, Liabilities', () => {
    const model = buildBalanceChartModel({
      entries: [entry({ id: 'd', type: 'debt', name: 'Mortgage', currentBalance: 900_000 })],
      savingsCents: 0,
    })
    expect(model.data).toHaveLength(1)
    expect(model.data[0]?.category).toBe('Liabilities')
    expect(model.assetsTotal).toBe(0)
    expect(model.liabilitiesTotal).toBe(900_000)
    expect(model.netWorth).toBe(-900_000)
  })

  it('case 3 — mixed: TWO data, Assets first', () => {
    const model = buildBalanceChartModel({
      entries: [
        entry({ id: 'a', currentBalance: 500_000 }),
        entry({ id: 'd', type: 'debt', currentBalance: 200_000 }),
      ],
      savingsCents: 0,
    })
    expect(model.data).toHaveLength(2)
    expect(model.data.map((datum) => datum.category)).toEqual(['Assets', 'Liabilities'])
    expect(model.netWorth).toBe(300_000)
  })

  it('case 4 — SAVINGS ONLY is a real chart, not an empty state', () => {
    // Story 32.2 built for exactly this user: net worth is positive and non-zero
    // with no balance entries at all, so a "no data" panel here would sit beside
    // a positive Net Worth card and read as broken.
    const model = buildBalanceChartModel({ entries: [], savingsCents: 300_000 })
    expect(model.data).toHaveLength(1)
    expect(model.data[0]?.category).toBe('Assets')
    expect(model.segments.map((segment) => segment.key)).toEqual([SAVINGS_SEGMENT_KEY])
    expect(model.netWorth).toBe(300_000)
    expect(hasPlottableData(model)).toBe(true)
  })

  it('case 5 — nothing at all: no data, not plottable', () => {
    const model = buildBalanceChartModel({ entries: [], savingsCents: 0 })
    expect(model.data).toHaveLength(0)
    expect(model.segments).toHaveLength(0)
    expect(hasPlottableData(model)).toBe(false)
  })

  it('case 6 — entries exist but EVERY balance is zero: not plottable', () => {
    const model = buildBalanceChartModel({
      entries: [
        entry({ id: 'a', currentBalance: 0 }),
        entry({ id: 'd', type: 'debt', currentBalance: 0 }),
      ],
      savingsCents: 0,
    })
    expect(model.segments).toHaveLength(2)
    // A plot of nothing but zeroes is an empty axis that teaches the user nothing.
    expect(hasPlottableData(model)).toBe(false)
  })

  it('case 7 — a NEGATIVE balance is plotted as it is, never clamped', () => {
    // Negative balances are legal at every layer except the entry form, and the
    // Net Worth card does not clamp them. Clamping here would make the chart
    // disagree with the card 100px above it.
    const model = buildBalanceChartModel({
      entries: [entry({ id: 'd', type: 'debt', currentBalance: -50_000 })],
      savingsCents: 0,
    })
    expect(model.segments[0]?.value).toBe(-50_000)
    expect(model.liabilitiesTotal).toBe(-50_000)
    expect(model.netWorth).toBe(50_000)
    expect(hasPlottableData(model)).toBe(true)
  })

  it('case 8 — a NON-FINITE balance is excluded and counted, never silently dropped', () => {
    const model = buildBalanceChartModel({
      entries: [
        entry({ id: 'ok', currentBalance: 100_000 }),
        entry({ id: 'nan', currentBalance: Number.NaN }),
        entry({ id: 'inf', currentBalance: Number.POSITIVE_INFINITY }),
      ],
      savingsCents: 0,
    })
    expect(model.excludedCount).toBe(2)
    expect(model.segments.map((segment) => segment.key)).toEqual(['seg-ok'])
    expect(model.assetsTotal).toBe(100_000)
    expect(Number.isFinite(model.netWorth)).toBe(true)
  })

  it('excludes a STRING balance before it can concatenate into a total', () => {
    // The failure mode this guards is post-sum: the store's own selectors add raw
    // rows, so `100000 + '300000'` concatenates BEFORE any finiteness check and a
    // test on the total then passes. Checking each row first is the defence.
    const model = buildBalanceChartModel({
      entries: [
        entry({ id: 'ok', currentBalance: 100_000 }),
        entry({ id: 'str', currentBalance: '300000' as unknown as number }),
      ],
      savingsCents: 0,
    })
    expect(model.excludedCount).toBe(1)
    expect(model.assetsTotal).toBe(100_000)
    expect(typeof model.assetsTotal).toBe('number')
  })

  it('reports an unreadable SAVINGS aggregate SEPARATELY from the row count', () => {
    // It is one derived figure from a different page, not a row in this page's
    // table. Counting it among "balances" would send the user here to look for a
    // problem that is on /savings.
    const model = buildBalanceChartModel({
      entries: [entry({ id: 'a', currentBalance: 100_000 })],
      savingsCents: Number.NaN,
    })
    expect(model.savingsExcluded).toBe(true)
    expect(model.excludedCount).toBe(0)
    expect(model.segments.map((segment) => segment.key)).toEqual(['seg-a'])
    expect(model.assetsTotal).toBe(100_000)
  })

  it('case 9 — a side whose segments are ALL ZERO emits no datum', () => {
    // Recharts suppresses a zero-height rect but still paints its category tick,
    // so a count-based gate would render the labelled-but-empty axis slot the
    // one-datum-per-non-empty-side design exists to prevent. Reached by anyone
    // who pays a debt off.
    const model = buildBalanceChartModel({
      entries: [
        entry({ id: 'a', currentBalance: 500_000 }),
        entry({ id: 'd', type: 'debt', currentBalance: 0 }),
      ],
      savingsCents: 0,
    })
    expect(model.data).toHaveLength(1)
    expect(model.data[0]?.category).toBe('Assets')
  })

  it('case 10 — an unrecognised `type` is EXCLUDED, not bucketed into Assets', () => {
    // The store's totals filter strictly, so a corrupt type is absent from the Net
    // Worth card. Bucketing it here would make the chart disagree with the card
    // while excludedCount stayed 0 and the reference line kept asserting AC-3.
    const model = buildBalanceChartModel({
      entries: [
        entry({ id: 'ok', currentBalance: 100_000 }),
        entry({
          id: 'weird',
          type: 'property' as unknown as 'investment',
          currentBalance: 900_000,
        }),
      ],
      savingsCents: 0,
    })
    expect(model.excludedCount).toBe(1)
    expect(model.segments.map((segment) => segment.key)).toEqual(['seg-ok'])
    expect(model.assetsTotal).toBe(100_000)
  })

  it('case 11 — DUPLICATE IDS are excluded rather than silently double-painted', () => {
    // Two segments sharing a datum key collide on the write (last wins) while
    // Recharts stacks one series per bar dataKey, so the painted column would be
    // 2x the last value while every total was the true sum.
    const model = buildBalanceChartModel({
      entries: [
        entry({ id: 'dup', name: 'First', currentBalance: 100_000 }),
        entry({ id: 'dup', name: 'Second', currentBalance: 700_000 }),
      ],
      savingsCents: 0,
    })
    expect(model.segments).toHaveLength(1)
    expect(model.segments[0]?.label).toBe('First')
    expect(model.excludedCount).toBe(1)
    expect(model.assetsTotal).toBe(100_000)
  })

  it('gives an EMPTY entry name a readable fallback label', () => {
    // The tooltip is the declared sole path to segment identity, so a nameless
    // row leaves a value no one can attribute to anything.
    const model = buildBalanceChartModel({
      entries: [entry({ id: 'a', name: '   ', currentBalance: 100_000 })],
      savingsCents: 0,
    })
    expect(model.segments[0]?.label).toBe('Unnamed entry')
  })

  it('omits a ZERO savings aggregate rather than plotting an empty segment', () => {
    const model = buildBalanceChartModel({
      entries: [entry({ id: 'a', currentBalance: 100_000 })],
      savingsCents: 0,
    })
    expect(model.segments.map((segment) => segment.key)).toEqual(['seg-a'])
    expect(model.excludedCount).toBe(0)
  })
})

describe('buildBalanceChartModel — datum shape', () => {
  it('gives each datum ONLY its own side keys — never a zero for the other side', () => {
    // ⚠️ The whole reason this assertion exists. Recharts reads bar GEOMETRY with
    // a `0` default, so a symmetric datum looks correct; but it builds TOOLTIP
    // payloads with no default and `filterNull` drops only null/undefined. Emit
    // `0` for the other column's keys and hovering "Assets" lists every debt at
    // 0.00.
    const model = buildBalanceChartModel({
      entries: [
        entry({ id: 'a', currentBalance: 500_000 }),
        entry({ id: 'd', type: 'debt', currentBalance: 200_000 }),
      ],
      savingsCents: 300_000,
    })
    const [assets, liabilities] = model.data
    expect(Object.keys(assets ?? {}).sort()).toEqual(
      ['category', SAVINGS_SEGMENT_KEY, 'seg-a'].sort()
    )
    expect(Object.keys(liabilities ?? {}).sort()).toEqual(['category', 'seg-d'].sort())
    expect(assets?.['seg-d']).toBeUndefined()
    expect(liabilities?.['seg-a']).toBeUndefined()
  })

  it('keys every segment by id, so DUPLICATE NAMES never collapse', () => {
    const model = buildBalanceChartModel({
      entries: [
        entry({ id: 'one', name: 'Savings', currentBalance: 100_000 }),
        entry({ id: 'two', name: 'Savings', currentBalance: 200_000 }),
      ],
      savingsCents: 0,
    })
    expect(model.segments).toHaveLength(2)
    expect(model.segments.map((segment) => segment.key)).toEqual(['seg-one', 'seg-two'])
    expect(model.segments.map((segment) => segment.label)).toEqual(['Savings', 'Savings'])
    expect(model.assetsTotal).toBe(300_000)
  })

  it('puts the savings segment FIRST and preserves manual entry order after it', () => {
    const model = buildBalanceChartModel({
      entries: [
        entry({ id: 'z', name: 'Zed', currentBalance: 1 }),
        entry({ id: 'a', name: 'Alpha', currentBalance: 2 }),
      ],
      savingsCents: 500,
    })
    expect(model.segments.map((segment) => segment.key)).toEqual([
      SAVINGS_SEGMENT_KEY,
      'seg-z',
      'seg-a',
    ])
  })
})

describe('buildBalanceChartModel — domainInputs', () => {
  it('reports PER-SIGN stack sums, not the column nets', () => {
    // Assets: +5,000 savings and −3,000 investment. The column NET is 2,000 but
    // the stack paints from −3,000 to +5,000 under `stackOffset="sign"`, so a
    // domain built from nets would clip both ends.
    const model = buildBalanceChartModel({
      entries: [entry({ id: 'a', currentBalance: -3_000 })],
      savingsCents: 5_000,
    })
    expect(model.assetsTotal).toBe(2_000)
    expect(model.domainInputs).toContain(5_000)
    expect(model.domainInputs).toContain(-3_000)
    expect(model.domainInputs).toContain(model.netWorth)
  })

  it('OMITS netWorth when the reference line will be suppressed', () => {
    // With rows excluded the line is not drawn, so reserving axis room for it
    // would stretch the plot around a figure the model has just declared
    // non-authoritative.
    const model = buildBalanceChartModel({
      entries: [
        entry({ id: 'ok', type: 'debt', currentBalance: 9_000_000 }),
        entry({ id: 'bad', currentBalance: Number.NaN }),
      ],
      savingsCents: 0,
    })
    expect(model.excludedCount).toBe(1)
    expect(model.domainInputs).not.toContain(model.netWorth)
  })

  it('includes netWorth so the reference line is never outside the domain', () => {
    const model = buildBalanceChartModel({
      entries: [entry({ id: 'd', type: 'debt', currentBalance: 900_000 })],
      savingsCents: 100_000,
    })
    expect(model.netWorth).toBe(-800_000)
    expect(model.domainInputs).toContain(-800_000)
  })
})

describe('getBalanceChartChrome', () => {
  it('returns the narrow literals below the breakpoint', () => {
    expect(getBalanceChartChrome(true)).toEqual({
      height: 300,
      valueAxisWidth: 60,
      tickFontSize: 11,
      categoryFontSize: 11,
      maxBarSize: 72,
      tooltipWidth: 170,
      referenceLabelMaxChars: 24,
    })
  })

  it('returns the desktop literals above it', () => {
    expect(getBalanceChartChrome(false)).toEqual({
      height: 360,
      valueAxisWidth: 84,
      tickFontSize: 12,
      categoryFontSize: 12,
      maxBarSize: 120,
      tooltipWidth: 300,
      referenceLabelMaxChars: 40,
    })
  })

  it('shrinks the value-axis gutter and caps bar width more tightly when narrow', () => {
    expect(getBalanceChartChrome(true).valueAxisWidth).toBeLessThan(
      getBalanceChartChrome(false).valueAxisWidth
    )
    // ⚠️ `maxBarSize` is load-bearing, not cosmetic: with one non-empty side the
    // category axis has a single band, and an uncapped bar spans the whole plot.
    expect(getBalanceChartChrome(true).maxBarSize).toBeLessThan(
      getBalanceChartChrome(false).maxBarSize
    )
    // ⚠️ A FIXED tooltip width, not a max — Recharts flips the tooltip using a
    // box it measured on an earlier frame, so only a stable width keeps the
    // clamp correct. Without this the page scrolls sideways at 320px.
    expect(getBalanceChartChrome(true).tooltipWidth).toBeLessThan(
      getBalanceChartChrome(false).tooltipWidth
    )
  })
})

describe('getBalanceSeriesFills', () => {
  it('gives the two themes DIFFERENT ramps', () => {
    const light = getBalanceSeriesFills('light')
    const dark = getBalanceSeriesFills('dark')
    expect(light.asset).not.toEqual(dark.asset)
    expect(light.liability).not.toEqual(dark.liability)
  })

  it('holds the savings hue constant across themes', () => {
    // It matches HomePage's SAVINGS_COLOR and story 37.1's SAVINGS_SAVED_FILL, so
    // all three surfaces agree; it clears 3:1 on both surfaces (4.23 / 3.47).
    expect(getBalanceSeriesFills('light').savings).toBe('#8B5CF6')
    expect(getBalanceSeriesFills('dark').savings).toBe('#8B5CF6')
  })

  it('starts the LIGHT ramps on the Overview chart hues', () => {
    expect(getBalanceSeriesFills('light').asset[0]).toBe('#3B82F6') // INVESTMENT_COLOR
    expect(getBalanceSeriesFills('light').liability[0]).toBe('#DC2626') // DEBT_COLOR
  })

  it('every fill clears WCAG 1.4.11 (3:1) against its own theme card', () => {
    // Computed here, not quoted — story 37.1 shipped contrast figures LABELLED
    // "measured" that had never been computed. This recomputes them at test time
    // so a future palette edit that drops below 3:1 fails rather than drifts.
    const relativeLuminance = (hex: string): number => {
      const channels = [1, 3, 5].map(
        (offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
      )
      const linear = channels.map((value) =>
        value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
      )
      return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0)
    }
    const ratio = (a: string, b: string): number => {
      const [x, y] = [relativeLuminance(a), relativeLuminance(b)]
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
    }
    const LIGHT_SURFACE = '#ffffff'
    const DARK_SURFACE = '#1f2937'

    const light = getBalanceSeriesFills('light')
    const dark = getBalanceSeriesFills('dark')
    for (const fill of [...light.asset, ...light.liability]) {
      expect(ratio(fill, LIGHT_SURFACE)).toBeGreaterThanOrEqual(3)
    }
    for (const fill of [...dark.asset, ...dark.liability]) {
      expect(ratio(fill, DARK_SURFACE)).toBeGreaterThanOrEqual(3)
    }
    // The one fill used in BOTH themes has to clear BOTH surfaces.
    expect(ratio(light.savings, LIGHT_SURFACE)).toBeGreaterThanOrEqual(3)
    expect(ratio(dark.savings, DARK_SURFACE)).toBeGreaterThanOrEqual(3)
  })
})

describe('buildReferenceLineLabel', () => {
  const money = (cents: number): string =>
    `${cents < 0 ? '-' : ''}$${Math.abs(cents / 100).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`

  it('keeps the full label when it fits', () => {
    expect(buildReferenceLineLabel(1_900_000, money, 24)).toBe('Net worth $19,000.00')
  })

  it('NEVER cuts the number — it drops the prefix first', () => {
    // ⚠️ The defect this exists for: at the old 18-char budget, -$89,000.00
    // rendered as "Net worth -$89,00…", which reads as a DIFFERENT FIGURE. A
    // truncated currency string is not an abbreviation, it is a wrong number.
    const label = buildReferenceLineLabel(-8_900_000, money, 18)
    expect(label).toBe('-$89,000.00')
    expect(label).not.toContain('…')
  })

  it('only ellipsizes when the amount ALONE cannot fit', () => {
    expect(buildReferenceLineLabel(-8_900_000, money, 6)).toBe('-$89,…')
  })

  it('fits every realistic net worth at the narrow budget without truncating', () => {
    // The regression guard for the sizing mistake: the budget must count the
    // 10-character "Net worth " prefix, not just the amount.
    const narrow = getBalanceChartChrome(true).referenceLabelMaxChars
    for (const cents of [1_900_000, -8_900_000, 123_456, -99_999_999]) {
      expect(buildReferenceLineLabel(cents, money, narrow)).not.toContain('…')
    }
  })
})

describe('buildBalanceChartAriaLabel — the excluded state', () => {
  it('QUALIFIES the net-worth clause when rows were excluded', () => {
    // ⚠️ The visual reference line is suppressed in this state precisely because
    // the figure is not what the Net Worth card shows. Leaving the label
    // unqualified would withdraw the claim from sighted users and leave it
    // standing for the only audience with no other route to these numbers.
    const model = buildBalanceChartModel({
      entries: [
        entry({ id: 'ok', currentBalance: 500_000 }),
        entry({ id: 'bad', currentBalance: Number.NaN }),
      ],
      savingsCents: 0,
    })
    const label = buildBalanceChartAriaLabel(model, fmt)
    expect(label).toContain('Net worth is unavailable')
    expect(label).toContain('1 unreadable balance')
    expect(label).not.toMatch(/net worth 5000\.00/)
  })

  it('names an unreadable savings total separately', () => {
    const model = buildBalanceChartModel({
      entries: [entry({ id: 'ok', currentBalance: 500_000 })],
      savingsCents: Number.NaN,
    })
    expect(buildBalanceChartAriaLabel(model, fmt)).toContain('an unreadable savings total')
  })
})

describe('segmentFill', () => {
  const fills = getBalanceSeriesFills('light')

  it('gives the savings segment the savings hue regardless of position', () => {
    expect(
      segmentFill(
        { key: SAVINGS_SEGMENT_KEY, label: 'Savings', value: 1, side: 'Assets' },
        0,
        fills
      )
    ).toBe(fills.savings)
  })

  it('draws each side from its own ramp', () => {
    expect(segmentFill({ key: 'seg-a', label: 'A', value: 1, side: 'Assets' }, 0, fills)).toBe(
      fills.asset[0]
    )
    expect(segmentFill({ key: 'seg-d', label: 'D', value: 1, side: 'Liabilities' }, 0, fills)).toBe(
      fills.liability[0]
    )
  })

  it('falls back to a NEUTRAL hue, never the reserved savings colour', () => {
    // Unreachable while the ramps are non-empty literals; the point is the
    // failure MODE. Falling back to the savings hue would paint every asset or
    // debt segment in the one colour reserved for the savings aggregate —
    // misinformation rather than an obvious defect.
    const empty = { savings: '#8B5CF6', asset: [], liability: [] }
    const fill = segmentFill({ key: 'seg-a', label: 'A', value: 1, side: 'Assets' }, 0, empty)
    expect(fill).not.toBe(empty.savings)
  })

  it('CYCLES the ramp, because the entry count is unbounded', () => {
    const rampLength = fills.asset.length
    expect(
      segmentFill({ key: 'seg-x', label: 'X', value: 1, side: 'Assets' }, rampLength, fills)
    ).toBe(fills.asset[0])
  })
})

describe('buildBalanceChartAriaLabel', () => {
  it('carries all three aggregates, because none of them is in a table', () => {
    // Per-entry figures have a text path in the page's two tables. The savings
    // total appears only in a stat CARD, and neither column total appears
    // anywhere else on the page at all — so the accessible name is the only
    // non-visual path to the three aggregates.
    const model = buildBalanceChartModel({
      entries: [
        entry({ id: 'a', currentBalance: 500_000 }),
        entry({ id: 'd', type: 'debt', currentBalance: 200_000 }),
      ],
      savingsCents: 100_000,
    })
    const label = buildBalanceChartAriaLabel(model, fmt)
    expect(label).toContain('assets 6000.00')
    expect(label).toContain('liabilities 2000.00')
    expect(label).toContain('net worth 4000.00')
    // ⚠️ EM DASH (U+2014). `getByRole('img', { name })` is an exact match, so a
    // typed hyphen in the e2e silently fails to find the chart.
    expect(label).toContain('—')
  })
})

describe('truncateReferenceLabel', () => {
  it('leaves a label that fits alone', () => {
    expect(truncateReferenceLabel('Net worth 40.00', 40)).toBe('Net worth 40.00')
  })

  it('ellipsizes past the limit', () => {
    const result = truncateReferenceLabel('Net worth 1234567890.00', 18)
    expect(result).toHaveLength(18)
    expect(result.endsWith('…')).toBe(true)
  })

  it('returns nothing rather than the FULL input at max 0', () => {
    // `slice(0, max - 1)` with max 0 keeps all but the last code point, so an
    // unguarded clamp returns something as long as its input.
    expect(truncateReferenceLabel('Net worth 40.00', 0)).toBe('')
    expect(truncateReferenceLabel('Net worth 40.00', 1)).toBe('…')
  })

  it('slices CODE POINTS, so an emoji is never cut into a lone surrogate', () => {
    const result = truncateReferenceLabel('💰💰💰💰💰', 3)
    expect([...result]).toHaveLength(3)
    expect(result).toBe('💰💰…')
  })
})
