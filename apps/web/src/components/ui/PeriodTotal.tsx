/**
 * A headline flow total that states the period it covers (story 32.1, FR58).
 *
 * Used by the Income and Expenses pages. Both render the identical chrome —
 * period-suffixed heading, duration selector, normalization disclosure and
 * excluded-row disclosure — and the repo has already paid for this kind of
 * copy-paste twice (`DURATION_LABEL` / `CADENCE_LABEL`), so it lives in one
 * place from the start.
 *
 * ## Contract
 *
 * `monthlyTotalCents` is MONTHLY-NORMALIZED cents, straight from
 * `getTotalIncome()` / `getTotalExpenses()`. This component owns the
 * denormalization to the selected period — callers must not pre-convert, or the
 * value is scaled twice.
 *
 * The duration comes from the shared `overviewDurationStore`, so changing it
 * here also changes the Overview and the category breakdown. That is the point:
 * one period preference for the whole app (AC-3).
 */

import { denormalizeFromMonthly } from '@budget-planner/core'
import type React from 'react'
import { useFormattedAmount } from '../../stores/currencyStore'
import {
  DURATION_LABEL,
  DURATION_OPTION_LABEL,
  type OverviewDuration,
  VALID_DURATIONS,
  useOverviewDuration,
  useSetOverviewDuration,
} from '../../stores/overviewDurationStore'
import { InfoTooltip } from './InfoTooltip'

interface PeriodTotalProps {
  /** e.g. "Total Income" — the period suffix is appended for you. */
  label: string
  /** Monthly-normalized cents. Do NOT pre-denormalize. */
  monthlyTotalCents: number
  /**
   * Sum of entered amounts across READABLE rows only, unconverted. Quoted inside
   * the disclosure as "before conversion"; never displayed as the total.
   */
  rawTotalCents: number
  /**
   * Whether any readable row is on a non-monthly cadence — i.e. whether
   * conversion actually happened. Gates the disclosure.
   */
  conversionApplied: boolean
  /** Rows the store had to exclude because core could not read them. */
  unreadableCount: number
  /** Tailwind classes for the amount, so each page keeps its accent colour. */
  amountClassName: string
  /** Accessible name for the info affordance, e.g. "…the income figure". */
  tooltipLabel: string
  /** Distinguishes the two selectors for tests and screen readers. */
  selectorLabel: string
}

export function PeriodTotal({
  label,
  monthlyTotalCents,
  rawTotalCents,
  conversionApplied,
  unreadableCount,
  amountClassName,
  tooltipLabel,
  selectorLabel,
}: PeriodTotalProps): React.ReactElement {
  const formatAmount = useFormattedAmount()
  const duration = useOverviewDuration()
  const setDuration = useSetOverviewDuration()

  // Re-express the monthly-canonical total at the selected period using the core
  // engine. Never re-derive the multipliers — they are core-private on purpose.
  const amountForDuration = denormalizeFromMonthly(monthlyTotalCents, duration)

  return (
    <div>
      <h2 className="flex items-center gap-1 text-xl font-semibold text-subheading">
        {`${label} ${DURATION_LABEL[duration]}`}
        {/* ⚠️ Gated on whether conversion HAPPENED, not on whether the two totals
            differ. Code review 32.1 caught the equality proxy failing both ways:
            it fired on an excluded corrupt row (announcing a conversion that
            never occurred, while quoting money the total excluded), and it stayed
            silent when a genuine conversion happened to land on the same number
            ($330 weekly + $1,200 annually both give 153000c). See
            `lib/readable-rows.ts` → `summarizeReadableRows`. */}
        {conversionApplied && (
          <InfoTooltip
            label={tooltipLabel}
            text={`We convert weekly, biweekly, monthly, and annual amounts to a common monthly basis so your totals are comparable — this uses an average of about 4.33 weeks a month, so these totals are estimates. Entered total before conversion: ${formatAmount(
              rawTotalCents
            )}.`}
          />
        )}
      </h2>
      {/* ⚠️ `data-testid`, not sibling traversal from the heading. The heading
          contains the InfoTooltip button, so its ACCESSIBLE NAME includes that
          button's label — an anchored `^…$` name matcher silently finds nothing
          in a real browser (jsdom's accname implementation disagrees, so unit
          tests alone will not catch it). */}
      <p className={amountClassName} data-testid="period-total-amount">
        {formatAmount(amountForDuration)}
      </p>

      {/* ⚠️ Disclosure, not silence. A row core cannot read is EXCLUDED from the
          figure above; saying so is what keeps an excluded row from being a
          silently under-reported total. See lib/readable-rows. */}
      {unreadableCount > 0 && (
        <p className="mt-1 text-xs text-muted" data-testid="unreadable-rows-note">
          {unreadableCount === 1
            ? '1 entry could not be read and is not included in this total.'
            : `${unreadableCount} entries could not be read and are not included in this total.`}
        </p>
      )}

      <label className="mt-2 flex items-center gap-1 text-sm text-label">
        <span className="sr-only">{selectorLabel}</span>
        <select
          aria-label={selectorLabel}
          value={duration}
          onChange={(e) => setDuration(e.target.value as OverviewDuration)}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
        >
          {VALID_DURATIONS.map((value) => (
            <option key={value} value={value}>
              {DURATION_OPTION_LABEL[value]}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
