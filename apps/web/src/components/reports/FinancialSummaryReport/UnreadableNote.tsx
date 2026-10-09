import type React from 'react'

export function UnreadableNote({ count }: { count: number }): React.ReactElement | null {
	if (count === 0) {
		return null
	}
	return (
		<p className="mt-3 text-sm text-muted">
			{count === 1
				? '1 entry could not be read and is not included in these figures.'
				: `${count} entries could not be read and are not included in these figures.`}
		</p>
	)
}
