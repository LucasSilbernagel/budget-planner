import type React from 'react'
import { useId } from 'react'
import { Card } from '@/components/ui/Card'
import { FormField } from '@/components/ui/FormField'
import { FormLabel } from '@/components/ui/FormLabel'
import { RowMoneyField } from './RowMoneyField'
import type { LocalAssetAccount } from './types'
import { useMoneyDraft } from './useMoneyDraft'

type AssetAccountRowProps = {
	account: LocalAssetAccount
	position: number
	onUpdate: (id: string, field: 'name' | 'balance', value: string | number) => void
	onDelete: (id: string) => void
	onValidityChange: (key: string, valid: boolean) => void
}

export function AssetAccountRow({
	account,
	position,
	onUpdate,
	onDelete,
	onValidityChange,
}: AssetAccountRowProps): React.ReactElement {
	const nameId = useId()
	const value = useMoneyDraft(account.balance, `${account.id}:value`, onValidityChange, (c) =>
		onUpdate(account.id, 'balance', c)
	)
	const rowName = account.name.trim()
	const rowLabel = rowName === '' ? 'unnamed asset' : rowName

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
						aria-label={`Asset Name, row ${position}`}
						autoComplete="off"
						className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded text-sm"
						placeholder="House, car"
					/>
				</FormField>

				{/* "Value", not "Balance", so it is never named like a balance row's field. */}
				<RowMoneyField label="Value" rowLabel={rowLabel} field={value} />

				<div className="flex justify-end">
					<button
						type="button"
						onClick={() => onDelete(account.id)}
						aria-label={rowName === '' ? 'Remove asset' : `Remove ${rowName}`}
						className="px-2 py-1.5 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded text-xs font-medium hover:bg-red-200 hover:text-red-800 dark:hover:bg-red-900/60 dark:hover:text-red-300 transition-colors"
					>
						Remove
					</button>
				</div>
			</div>
		</Card>
	)
}
