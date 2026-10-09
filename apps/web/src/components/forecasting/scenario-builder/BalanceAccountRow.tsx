import type React from 'react'
import { useId } from 'react'
import { Card } from '@/components/ui/Card'
import { FormField } from '@/components/ui/FormField'
import { FormLabel } from '@/components/ui/FormLabel'
import { isKnownFrequency } from '../../../lib/readable-rows'
import { GroupedAmount } from '../../ui/GroupedAmount'
import { AnnualReturnField } from './AnnualReturnField'
import { FREQUENCY_OPTIONS } from './frequency-options'
import { RowMoneyField } from './RowMoneyField'
import type { LocalBalanceAccount, UpdateBalanceAccount } from './types'
import { useMoneyDraft } from './useMoneyDraft'

const NOT_FROM_LEFT_OVER_LABEL = 'Not taken from the money left over'
const PAYMENT_IN_EXPENSES_LABEL = 'Payment already in Expenses'
const BALANCE_TYPE_OPTIONS = [
	{ value: 'investment' as const, label: 'Investment' },
	{ value: 'debt' as const, label: 'Debt' },
]

type BalanceAccountRowProps = {
	account: LocalBalanceAccount
	position: number
	onUpdate: UpdateBalanceAccount
	onDelete: (id: string) => void
	onValidityChange: (key: string, valid: boolean) => void
	outcome: { label: string; amount?: string } | null
}

export function BalanceAccountRow({
	account,
	position,
	onUpdate,
	onDelete,
	onValidityChange,
	outcome,
}: BalanceAccountRowProps): React.ReactElement {
	const nameId = useId()
	const typeId = useId()
	const frequencyId = useId()
	const flagId = useId()
	const balance = useMoneyDraft(account.balance, `${account.id}:balance`, onValidityChange, (c) =>
		onUpdate(account.id, 'balance', c)
	)
	const contribution = useMoneyDraft(
		account.contribution,
		`${account.id}:contribution`,
		onValidityChange,
		(c) => onUpdate(account.id, 'contribution', c)
	)
	const rowName = account.name.trim()
	const rowLabel = rowName === '' ? 'unnamed balance' : rowName
	const isInvestment = account.type === 'investment'
	const flagLabel = isInvestment ? NOT_FROM_LEFT_OVER_LABEL : PAYMENT_IN_EXPENSES_LABEL
	const showFlag = isInvestment || !account.paidByExpenseName
	const selectClass =
		'w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded text-sm'

	return (
		<Card className="p-4 shadow-sm border border-default">
			<div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
				<FormField className="min-w-0">
					<FormLabel htmlFor={nameId}>Name</FormLabel>
					<input
						id={nameId}
						type="text"
						value={account.name}
						onChange={(e) => onUpdate(account.id, 'name', e.target.value)}
						aria-label={`Balance Name, row ${position}`}
						autoComplete="off"
						className={selectClass}
						placeholder="Investment or debt"
					/>
				</FormField>

				<FormField>
					<FormLabel htmlFor={typeId}>Type</FormLabel>
					<select
						id={typeId}
						value={account.type}
						onChange={(e) =>
							onUpdate(account.id, 'type', e.target.value === 'debt' ? 'debt' : 'investment')
						}
						aria-label={`Type for ${rowLabel}`}
						autoComplete="off"
						className={selectClass}
					>
						{BALANCE_TYPE_OPTIONS.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				</FormField>

				<RowMoneyField label="Balance" rowLabel={rowLabel} field={balance} />
				<RowMoneyField label="Contribution" rowLabel={rowLabel} field={contribution} />

				<FormField>
					<FormLabel htmlFor={frequencyId}>Frequency</FormLabel>
					<select
						id={frequencyId}
						value={account.frequency}
						onChange={(e) =>
							onUpdate(
								account.id,
								'frequency',
								isKnownFrequency(e.target.value) ? e.target.value : 'monthly'
							)
						}
						aria-label={`Frequency for ${rowLabel}`}
						autoComplete="off"
						className={selectClass}
					>
						{FREQUENCY_OPTIONS.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				</FormField>

				{/* Its own component, so switching to Debt unmounts it and withdraws its validity key. */}
				{isInvestment && (
					<AnnualReturnField
						account={account}
						rowLabel={rowLabel}
						onUpdate={onUpdate}
						onValidityChange={onValidityChange}
					/>
				)}

				{/* md:col-start-3 keeps it in the last column when Annual return wraps it onto its own row. */}
				<div className="flex justify-end md:col-start-3">
					<button
						type="button"
						onClick={() => onDelete(account.id)}
						aria-label={rowName === '' ? 'Remove balance' : `Remove ${rowName}`}
						className="px-2 py-1.5 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded text-xs font-medium hover:bg-red-200 hover:text-red-800 dark:hover:bg-red-900/60 dark:hover:text-red-300 transition-colors"
					>
						Remove
					</button>
				</div>
			</div>
			{/* break-words so a long expense name wraps at 320px. */}
			{!isInvestment && account.paidByExpenseName && (
				<p className="mt-3 text-sm text-faint break-words min-w-0">
					from Expenses: {account.paidByExpenseName}
				</p>
			)}
			{/* Hidden on a debt row with a from-Expenses label: its payment is the row's own, and ticking it would
count that payment nowhere. */}
			{showFlag && (
				<div className="mt-3 flex items-start gap-2">
					<input
						id={flagId}
						type="checkbox"
						checked={account.contributionRecordedAsExpense}
						onChange={(e) =>
							onUpdate(account.id, 'contributionRecordedAsExpense', e.target.checked)
						}
						aria-label={`${flagLabel}, for ${rowLabel}`}
						autoComplete="off"
						className="mt-0.5 h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600"
					/>
					<label htmlFor={flagId} className="text-sm text-label">
						{flagLabel}
					</label>
				</div>
			)}
			{/* Plain text, not a live region: it changes on every recompute. */}
			{outcome && (
				<p className="mt-3 text-sm text-body">
					{outcome.label}
					{outcome.amount !== undefined && (
						<>
							{' '}
							<GroupedAmount text={outcome.amount} />
						</>
					)}
				</p>
			)}
		</Card>
	)
}
