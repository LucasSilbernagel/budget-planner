import type { ClientBalanceTracking } from '@budget-planner/core/services/balanceTracking'

/**
 * Pure data + chrome layer for the Balance page chart (story 37.2, FR64).
 *
 * ⚠️ WHY THIS IS A SEPARATE MODULE. jsdom gives Recharts' `ResponsiveContainer`
 * a 0×0 box, so the chart renders NO SVG in a unit test — every `.recharts-*`
 * selector returns 0 on correct and broken code alike. Every decision the chart
 * makes therefore lives here, as pure functions testable with concrete literals
 * in vitest's node env (the story-24-1 `get*Chrome()` pattern). Keep this file
 * React-free so it stays out of jsdom.
 */

/** The two category-axis values. There is no third side. */
export type BalanceChartSide = 'Assets' | 'Liabilities'

/** One plotted stack segment. `key` is the identity; `label` is display only. */
export interface BalanceChartSegment {
  /**
   * The Recharts `dataKey`. `seg-` + the entry's uuid, or the literal
   * `seg-savings` for the savings aggregate.
   *
   * ⚠️ Prefixed and id-based on purpose. Recharts reads a `dataKey` with lodash
   * `_.get` (`ChartUtils.js` `getValueByDataKey`), so a key containing `.` or
   * `[` would be interpreted as a PATH. Entry ids are uuids and safe, but the
   * prefix keeps that true for any future key. Never key on `name`: duplicate
   * names are fully legal — no uniqueness check exists in the schema, in
   * `validateBalanceTracking`, or in the store.
   */
  key: string
  /** The entry's name, shown in the tooltip. May be duplicated or empty. */
  label: string
  /** The entry's `currentBalance` in cents. May be negative; never non-finite. */
  value: number
  side: BalanceChartSide
}

/**
 * One stacked column. EXACTLY one datum per NON-EMPTY side — length 1 or 2,
 * never a padded 2.
 *
 * ⚠️ A segment key appears on ONE datum and is ABSENT — not `0` — on the other.
 * The two behaviours diverge in a way that is invisible until you hover:
 * Recharts reads bar GEOMETRY with `+getValueByDataKey(d, key, 0)`, so a missing
 * key is 0 and paints nothing (`Rectangle.js` returns null for zero height), but
 * it builds TOOLTIP payloads with no default and `Tooltip`'s `filterNull`
 * (default true) drops only `value == null`. Emit `0` for the other side's keys
 * and hovering "Assets" lists every debt at 0.00, and vice versa.
 */
export interface BalanceChartDatum {
  category: BalanceChartSide
  [segmentKey: string]: number | BalanceChartSide
}

/** Everything the chart needs, folded once from the stores. */
export interface BalanceChartModel {
  /** One entry per non-empty side, Assets first. */
  data: BalanceChartDatum[]
  /** Every plotted segment, in render order, Assets side first. */
  segments: BalanceChartSegment[]
  /** Savings + investments, in cents. */
  assetsTotal: number
  /** Debts, in cents, as a positive magnitude when the data is well-formed. */
  liabilitiesTotal: number
  /** `assetsTotal - liabilitiesTotal`. Equals `useNetWorth()` when nothing was excluded. */
  netWorth: number
  /**
   * The values the value-axis domain must span.
   *
   * ⚠️ PER-SIGN STACK SUMS, not column nets. Under `stackOffset="sign"` a
   * column's painted extent is (sum of its positive segments) upward and (sum of
   * its negative segments) downward. A column whose net is small can therefore
   * paint far past it in both directions — feeding `barDomainTicks` the nets
   * clips segments off the top or bottom of the plot. `netWorth` is included so
   * the reference line is never drawn outside the domain.
   */
  domainInputs: number[]
  /** Balance ROWS dropped as unreadable. When > 0, `netWorth` is NOT authoritative. */
  excludedCount: number
  /**
   * Whether the savings AGGREGATE itself was unreadable. Separate from
   * `excludedCount` because it is one derived total from a different page, not a
   * row in this page's table — the disclosure has to send the user somewhere else.
   */
  savingsExcluded: boolean
}

/** The savings aggregate's fixed segment key. */
export const SAVINGS_SEGMENT_KEY = 'seg-savings'

/** Theme-keyed segment fills. */
export interface BalanceSeriesFills {
  savings: string
  asset: string[]
  liability: string[]
}

/**
 * The savings segment's colour, in BOTH themes.
 *
 * ⚠️ COPIED from `HomePage.tsx`'s module-private `SAVINGS_COLOR` (not exported
 * there) and identical to story 37.1's `SAVINGS_SAVED_FILL`, so all three
 * surfaces agree on the savings hue. Story 30-5 settled that the house answer is
 * to copy a chart constant rather than export it. Nothing detects the three
 * drifting apart — a declared blind spot, not an oversight.
 *
 * Contrast as a graphic (WCAG 1.4.11 wants ≥3:1), COMPUTED with the WCAG 2.x
 * relative-luminance formula, not quoted: **4.23:1** on the light `.surface`
 * (#ffffff) and **3.47:1** on the dark `.surface` (#1f2937). It is the one fill
 * held constant across themes, which is why it must clear 3:1 on both.
 */
const SAVINGS_FILL = '#8B5CF6'

/**
 * Per-theme segment ramps. Every ratio below was COMPUTED, not quoted — story
 * 37.1's headline review finding was a set of contrast figures LABELLED
 * "measured" that had been copied from a disagreeing source and never computed.
 * The label is not the safeguard; the computation is.
 *
 * Light ramps are measured against the light `.surface` #ffffff, dark ramps
 * against the dark `.surface` #1f2937:
 *
 *   ASSET light      #3B82F6 3.68:1   #0891B2 3.68:1   #0D9488 3.74:1   #4F46E5 6.29:1
 *   ASSET dark       #60A5FA 5.77:1   #38BDF8 6.85:1   #14B8A6 5.90:1   #818CF8 4.92:1
 *   LIABILITY light  #DC2626 4.83:1   #E11D48 4.70:1   #EA580C 3.56:1   #EC4899 3.53:1
 *   LIABILITY dark   #F87171 5.31:1   #FB7185 5.45:1   #FB923C 6.49:1   #F472B6 5.54:1
 *
 * ⚠️ HONEST NOTE ON WHY THERE ARE TWO RAMPS. The story predicted a single ramp
 * clearing 3:1 on both surfaces might be impossible. It is not: the Tailwind
 * 500-band (#3B82F6 3.68/3.99, #EF4444 3.76/3.90, …) clears both, and a
 * one-ramp implementation was available. Two ramps were chosen anyway because
 * each theme then gets 3.5–6.9:1 instead of a 2.8–4.2:1 compromise, not because
 * one ramp was unreachable. Recorded so nobody later "simplifies" this back
 * believing it was forced.
 *
 * `asset[0]` and `liability[0]` in the LIGHT ramp are `HomePage.tsx`'s
 * `INVESTMENT_COLOR` and `DEBT_COLOR` exactly, so the first segment of each side
 * matches the Overview's aggregate bars. The dark ramp lightens them, because
 * #2563EB-class blues fall to 2.84:1 on the dark card.
 */
const ASSET_FILLS_LIGHT = ['#3B82F6', '#0891B2', '#0D9488', '#4F46E5']
const ASSET_FILLS_DARK = ['#60A5FA', '#38BDF8', '#14B8A6', '#818CF8']
const LIABILITY_FILLS_LIGHT = ['#DC2626', '#E11D48', '#EA580C', '#EC4899']
const LIABILITY_FILLS_DARK = ['#F87171', '#FB7185', '#FB923C', '#F472B6']

/**
 * Segment fills for the active theme.
 *
 * ⚠️ Deliberately NOT part of `ChartColors`. That interface is the shared CHROME
 * palette (axis / grid / tooltip) and has no series field; story 37.1 recorded
 * extending it as deferred work and this story's scope fence forbids touching
 * it. So the ramp is local, and the cost is that nothing keeps it in sync with
 * `HomePage.tsx`'s module-private constants.
 */
export function getBalanceSeriesFills(theme: 'light' | 'dark'): BalanceSeriesFills {
  return theme === 'dark'
    ? { savings: SAVINGS_FILL, asset: ASSET_FILLS_DARK, liability: LIABILITY_FILLS_DARK }
    : { savings: SAVINGS_FILL, asset: ASSET_FILLS_LIGHT, liability: LIABILITY_FILLS_LIGHT }
}

/**
 * The fill for one segment. Ramps CYCLE — the entry count is unbounded (no cap
 * exists in the store, the page, core, or `sync.ts`), so a user with nine debts
 * sees hues repeat. Adjacent segments stay separable because the chart strokes
 * each one in the card colour; repetition costs identity, which the tooltip and
 * the tables carry, not separability.
 */
export function segmentFill(
  segment: BalanceChartSegment,
  indexWithinSide: number,
  fills: BalanceSeriesFills
): string {
  if (segment.key === SAVINGS_SEGMENT_KEY) return fills.savings
  const ramp = segment.side === 'Assets' ? fills.asset : fills.liability
  // `noUncheckedIndexedAccess` is on; narrow with `??`, never cast.
  // ⚠️ The fallback is NEUTRAL, deliberately. It is unreachable while the ramps
  // are non-empty literals, but if one ever became empty, falling back to the
  // savings hue would silently paint every asset or debt segment in the one
  // colour this module reserves for the savings aggregate — a dead default whose
  // failure mode is active misinformation rather than an obvious defect.
  return ramp[indexWithinSide % ramp.length] ?? '#6b7280'
}

/** Whether a persisted balance is usable as a number. */
function isReadableBalance(value: unknown): value is number {
  // ⚠️ `typeof` is here for TypeScript narrowing, NOT as the runtime guard for
  // strings. `Number.isFinite('300000')` is already `false` — only the LEGACY
  // GLOBAL `isFinite` coerces. The string hazard `deferred-work.md:738` records
  // is a POST-SUM one: the store's own total selectors sum raw rows, so
  // `800000 + '300000'` concatenates BEFORE any check and a finiteness test on
  // the total then passes. The defence is checking every row BEFORE summing,
  // which is what `buildBalanceChartModel` does.
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Fold the balance entries and the savings aggregate into the chart model.
 *
 * PARTITION AND DISCLOSE, never silent drop — the house answer named at
 * `net-worth.ts:34-35` and rendered for income/expenses by `PeriodTotal.tsx`'s
 * `unreadable-rows-note`. (`readable-rows.ts`'s `isReadableRow` keys on
 * `{amount, frequency}`, so the shape is reused here, not the predicate.)
 *
 * Negative balances are plotted AS THEY ARE. They are legal at every layer
 * except the entry form — `validateBalanceTracking` enforces finite/integer but
 * never non-negativity, `schema.ts` documents negatives as legal with no CHECK,
 * and `applyServerChanges.ts` writes synced rows via raw `setState`. Clamping
 * them here would make the chart disagree with the Net Worth card, which does
 * not clamp. `stackOffset="sign"` is what renders them below the baseline.
 *
 * Input order is preserved. ⚠️ The MANUAL order, not the table's column sort —
 * this chart sits above the deliberately-unsorted Investment Accounts
 * breakdown, and `BalancePage.tsx` forbids hoisting the sort to page level
 * because it would silently reorder that section.
 */
export function buildBalanceChartModel({
  entries,
  savingsCents,
}: {
  entries: readonly ClientBalanceTracking[]
  savingsCents: number
}): BalanceChartModel {
  const assetSegments: BalanceChartSegment[] = []
  const liabilitySegments: BalanceChartSegment[] = []
  let excludedCount = 0
  // ⚠️ Tracked SEPARATELY from the row count. An unreadable savings aggregate is
  // derived from potentially many goals on a DIFFERENT page, so folding it into
  // "1 balance could not be read" points the user at the balance table, where
  // nothing is wrong.
  let savingsExcluded = false

  // The savings aggregate leads the Assets stack. It is a single derived total
  // from a different store, so it is unreadable as a whole or not at all.
  if (isReadableBalance(savingsCents)) {
    if (savingsCents !== 0) {
      assetSegments.push({
        key: SAVINGS_SEGMENT_KEY,
        label: 'Savings',
        value: savingsCents,
        side: 'Assets',
      })
    }
  } else {
    savingsExcluded = true
  }

  const seenIds = new Set<string>()
  for (const entry of entries) {
    if (!isReadableBalance(entry.currentBalance)) {
      excludedCount += 1
      continue
    }
    // ⚠️ An unrecognised `type` is EXCLUDED, not bucketed into Assets. The store's
    // total selectors filter strictly (`type === 'investment'` / `=== 'debt'`), so
    // a corrupt type is absent from the Net Worth card — folding it in here would
    // make the chart disagree with the card while `excludedCount` stayed 0 and the
    // reference line kept asserting the agreement. The same unvalidated sync path
    // that can deliver a non-numeric balance can deliver this.
    if (entry.type !== 'investment' && entry.type !== 'debt') {
      excludedCount += 1
      continue
    }
    // ⚠️ Duplicate ids would collide on the datum key: the datum write keeps only
    // the LAST value while Recharts stacks one series per bar dataKey, so the
    // painted column would be 2x the last value while every total was the true
    // sum. Only reachable from a corrupt persisted blob — the same channel this
    // fold already defends against — so it is excluded and disclosed, not merged.
    const key = `seg-${entry.id}`
    if (seenIds.has(key)) {
      excludedCount += 1
      continue
    }
    seenIds.add(key)
    const segment: BalanceChartSegment = {
      key,
      // ⚠️ Names are unbounded and unvalidated from storage, INCLUDING empty. The
      // tooltip is the declared sole path to a segment's identity, so an empty
      // name would leave a value no one can attribute to anything.
      label: entry.name.trim() === '' ? 'Unnamed entry' : entry.name,
      value: entry.currentBalance,
      side: entry.type === 'debt' ? 'Liabilities' : 'Assets',
    }
    if (segment.side === 'Assets') assetSegments.push(segment)
    else liabilitySegments.push(segment)
  }

  const sum = (segments: BalanceChartSegment[]): number =>
    segments.reduce((total, segment) => total + segment.value, 0)
  const positiveSum = (segments: BalanceChartSegment[]): number =>
    segments.reduce((total, segment) => (segment.value > 0 ? total + segment.value : total), 0)
  const negativeSum = (segments: BalanceChartSegment[]): number =>
    segments.reduce((total, segment) => (segment.value < 0 ? total + segment.value : total), 0)

  const assetsTotal = sum(assetSegments)
  const liabilitiesTotal = sum(liabilitySegments)

  // ⚠️ One datum per NON-EMPTY side. A fixed two-element array always paints
  // both category ticks — Recharts suppresses the zero-height bar but not the
  // tick — which is the "empty axis slot" an investments-only user must not see.
  const data: BalanceChartDatum[] = []
  for (const [side, segments] of [
    ['Assets', assetSegments],
    ['Liabilities', liabilitySegments],
  ] as const) {
    // ⚠️ Gated on a PAINTED bar, not on segment count. Recharts suppresses a
    // zero-height rect but still paints its category tick, so a side holding only
    // zero-value entries — an investor who has paid a debt off — would render the
    // labelled-but-empty axis slot this length-1-not-padded-2 design exists to
    // prevent, reached through a different door.
    if (!segments.some((segment) => segment.value !== 0)) continue
    const datum: BalanceChartDatum = { category: side }
    for (const segment of segments) datum[segment.key] = segment.value
    data.push(datum)
  }

  return {
    data,
    segments: [...assetSegments, ...liabilitySegments],
    assetsTotal,
    liabilitiesTotal,
    netWorth: assetsTotal - liabilitiesTotal,
    // ⚠️ `netWorth` is in the domain only when the reference line will actually be
    // drawn. With rows excluded the line is suppressed, so including the figure
    // would stretch the axis to reserve space for a line that never appears —
    // anchored on the very value the model has just declared non-authoritative.
    domainInputs: [
      positiveSum(assetSegments),
      negativeSum(assetSegments),
      positiveSum(liabilitySegments),
      negativeSum(liabilitySegments),
      ...(excludedCount === 0 && !savingsExcluded ? [assetsTotal - liabilitiesTotal] : []),
    ],
    excludedCount,
    savingsExcluded,
  }
}

/**
 * Whether there is anything worth plotting. False when no segment survived, and
 * false when every segment is zero — a plot of nothing but zeroes is an empty
 * axis that teaches the user nothing, so that case goes to the empty state too.
 */
export function hasPlottableData(model: BalanceChartModel): boolean {
  return model.segments.some((segment) => segment.value !== 0)
}

/**
 * Responsive chart chrome, resolved once per render from the viewport.
 *
 * ⚠️ Height lives HERE rather than in a `balanceChartHeight(count)` helper,
 * because this chart always has exactly two columns. An unbounded entry count
 * makes segments thinner, not the canvas taller — which is a better failure mode
 * than story 37.1's per-row growth, and a reason the stacked design was chosen
 * over per-entry bars.
 *
 * ⚠️ `maxBarSize` is load-bearing, not cosmetic. With only one non-empty side
 * the category axis has a single band, and a bar with no cap spans the entire
 * plot width.
 */
export interface BalanceChartChrome {
  height: number
  /** Value-axis gutter, px. Shrinks at 320px so the columns keep their width. */
  valueAxisWidth: number
  tickFontSize: number
  categoryFontSize: number
  maxBarSize: number
  /**
   * The tooltip's FIXED width, px.
   *
   * ⚠️ Load-bearing, and the only guard on the one piece of UNBOUNDED text this
   * chart can paint. Segment identity rides in the tooltip via `<Bar name>`, and
   * an entry name is capped at 100 characters by the form but unbounded from
   * storage — the repo's own 320px fixture seeds a 138-character unbroken one.
   *
   * ⚠️ FIXED, not a `maxWidth`, and that distinction is the whole fix. Recharts
   * decides whether to flip the tooltip left of the cursor by comparing a box it
   * MEASURED on a previous frame against the plot's view box
   * (`util/tooltip/translate.js`'s `getTooltipTranslateXY`). A `maxWidth` paints
   * narrow while that cached measurement can still be the unwrapped content
   * width, so the flip is computed from the wrong number and the box lands past
   * the viewport edge — measured at 320px: right edge 356 against a 320px client
   * width, i.e. the whole PAGE scrolls sideways. A fixed width makes the
   * measurement stable and the clamp correct.
   *
   * ⚠️ The NARROW value is also bounded by the chart's own width, not just by
   * taste. The wrapper is absolutely positioned inside the chart box and keeps
   * its width even while hidden, so a value wider than (chart width − the value
   * axis gutter) makes the chart box itself horizontally scrollable before the
   * user has hovered anything. Measured at 320px: 200px produced scrollWidth 265
   * against clientWidth 240.
   */
  tooltipWidth: number
  /**
   * Longest reference-line label before truncation, in characters.
   *
   * ⚠️ The budget must count the 10-character `"Net worth "` PREFIX, not just the
   * amount. Sized without it, truncation became the COMMON case rather than the
   * overflow case: `"Net worth -$89,000.00"` is 21 characters, so an 18-char
   * budget rendered `"Net worth -$89,00…"` — a string that reads as a DIFFERENT
   * figure. `buildReferenceLineLabel` additionally drops the prefix before it
   * will ever cut the number, so a wrong-looking amount stays unreachable even if
   * a future budget is set too small.
   */
  referenceLabelMaxChars: number
}

export function getBalanceChartChrome(isNarrow: boolean): BalanceChartChrome {
  return isNarrow
    ? {
        height: 300,
        valueAxisWidth: 60,
        tickFontSize: 11,
        categoryFontSize: 11,
        maxBarSize: 72,
        tooltipWidth: 170,
        referenceLabelMaxChars: 24,
      }
    : {
        height: 360,
        valueAxisWidth: 84,
        tickFontSize: 12,
        categoryFontSize: 12,
        maxBarSize: 120,
        tooltipWidth: 300,
        referenceLabelMaxChars: 40,
      }
}

/**
 * Accessible name for the plot, carrying the three aggregate figures.
 *
 * ⚠️ DERIVED, not a constant, and that is the point. `role="img"` makes the
 * plot opaque to assistive tech, and segment identity is reachable only by
 * pointer or touch. Per-ENTRY figures have a text path in the page's two tables
 * — but the savings segment's figure appears only in the `stat-total-savings`
 * CARD, and NEITHER column total appears anywhere else on the page at all. So
 * the three aggregates ride in the accessible name, which is the only non-visual
 * path to them. The per-segment limitation is a declared blind spot, not a
 * solved problem.
 */
export function buildBalanceChartAriaLabel(
  model: BalanceChartModel,
  formatAmount: (cents: number) => string
): string {
  const head = `What you own against what you owe — assets ${formatAmount(
    model.assetsTotal
  )}, liabilities ${formatAmount(model.liabilitiesTotal)}`
  // ⚠️ The net-worth clause is QUALIFIED whenever the visual reference line is
  // suppressed, and for the same reason: with rows excluded the figure is not
  // what the Net Worth card shows, so stating it flatly asserts an agreement that
  // does not hold. Suppressing the line but not the label would withdraw the
  // claim from sighted users and leave it standing for exactly the audience with
  // no other route to these three numbers.
  if (model.excludedCount > 0 || model.savingsExcluded) {
    const unreadable = [
      model.excludedCount > 0
        ? `${model.excludedCount} unreadable ${model.excludedCount === 1 ? 'balance' : 'balances'}`
        : '',
      model.savingsExcluded ? 'an unreadable savings total' : '',
    ]
      .filter(Boolean)
      .join(' and ')
    return `${head}. Net worth is unavailable because this chart excludes ${unreadable}.`
  }
  return `${head}, net worth ${formatAmount(model.netWorth)}`
}

/**
 * The reference-line label: the same figure the Net Worth card shows, prefixed,
 * and never rendered as a number the user cannot trust.
 *
 * ⚠️ ORDER OF SACRIFICE: full label → amount alone → ellipsized amount. Cutting a
 * grouped currency string mid-digit does not abbreviate it, it produces a
 * DIFFERENT NUMBER (`-$89,000.00` → `-$89,00…`), which is worse than showing no
 * words at all. The prefix is decoration; the amount is the claim.
 */
export function buildReferenceLineLabel(
  netWorthCents: number,
  formatAmount: (cents: number) => string,
  maxChars: number
): string {
  const amount = formatAmount(netWorthCents)
  const full = `Net worth ${amount}`
  if ([...full].length <= maxChars) return full
  if ([...amount].length <= maxChars) return amount
  return truncateReferenceLabel(amount, maxChars)
}

/**
 * Clamp the reference-line label to something the plot can hold.
 *
 * ⚠️ Code points, not UTF-16 units, matching `truncateAxisLabel` in
 * `savings-chart-data.ts`. Copied rather than imported: importing across chart
 * modules would couple the Balance chart to the Savings chart for four lines,
 * which is the coupling story 30-5 declined.
 */
export function truncateReferenceLabel(label: string, max: number): string {
  // ⚠️ `max <= 1` first. Otherwise `slice(0, max - 1)` with `max = 0` keeps all
  // but the LAST code point and appends an ellipsis, so a clamp function returns
  // something as long as its input — the opposite of its contract.
  if (max <= 0) return ''
  if (max === 1) return '…'
  const points = [...label]
  return points.length > max ? `${points.slice(0, max - 1).join('')}…` : label
}
