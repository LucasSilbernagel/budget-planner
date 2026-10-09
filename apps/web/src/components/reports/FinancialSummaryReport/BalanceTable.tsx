import type React from 'react'
import { cn } from '@/lib/cn'
import { useFormattedAmount } from '../../../stores/currencyStore'
import { TableScrollRegion } from '../../ui/TableScrollRegion'
import {
	NAME_WRAP_CLASS,
	TABLE_CLASS,
	TABLE_REGION_CLASS,
	TD_CLASS,
	TD_NUMERIC_CLASS,
	TH_CLASS,
	TH_NUMERIC_CLASS,
} from './report-table-classes'

export function BalanceTable({
	caption,
	rows,
}: {
	caption: string
	rows: readonly { id: string; name: string; balanceCents: number }[]
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
							Balance
						</th>
					</tr>
				</thead>
				<tbody className="divide-y divide-gray-200 dark:divide-gray-700">
					{rows.map((row) => (
						<tr key={row.id}>
							{/* text-left: same UA-default fix as CashflowTable's row header. */}
							<th scope="row" className={cn(TD_CLASS, 'font-normal text-left', NAME_WRAP_CLASS)}>
								{row.name}
							</th>
							<td className={TD_NUMERIC_CLASS}>{format(row.balanceCents)}</td>
						</tr>
					))}
				</tbody>
			</table>
		</TableScrollRegion>
	)
}
