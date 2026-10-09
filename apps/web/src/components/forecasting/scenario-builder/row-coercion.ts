import type { LocalBalanceAccount } from './types'

// Same coercion as core's sumManualAllocations, so a manual row seeds exactly what /savings counts.
export function nonNegativeCents(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}

// Assets have their own rows, so they map to null too.
export function balanceRowType(type: unknown): LocalBalanceAccount['type'] | null {
	return type === 'investment' || type === 'debt' ? type : null
}
