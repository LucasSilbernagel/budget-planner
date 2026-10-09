import { cn } from '@/lib/cn'
import { useFormattedAmount } from '../stores/currencyStore'
import { untrustedFrequencyLabel } from './balance-frequency-labels'
import { GroupedAmount } from './ui/GroupedAmount'
import { RESPONSIVE_AMOUNT_CLASS } from './ui/ResponsiveTable'

/** An unreadable amount keeps the "Paid by" line and drops the figure rather than showing NaN. */
export function DebtPaymentCell({
	expense,
}: {
	expense: { name: unknown; amount: unknown; frequency: unknown } | null
}) {
	const formatAmount = useFormattedAmount()
	if (expense === null) {
		return <div className="text-muted text-sm">Not linked</div>
	}
	const name = typeof expense.name === 'string' ? expense.name : ''
	return (
		<div>
			{typeof expense.amount === 'number' && Number.isFinite(expense.amount) && (
				<>
					<div className={cn('text-muted text-sm', RESPONSIVE_AMOUNT_CLASS)}>
						<GroupedAmount text={formatAmount(expense.amount)} />
					</div>
					<div className="text-faint text-xs">{untrustedFrequencyLabel(expense.frequency)}</div>
				</>
			)}
			<div className="text-faint text-xs">Paid by {name}</div>
		</div>
	)
}
