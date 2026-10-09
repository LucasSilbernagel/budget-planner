import type React from 'react'
import { RowPercentField } from './RowPercentField'
import type { LocalBalanceAccount, UpdateBalanceAccount } from './types'
import { usePercentDraft } from './usePercentDraft'

// Its own component so it unmounts with the type, withdrawing its validity report.
export function AnnualReturnField({
	account,
	rowLabel,
	onUpdate,
	onValidityChange,
}: {
	account: LocalBalanceAccount
	rowLabel: string
	onUpdate: UpdateBalanceAccount
	onValidityChange: (key: string, valid: boolean) => void
}): React.ReactElement {
	const rate = usePercentDraft(
		account.annualReturn,
		`${account.id}:annualReturn`,
		onValidityChange,
		(r) => onUpdate(account.id, 'annualReturn', r)
	)
	return <RowPercentField label="Annual return" rowLabel={rowLabel} field={rate} />
}
