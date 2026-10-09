import type React from 'react'
import { cn } from '@/lib/cn'
import { PULSE } from './skeleton-classes'

export type SkeletonBlockProps = {
	className?: string
	testId?: string
	/** CSS hook for a pre-paint rule in global.css, kept separate from `testId`. */
	hook?: string
	children?: React.ReactNode
}

export function SkeletonBlock({
	className,
	testId,
	hook,
	children,
}: SkeletonBlockProps): React.ReactElement {
	return (
		<div aria-hidden="true" data-testid={testId} data-hook={hook} className={cn(PULSE, className)}>
			{children}
		</div>
	)
}
