import { useEffect } from 'react'

// Withdraws the report on unmount, so a removed row can never keep Save blocked.
export function useWithdrawValidityOnUnmount(
	rowId: string,
	onValidityChange: (rowId: string, valid: boolean) => void
): void {
	useEffect(() => () => onValidityChange(rowId, true), [rowId, onValidityChange])
}
