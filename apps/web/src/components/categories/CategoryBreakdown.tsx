// Groups by categoryId with one Uncategorized bucket, unlike the overview pies (by name); both on purpose.
// Labels resolve through the unscoped name map: rows carry no profileId, so scoping would hide real names.

import { buildCategoryBreakdown } from '@budget-planner/core/finance/categoryBreakdown'
import { type ReactElement, useId, useMemo } from 'react'
import { Card } from '@/components/ui/Card'
import { CardTitle } from '@/components/ui/CardTitle'
import { useCategoryNameMap } from '../../hooks/useCategoryLabels'
import { useExpenses } from '../../stores/expenseStore'
import { useIncomeSources } from '../../stores/incomeStore'
import { IS_NON_INTEGRAL_CADENCE, useOverviewDuration } from '../../stores/overviewDurationStore'
import { BreakdownSide } from './category-breakdown/BreakdownSide'
import { toBreakdownItems } from './category-breakdown/breakdown-rows'

// A user can name a real category "Uncategorized", so the residual row is marked by data-uncategorized.
const UNCATEGORIZED_LABEL = 'Uncategorized'

export function CategoryBreakdown(): ReactElement {
	const incomeSources = useIncomeSources()
	const expenses = useExpenses()
	const categoryNames = useCategoryNameMap()
	const duration = useOverviewDuration()
	const headingId = useId()

	// categoryNames must stay in both dependency lists, or a rename leaves stale labels.
	const income = useMemo(
		() =>
			buildCategoryBreakdown(toBreakdownItems(incomeSources), categoryNames, {
				cadence: duration,
				uncategorizedLabel: UNCATEGORIZED_LABEL,
			}),
		[incomeSources, categoryNames, duration]
	)
	const expense = useMemo(
		() =>
			buildCategoryBreakdown(toBreakdownItems(expenses), categoryNames, {
				cadence: duration,
				uncategorizedLabel: UNCATEGORIZED_LABEL,
			}),
		[expenses, categoryNames, duration]
	)

	const hasAnyRows = income.rows.length > 0 || expense.rows.length > 0

	return (
		<Card
			as="section"
			data-testid="category-breakdown"
			aria-labelledby={headingId}
			className="p-4 sm:p-6"
		>
			{/* Not the literal "Categories", which would collide with the page heading. */}
			<CardTitle id={headingId} className="text-xl">
				Category breakdown
			</CardTitle>
			<p className="mt-1 text-sm text-muted">
				What each category totals and its share of that side. Income and expenses are separate
				wholes, so each share is measured against its own total.
			</p>
			{/* Only non-integral cadences (weekly, biweekly) diverge from the dashboard: rows round per bucket so they sum to the total. */}
			{IS_NON_INTEGRAL_CADENCE[duration] ? (
				<p className="mt-1 text-xs text-muted" data-testid="breakdown-rounding-note">
					Each category total is rounded on its own, so at this view these figures can differ from
					the dashboard total by a few cents.
				</p>
			) : null}

			{hasAnyRows ? (
				<div className="mt-6 space-y-8">
					<BreakdownSide
						side="income"
						title="Income by category"
						emptyLabel="No income to break down yet"
						rows={income.rows}
						totalCents={income.totalCents}
						duration={duration}
					/>
					<BreakdownSide
						side="expense"
						title="Expenses by category"
						emptyLabel="No expenses to break down yet"
						rows={expense.rows}
						totalCents={expense.totalCents}
						duration={duration}
					/>
				</div>
			) : (
				<Card variant="inset" className="mt-6 p-6 text-center" data-testid="breakdown-empty">
					{/* Don't imply categorizing is required: uncategorized money still gets a full breakdown. */}
					<p className="text-muted">
						Add income or expenses to see the breakdown here. Anything you have not categorized is
						grouped together, so there is no need to categorize everything first.
					</p>
				</Card>
			)}
		</Card>
	)
}
