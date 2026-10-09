/**
 * Skeletons render identically on server and first client render, are `aria-hidden`, and are sized
 * by the caller. The single announcement per page comes from `LoadingStatus`.
 */

import type React from 'react'
import { cn } from '@/lib/cn'
import { PULSE } from './skeleton-classes'

export type SkeletonProps = {
	/** Required: a skeleton with no size satisfies presence assertions while reserving no space. */
	className: string
	testId?: string
}

/** A `<span>`, so it is legal inside a `<p>` or `<td>`. */
export function Skeleton({ className, testId }: SkeletonProps): React.ReactElement {
	return <span aria-hidden="true" data-testid={testId} className={cn(PULSE, className)} />
}
