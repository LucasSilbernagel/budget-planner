import type React from 'react'
import { cn } from '@/lib/cn'
import { GroupedAmount } from '../../ui/GroupedAmount'

// GroupedAmount: large amounts overrun these cards, so they may break only after a group separator.
type StatCardProps = {
	label: string
	value: string
	highlight?: boolean
}

export function StatCard({ label, value, highlight }: StatCardProps): React.ReactElement {
	return (
		<div
			className={cn(
				'rounded-lg p-4 text-center',
				highlight ? 'bg-white dark:bg-gray-800 shadow' : 'bg-blue-100 dark:bg-blue-900/40'
			)}
		>
			<dt className="text-xs font-medium text-body uppercase tracking-wider">{label}</dt>
			<dd
				className={cn(
					'mt-1 text-lg font-semibold',
					highlight ? 'text-blue-600 dark:text-blue-400' : 'text-gray-800 dark:text-gray-100'
				)}
			>
				<GroupedAmount text={value} />
			</dd>
		</div>
	)
}
