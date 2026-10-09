export function formatPercent(percent: number | null): string {
	return percent === null ? '—' : `${Math.round(percent)}%`
}

// Must distinguish 'nothing added' from 'nothing readable', or it contradicts the disclosure below.
export function emptySectionCopy(unreadableCount: number, nothingAdded: string): string {
	return unreadableCount > 0
		? 'None of the entries saved for this section could be read, so it has no figures to show.'
		: nothingAdded
}
