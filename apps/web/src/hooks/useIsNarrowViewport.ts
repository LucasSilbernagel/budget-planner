import { useEffect, useState } from 'react'

/** 639.98 follows Tailwind's max-width convention, so fractional widths in (639, 640) count as narrow. */
const NARROW_VIEWPORT_MAX_WIDTH = 639.98

export function useIsNarrowViewport(): boolean {
	const [isNarrow, setIsNarrow] = useState(false)

	useEffect(() => {
		if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
			return
		}

		const query = window.matchMedia(`(max-width: ${NARROW_VIEWPORT_MAX_WIDTH}px)`)
		const update = () => setIsNarrow(query.matches)

		update()

		// addEventListener is missing on iOS Safari <14 / legacy Android; calling it would throw.
		if (typeof query.addEventListener === 'function') {
			query.addEventListener('change', update)
			return () => query.removeEventListener('change', update)
		}
		query.addListener(update)
		return () => query.removeListener(update)
	}, [])

	return isNarrow
}
