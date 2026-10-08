/**
 * `monthlyTotalCents` is monthly-normalized; this component denormalizes to the selected period,
 * so callers must not pre-convert.
 */

import { denormalizeFromMonthly } from '@budget-planner/core'
import type React from 'react'
import { useStoresHydrated } from '../../hooks/useStoresHydrated'
import { useFormattedAmount } from '../../stores/currencyStore'
import {
	DURATION_LABEL,
	DURATION_OPTION_LABEL,
	type OverviewDuration,
	useOverviewDuration,
	useSetOverviewDuration,
	VALID_DURATIONS,
} from '../../stores/overviewDurationStore'
import { GroupedAmount } from './GroupedAmount'
import { InfoTooltip } from './InfoTooltip'
import { PendingFigure } from './Skeleton'

interface PeriodTotalProps {
	label: string
	/** Monthly-normalized cents. Do NOT pre-denormalize. */
	monthlyTotalCents: number
	rawTotalCents: number
	conversionApplied: boolean
	unreadableCount: number
	/** Accent colour only: no `text-{size}`/`font-` class, since Tailwind resolves conflicts by source order. */
	amountClassName: string
	tooltipLabel: string
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
	const hydrated = useStoresHydrated()

	// Never re-derive the multipliers; they are core-private on purpose.
	const amountForDuration = denormalizeFromMonthly(monthlyTotalCents, duration)

	return (
		<div>
			<h2 className="flex items-center gap-1 text-xl font-semibold text-subheading">
				{`${label} ${DURATION_LABEL[duration]}`}
				{/* Gated on whether conversion happened, not on the totals differing: a conversion can land on
            the same number, and an excluded row can make them differ without one. */}
				{conversionApplied && (
					<InfoTooltip
						label={tooltipLabel}
						text={`We convert weekly, biweekly, monthly, and annual amounts to a common monthly basis so your totals are comparable — this uses an average of about 4.33 weeks a month, so these totals are estimates. Entered total before conversion: ${formatAmount(
							rawTotalCents
						)}.`}
					/>
				)}
			</h2>
			{/* `data-testid`, not a name query: the heading's accessible name includes the tooltip button's label. */}
			{/* `text-2xl` below `sm` plus `GroupedAmount` keep a denormalized annual figure from widening the page at 320px. */}
			<p
				className={`text-2xl sm:text-3xl font-bold ${amountClassName}`}
				data-testid="period-total-amount"
			>
				{hydrated ? (
					<GroupedAmount text={formatAmount(amountForDuration)} />
				) : (
					<PendingFigure testId="period-total-amount-skeleton" widthClass="w-40" />
				)}
			</p>

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
