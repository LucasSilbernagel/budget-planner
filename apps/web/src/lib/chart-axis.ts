import {
  type CurrencyCode,
  type CurrencyMode,
  currencySymbol,
} from '@budget-planner/core/format/currency'

/**
 * Shared numeric-axis helpers for the dashboard Recharts charts.
 *
 * Extracted so the Net Worth Projection, Retirement Timeline, and Financial
 * Category Summary charts format their value axes identically instead of each
 * re-deriving the logic (they had started to drift into per-file copies).
 */

/**
 * Compact, currency-mode-aware label for a numeric axis tick, given a value in
 * whole currency UNITS (not cents). A chart's value axis is narrow, so full
 * grouped amounts (e.g. "439,363.05") overflow it and clip to fragments; and the
 * core `abbreviate` option is a no-op in currency-less mode (the app default).
 * So abbreviate to K/M/B and drop the cents here — tooltips keep the precise
 * value. Callers whose axis is in cents should pass `cents / 100`.
 */
export function formatCompactAxisTick(
  value: number,
  mode: CurrencyMode,
  currency: CurrencyCode
): string {
  // Mirror the canonical `formatCurrency`, which coerces non-finite input to 0
  // rather than surfacing a literal "NaN" / "InfinityM" label on the axis.
  const safe = Number.isFinite(value) ? value : 0
  const abs = Math.abs(safe)
  let compact: string
  if (abs >= 1_000_000) {
    compact = `${(safe / 1_000_000).toFixed(1)}M`
  } else if (abs >= 1_000) {
    // Round in the K band first: a value like 999,600 rounds up to 1,000K, which
    // must roll over to "1.0M" instead of printing "1000K".
    const thousands = safe / 1_000
    compact =
      Math.abs(Math.round(thousands)) >= 1_000
        ? `${(safe / 1_000_000).toFixed(1)}M`
        : `${thousands.toFixed(0)}K`
  } else {
    compact = `${Math.round(safe)}`
  }
  // `formatCurrency` treats `currency === 'NONE'` as symbol-less regardless of
  // mode; mirror that so a stale `{mode:'symbol', currency:'NONE'}` pairing (a
  // reachable persisted-blob state) does not prefix the literal "NONE" onto
  // every tick.
  return mode === 'symbol' && currency !== 'NONE'
    ? `${currencySymbol(currency)}${compact}`
    : compact
}

/**
 * Round, evenly-spaced tick values spanning [min, max], with both ends rounded
 * outward to a "nice" 1/2/5×10ⁿ step, so a numeric axis reads as round numbers
 * instead of arbitrary data-derived endpoints (e.g. "-2,551 … 7,801"). Clamp
 * min/max to include 0 before calling if the axis needs a zero baseline (a
 * diverging bar chart). Unit-agnostic — returns ticks in the same space as the
 * inputs (cents in → cents out).
 */
export function niceAxisTicks(min: number, max: number, targetCount = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return [Math.round(min) || 0]
  }
  const rawStep = (max - min) / Math.max(1, targetCount)
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const normalized = rawStep / magnitude
  const niceUnit = normalized < 1.5 ? 1 : normalized < 3 ? 2 : normalized < 7 ? 5 : 10
  const step = niceUnit * magnitude
  const start = Math.floor(min / step) * step
  const end = Math.ceil(max / step) * step
  const ticks: number[] = []
  // Round each tick to the step's own precision so float-accumulation error is
  // cleaned WITHOUT collapsing sub-unit steps into duplicates: a 0.5 step must
  // keep 0.5 / 1.5, not `Math.round` them to 0 / 1 / 1 / 2. Integer steps (the
  // cents-space callers) resolve to `decimals = 0`, i.e. whole numbers as before.
  // Nice steps are always 1/2/5×10ⁿ, so this precision is exact for every step.
  const decimals = step >= 1 ? 0 : Math.ceil(-Math.log10(step))
  // The `ticks.length` cap guards against a pathological step producing an
  // unbounded loop; a well-formed [min,max] yields ~targetCount ticks.
  for (let tick = start; tick <= end + step / 2 && ticks.length <= 100; tick += step) {
    ticks.push(Number(tick.toFixed(decimals)))
  }
  return ticks
}
