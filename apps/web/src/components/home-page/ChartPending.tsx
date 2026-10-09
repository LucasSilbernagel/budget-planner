import type React from 'react'
import { cn } from '@/lib/cn'
import { SKELETON_BAR } from '../ui/skeleton-classes'

// The caller owns the box: keep this `h-full w-full` only.
export function ChartPending(): React.ReactElement {
	return (
		<div
			aria-hidden="true"
			className={cn(SKELETON_BAR, 'h-full w-full motion-safe:animate-pulse')}
		/>
	)
}
