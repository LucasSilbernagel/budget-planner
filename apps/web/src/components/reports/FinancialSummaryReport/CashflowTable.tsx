import { denormalizeFromMonthly } from '@budget-planner/core/finance/normalization'
import type React from 'react'
import { cn } from '@/lib/cn'
import type { ReportCashflowRow } from '../../../lib/report/build-financial-summary'
import { useFormattedAmount } from '../../../stores/currencyStore'
import { TableScrollRegion } from '../../ui/TableScrollRegion'
import { BUDGET_PERIOD_LABEL, type BudgetPeriod } from './budget-period'
import {
	NAME_WRAP_CLASS,
	TABLE_CLASS,
	TABLE_REGION_CLASS,
	TD_CLASS,
	TD_NUMERIC_CLASS,
	TH_CLASS,
	TH_NUMERIC_CLASS,
} from './report-table-classes'

const FREQUENCY_LABELS: Record<string, string> = {
	weekly: 'Weekly',
	biweekly: 'Biweekly',
	monthly: 'Monthly',
	annually: 'Annually',
}

export function CashflowTable({
	caption,
	rows,
	period,
}: {
	caption: string
	rows: readonly ReportCashflowRow[]
	period: BudgetPeriod
}): React.ReactElement {
	const format = useFormattedAmount()
	return (
		<TableScrollRegion label={`${caption} table`} className={TABLE_REGION_CLASS}>
			<table className={TABLE_CLASS}>
				<caption className="text-left text-sm font-medium text-subheading">{caption}</caption>
				<thead className="surface-inset">
					<tr>
						<th scope="col" className={TH_CLASS}>
							Name
						</th>
						<th scope="col" className={TH_NUMERIC_CLASS}>
							Amount
						</th>
						<th scope="col" className={TH_CLASS}>
							Frequency
						</th>
						<th scope="col" className={TH_NUMERIC_CLASS}>
							{BUDGET_PERIOD_LABEL[period].word}
						</th>
					</tr>
				</thead>
				<tbody className="divide-y divide-gray-200 dark:divide-gray-700">
					{rows.map((row) => (
						<tr key={row.id}>
							{/* Explicit text-left: an unstyled <th> takes the UA default centre and Preflight does not reset it.
                 Per call site, not on TD_CLASS, which TD_NUMERIC_CLASS extends with text-right. */}
							<th scope="row" className={cn(TD_CLASS, 'font-normal text-left', NAME_WRAP_CLASS)}>
								{row.name}
							</th>
							{/* What the user entered: unaffected by the period control. */}
							<td className={TD_NUMERIC_CLASS}>{format(row.amountCents)}</td>
							<td className={TD_CLASS}>{FREQUENCY_LABELS[row.frequency] ?? row.frequency}</td>
							{/* At the row's own cadence print what was typed: round-tripping the rounded monthly cents is lossy
                 (100.00/yr gives 99.96). Accepted cost: the column may differ from the total by a few cents. */}
							<td className={TD_NUMERIC_CLASS}>
								{format(
									period === row.frequency
										? row.amountCents
										: denormalizeFromMonthly(row.monthlyCents, period)
								)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</TableScrollRegion>
	)
}
