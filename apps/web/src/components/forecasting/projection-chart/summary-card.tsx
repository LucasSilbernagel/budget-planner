import type React from 'react'
import { Card } from '@/components/ui/Card'
import { cn } from '@/lib/cn'
import { useFormattedAmount } from '../../../stores/currencyStore'
import { GroupedAmount } from '../../ui/GroupedAmount'

// GroupedAmount: large amounts overflow these narrow cards, so they may break only after a group separator.
type SummaryCardProps = {
	label: string
	value: string
	change: number
	positive?: boolean
}

export function SummaryCard({ label, value, change }: SummaryCardProps): React.ReactElement {
	const formatCurrency = useFormattedAmount()
	const changeFormatted = formatCurrency(change)
	const isPositive = change >= 0

	return (
		// A <dl> group may hold only <dt> and <dd>, so the change line is a block span inside the <dd>.
		<Card variant="inset" className="p-4">
			<dt className="text-sm font-medium text-muted">{label}</dt>
			<dd className="mt-1 text-lg font-semibold text-subheading">
				<GroupedAmount text={value} />
				{change !== 0 && (
					<span
						className={cn(
							'mt-1 block text-xs font-medium',
							isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
						)}
					>
						{isPositive ? '+' : ''}
						{changeFormatted}
					</span>
				)}
			</dd>
		</Card>
	)
}
