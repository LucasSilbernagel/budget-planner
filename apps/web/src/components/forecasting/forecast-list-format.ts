export function formatDate(dateString: string): string {
	const date = new Date(dateString)
	return date.toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	})
}

export function truncate(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text
	return `${text.slice(0, maxLength)}...`
}

// On the selected bg-blue-50 row text-muted is 4.44:1, below AA, so it switches to text-body.
export function mutedOnRow(selected: boolean): 'text-body' | 'text-muted' {
	return selected ? 'text-body' : 'text-muted'
}
