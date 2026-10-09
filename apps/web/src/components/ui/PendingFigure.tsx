import type React from 'react'
import { cn } from '@/lib/cn'
import { Skeleton } from './Skeleton'
import { SKELETON_BAR } from './skeleton-classes'

export type PendingFigureProps = {
	/** Label only the first bar of a multi-bar placeholder, or count assertions break. */
	testId?: string
	/** Bar width only; the height is `1em`. */
	widthClass?: string
}

/**
 * Replace only the figure's content: `h-[1em]` sits inside the `<p>`'s strut (tight at `text-3xl` on DejaVu).
 * Inside a flex container there is no strut; use the container's line-height (e.g. `h-6`) instead.
 */
export function PendingFigure({
	testId,
	widthClass = 'w-28',
}: PendingFigureProps): React.ReactElement {
	return (
		<Skeleton
			testId={testId}
			className={cn(SKELETON_BAR, 'inline-block h-[1em] align-middle', widthClass)}
		/>
	)
}
