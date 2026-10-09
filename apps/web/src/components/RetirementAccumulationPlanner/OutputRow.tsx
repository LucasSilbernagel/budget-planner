import { GroupedAmount } from '../ui/GroupedAmount'

// Only `amount` rows use GroupedAmount: plain numbers like 35.2 would break at '.' in de-DE.
// The label shrinks first so a wrapped value stays right-aligned.
export function OutputRow({
	label,
	value,
	amount = false,
}: {
	label: string
	value: string
	amount?: boolean
}) {
	return (
		<div className="flex justify-between items-baseline gap-4">
			<dt className="shrink-[1000] text-sm text-green-700 dark:text-green-300">{label}</dt>
			<dd className="text-right font-semibold text-green-800 dark:text-green-200">
				{amount ? <GroupedAmount text={value} /> : value}
			</dd>
		</div>
	)
}
