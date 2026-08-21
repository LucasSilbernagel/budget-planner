import type { ClientSavingsGoal } from '@budget-planner/core/services/savingsGoals'

/**
 * Pure data + chrome layer for the Savings page chart (story 37.1, FR64).
 *
 * ⚠️ WHY THIS IS A SEPARATE MODULE. jsdom gives Recharts' `ResponsiveContainer`
 * a 0×0 box, so the chart renders NO SVG in a unit test — every `.recharts-*`
 * selector returns 0 on correct and broken code alike. Every decision the chart
 * makes therefore lives here, as pure functions testable with concrete
 * literals in vitest's node env (the story-24-1 `get*Chrome()` pattern). Keep
 * this file React-free so it stays out of jsdom.
 */

/** One plotted savings entry. `id` is the identity; `label` is display only. */
export interface SavingsChartRow {
  /**
   * The goal's uuid — the ONLY unique key. ⚠️ Names are not unique: no
   * uniqueness check exists in the schema, in `validateSavingsGoal`, or in the
   * store, so two goals may both be called "Savings". Never group, dedupe or
   * key by `label`.
   */
  id: string
  /** The goal's name, as shown on the Y axis. May be duplicated or empty. */
  label: string
  /** `currentBalance` in cents. May be negative; never non-finite. */
  saved: number
  /**
   * The goal's target in cents, or `null` when there is no USABLE target.
   * Folded from `targetAmount`'s three states — see `buildSavingsChartRows`.
   */
  target: number | null
}

/** Responsive chart chrome, resolved once per render from the viewport. */
export interface SavingsChartChrome {
  /** Y-axis label gutter, px. Shrinks at 320px so the plot keeps its width. */
  yAxisWidth: number
  tickFontSize: number
  barSize: number
  legendFontSize: number
  /**
   * Longest category label before truncation, in characters.
   *
   * ⚠️ This is part of the RESPONSIVE chrome, not a constant, and that is
   * load-bearing. The narrow gutter is 76px; 18 characters at 11px DejaVu Sans
   * measures ~110px, so a limit that does not shrink with the gutter paints the
   * label straight out of the chart's left edge. Measured at 320px, not guessed.
   */
  labelMaxChars: number
}

/**
 * The Saved series colour. ⚠️ COPIED from `HomePage.tsx`'s module-private
 * `SAVINGS_COLOR` (not exported there) so the Overview's aggregate Savings bar
 * and this chart agree on the hue. Story 30-5 settled that the house answer is
 * to copy a chart pattern rather than export it. Nothing detects the two
 * drifting apart — a declared blind spot of story 37.1, not an oversight.
 *
 * Contrast as a graphic (WCAG 1.4.11 wants ≥3:1), computed with the WCAG 2.x
 * relative-luminance formula, not quoted: **4.23:1** on the light `.surface`
 * (#ffffff) and **3.47:1** on the dark `.surface` (#1f2937). The Target series
 * takes `chartColors.axis` instead, which is theme-aware and clears AA as text:
 * #6b7280 on #ffffff = 4.83:1, #9ca3af on #1f2937 = 5.78:1.
 *
 * ⚠️ An earlier revision of this comment recorded 4.06:1 / 3.61:1 and called
 * them "measured". They were neither — they were copied from one of two
 * disagreeing figures quoted in the story spec, and they contradicted the
 * 3.47:1 stated in `SavingsChart.tsx` and the e2e spec. Recompute, do not quote.
 */
export const SAVINGS_SAVED_FILL = '#8B5CF6'

/** Longest Y-axis label before truncation, in characters. */
const AXIS_LABEL_MAX = 18

/**
 * Project savings goals onto plottable rows, folding `targetAmount`'s THREE
 * states down to a usable-or-absent binary at this one boundary.
 *
 * `targetAmount` is `number | null`: a positive int is a goal's target, `null`
 * is a savings ACCOUNT with no target (story 16-1's model), and `0`/negative/
 * non-finite are corrupt-but-reachable — localStorage is user-editable JSON and
 * the store's `migrate` only filters non-objects, so live guards for exactly
 * this already exist at `savingsStore.ts:175` and
 * `savingsGoalCalculations.ts:31`. The DB CHECK is documentation-only
 * (drizzle-kit 0.23 emits no CHECK constraints).
 *
 * ⚠️ An absent target renders NO target bar — never a zero-length one. Story
 * 16-1: "`0%` is wrong for an account — it reads as '0% of the way to a goal.'"
 *
 * `currentBalance` is passed through even when NEGATIVE: the sync ingest schema
 * has no lower bound (`sync.ts:204` is `z.number().int().default(0)`, unlike
 * `monthlyAllocation` at `:212`), so a negative balance is real data the
 * diverging axis handles. Only a NON-FINITE balance is coerced, to 0, so a
 * corrupt blob cannot poison the axis domain with NaN.
 *
 * Input order is preserved so the chart matches whatever order the table is
 * showing. ⚠️ Takes a READONLY array: the page passes `useTableSort`'s
 * `sort.rows`, which is `readonly ClientSavingsGoal[]`.
 */
export function buildSavingsChartRows(goals: readonly ClientSavingsGoal[]): SavingsChartRow[] {
  return goals.map((goal) => ({
    id: goal.id,
    label: goal.name,
    saved: Number.isFinite(goal.currentBalance) ? goal.currentBalance : 0,
    target:
      goal.targetAmount !== null && Number.isFinite(goal.targetAmount) && goal.targetAmount > 0
        ? goal.targetAmount
        : null,
  }))
}

/**
 * Whether there is anything worth plotting. False for no rows, and false when
 * every row is zero with no target — a plot of nothing but zeroes is an empty
 * axis that teaches the user nothing, so AC-4 sends that case to the empty
 * state too. A row with a target but nothing saved yet IS plottable: "0 of
 * 5,000" is exactly the shape of a brand-new goal.
 */
export function hasPlottableData(rows: SavingsChartRow[]): boolean {
  return rows.some((row) => row.saved !== 0 || row.target !== null)
}

/**
 * Pixel height for the chart holding `rowCount` entries, floored at one row's
 * worth so a lone entry is never a squashed sliver.
 *
 * ⚠️ Deliberately NOT `categoryChartHeight` (`chart-axis.ts`, 64px/row + 72
 * chrome): that helper sizes a SINGLE-series chart, and this is the repo's
 * first GROUPED chart — the Saved and Target bars share each category band and
 * need more room. Same 72px chrome allowance, taller per-row slice.
 */
export function savingsChartHeight(rowCount: number): number {
  const CHROME_PX = 72
  const PER_ROW_PX = 72
  return Math.max(rowCount, 1) * PER_ROW_PX + CHROME_PX
}

/**
 * Responsive chart chrome. The narrow branch is what AC-7 shrinks at 320px: the
 * Y-axis gutter matches `CategoryBarChart`'s proven 76/132 split
 * (`HomePage.tsx:926-927`), and the bar and legend shrink with it because this
 * chart carries two bars per band and a legend the single-series charts do not.
 *
 * ⚠️ There is no SIDE legend to drop — the legend is bottom-aligned horizontal
 * at every width, deliberately, so the narrow branch never has to reflow it.
 */
export function getSavingsChartChrome(isNarrow: boolean): SavingsChartChrome {
  return isNarrow
    ? { yAxisWidth: 76, tickFontSize: 11, barSize: 10, legendFontSize: 11, labelMaxChars: 10 }
    : { yAxisWidth: 132, tickFontSize: 12, barSize: 14, legendFontSize: 12, labelMaxChars: 16 }
}

/**
 * Clamp a Y-axis category label to something the gutter can hold.
 *
 * ⚠️ NOT optional. A savings goal's name is unbounded — no `maxLength` on the
 * input, no cap in `validateSavingsGoal` — and Recharts renders axis ticks as
 * SVG `<text>`, which neither wraps nor ellipsizes. The repo's own 320px
 * fixture seeds a 138-character unbroken name (`responsive-320.spec.ts`'s
 * `LONG_UNBROKEN_NAME`, savings goal `sav-1`), which would paint straight out
 * of the 76px narrow gutter. The full name stays available in the table and in
 * the tooltip.
 */
export function truncateAxisLabel(label: string, max = AXIS_LABEL_MAX): string {
  // ⚠️ Code points, not UTF-16 units. `String.prototype.slice` cuts between the
  // halves of a surrogate pair, so a name like '💰💰💰…' would paint a lone
  // surrogate (a tofu box) immediately before the ellipsis. Emoji in a savings
  // goal name is ordinary user behaviour, not an edge case.
  const points = [...label]
  return points.length > max ? `${points.slice(0, max - 1).join('')}…` : label
}
