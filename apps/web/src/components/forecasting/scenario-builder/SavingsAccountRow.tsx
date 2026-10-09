import type React from 'react'
import { useId } from 'react'
import { Card } from '@/components/ui/Card'
import { FormField } from '@/components/ui/FormField'
import { FormLabel } from '@/components/ui/FormLabel'
import { GroupedAmount } from '../../ui/GroupedAmount'
import { RowMoneyField } from './RowMoneyField'
import type { LocalSavingsAccount } from './types'
import { useMoneyDraft } from './useMoneyDraft'

type SavingsAccountRowProps = {
	account: LocalSavingsAccount
	position: number
	onUpdate: (
		id: string,
		field: 'name' | 'balance' | 'monthlyContribution',
		value: string | number
	) => void
	onDelete: (id: string) => void
	// One key per field, so fixing one bad field cannot unblock another.
	onValidityChange: (key: string, valid: boolean) => void
	outcome: { label: string; amount: string } | null
}

export function SavingsAccountRow({
	account,
	position,
	onUpdate,
	onDelete,
	onValidityChange,
	outcome,
}: SavingsAccountRowProps): React.ReactElement {
	const nameId = useId()
	const balance = useMoneyDraft(account.balance, `${account.id}:balance`, onValidityChange, (c) =>
		onUpdate(account.id, 'balance', c)
	)
	const contribution = useMoneyDraft(
		account.monthlyContribution,
		`${account.id}:contribution`,
		onValidityChange,
		(c) => onUpdate(account.id, 'monthlyContribution', c)
	)
	// Each accessible name carries the row's name, or a screen reader hears "Balance" N times.
	const rowName = account.name.trim()
	const rowLabel = rowName === '' ? 'account' : rowName

	return (
		<Card className="p-4 shadow-sm border border-default">
			<div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
				<FormField className="min-w-0">
					<FormLabel htmlFor={nameId}>Account Name</FormLabel>
					<input
						id={nameId}
						type="text"
						value={account.name}
						onChange={(e) => onUpdate(account.id, 'name', e.target.value)}
						// Labelled by position, not the row name: this field is the name and would rename itself while typed in.
						aria-label={`Account Name, row ${position}`}
						autoComplete="off"
						className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded text-sm"
						placeholder="Savings account or goal"
					/>
				</FormField>

				<RowMoneyField label="Balance" rowLabel={rowLabel} field={balance} />
				<RowMoneyField label="Monthly Contribution" rowLabel={rowLabel} field={contribution} />

				<div className="flex justify-end">
					<button
						type="button"
						onClick={() => onDelete(account.id)}
						// Unique per row, or every row's button has the same name.
						aria-label={rowName === '' ? 'Remove account' : `Remove ${rowName}`}
						className="px-2 py-1.5 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded text-xs font-medium hover:bg-red-200 hover:text-red-800 dark:hover:bg-red-900/60 dark:hover:text-red-300 transition-colors"
					>
						Remove
					</button>
				</div>
			</div>
			{/* Plain text, not a live region: it changes on every recompute. */}
			{outcome && (
				<p className="mt-3 text-sm text-body">
					{outcome.label} <GroupedAmount text={outcome.amount} />
				</p>
			)}
		</Card>
	)
}
