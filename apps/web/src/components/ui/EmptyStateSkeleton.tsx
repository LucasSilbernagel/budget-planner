import type React from 'react'
import { cn } from '@/lib/cn'
import { SkeletonBlock } from './SkeletonBlock'
import { SKELETON_BAR } from './skeleton-classes'

export type EmptyStateSkeletonProps = {
	testId: string
	lines?: 1 | 2
}

/** Matches the resolved EMPTY state's footprint, not the populated one. */
export function EmptyStateSkeleton({
	testId,
	lines = 2,
}: EmptyStateSkeletonProps): React.ReactElement {
	return (
		<SkeletonBlock className="surface-inset rounded-lg p-8 text-center" testId={testId}>
			<p className={lines === 2 ? 'mb-4' : undefined}>
				<span className={cn(SKELETON_BAR, 'inline-block h-[1em] w-48 max-w-full align-middle')} />
			</p>
			{lines === 2 && (
				<p className="text-sm">
					<span className={cn(SKELETON_BAR, 'inline-block h-[1em] w-64 max-w-full align-middle')} />
				</p>
			)}
		</SkeletonBlock>
	)
}
