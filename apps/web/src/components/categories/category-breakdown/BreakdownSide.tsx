import type { CategoryBreakdownRow } from '@budget-planner/core/finance/categoryBreakdown'
import type { CategoryKind } from '@budget-planner/core/finance/categoryKind'
import { generateColorMap } from '@budget-planner/core/finance/visualization'
import { type ReactElement, useId } from 'react'
import { Card } from '@/components/ui/Card'
import { useFormattedAmount } from '../../../stores/currencyStore'
import { DURATION_LABEL, type OverviewDuration } from '../../../stores/overviewDurationStore'
import { BreakdownBarChart } from './BreakdownBarChart'
import { rowKey } from './breakdown-rows'

type BreakdownSideProps = {
	side: CategoryKind
	title: string
	emptyLabel: string
	rows: CategoryBreakdownRow[]
	totalCents: number
	duration: OverviewDuration
}

// Each side is its own whole, so shares never use a combined denominator.
export function BreakdownSide({
	side,
	title,
	emptyLabel,
	rows,
	totalCents,
	duration,
}: BreakdownSideProps): ReactElement {
	const formatAmount = useFormattedAmount()
	const headingId = useId()
	const heading = `${title} ${DURATION_LABEL[duration]}`

	// Shares of a net total only mean something when every row has the same sign; a mixed-sign
	// net can be near zero (+100 vs -99.99 = 1,000,000%). An exact test, since no threshold separates 200% from that.
	const sharesAreMeaningful =
		rows.every((row) => row.totalCents >= 0) || rows.every((row) => row.totalCents <= 0)

	if (rows.length === 0) {
		return (
			<div>
				<h3 id={headingId} className="text-sm font-semibold text-label">
					{heading}
				</h3>
				<Card
					variant="inset"
					className="mt-2 p-6 text-center"
					data-testid={`breakdown-${side}-empty`}
				>
					<p className="text-muted">{emptyLabel}</p>
				</Card>
			</div>
		)
	}

	// generateColorMap assigns by array index, so sort keys to keep colours stable when rows reorder by magnitude.
	const colors = generateColorMap([...rows.map(rowKey)].sort())

	return (
		<div>
			<h3 id={headingId} className="text-sm font-semibold text-label">
				{heading}
			</h3>

			{/* table-fixed + break-words keep a 255-character name from overflowing 320px. */}
			<table
				className="mt-2 w-full table-fixed text-sm"
				data-testid={`breakdown-${side}-table`}
				aria-labelledby={headingId}
			>
				<thead className="surface-inset">
					<tr>
						<th
							scope="col"
							className="w-1/2 px-2 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted"
						>
							Category
						</th>
						<th
							scope="col"
							className="px-2 py-2 text-right text-xs font-medium uppercase tracking-wider text-muted"
						>
							Total
						</th>
						<th
							scope="col"
							className="px-2 py-2 text-right text-xs font-medium uppercase tracking-wider text-muted"
						>
							Share
						</th>
					</tr>
				</thead>
				<tbody className="divide-y divide-gray-200 dark:divide-gray-700">
					{rows.map((row) => (
						<tr
							key={rowKey(row)}
							data-testid={`breakdown-${side}-row`}
							data-category-key={rowKey(row)}
							data-uncategorized={row.categoryId === null ? 'true' : undefined}
						>
							<th
								scope="row"
								className={
									row.categoryId === null
										? 'min-w-0 break-words px-2 py-2 text-left font-medium italic text-muted'
										: 'min-w-0 break-words px-2 py-2 text-left font-medium text-heading'
								}
							>
								{row.label}
							</th>
							<td className="px-2 py-2 text-right tabular-nums text-body">
								{formatAmount(row.totalCents)}
							</td>
							<td className="px-2 py-2 text-right tabular-nums text-body">
								{sharesAreMeaningful ? `${row.sharePercent.toFixed(1)}%` : '—'}
							</td>
						</tr>
					))}
				</tbody>
				<tfoot className="surface-inset">
					<tr data-testid={`breakdown-${side}-total`}>
						<th scope="row" className="px-2 py-2 text-left font-semibold text-heading">
							Total
						</th>
						<td className="px-2 py-2 text-right font-semibold tabular-nums text-heading">
							{formatAmount(totalCents)}
						</td>
						<td className="px-2 py-2" />
					</tr>
				</tfoot>
			</table>

			{sharesAreMeaningful ? null : (
				<p className="mt-2 text-xs text-muted" data-testid={`breakdown-${side}-share-suppressed`}>
					Shares are hidden here because this side mixes positive and negative amounts, which leaves
					no meaningful whole to measure each category against.
				</p>
			)}

			<BreakdownBarChart rows={rows} colors={colors} testId={`breakdown-${side}-chart`} />
		</div>
	)
}
