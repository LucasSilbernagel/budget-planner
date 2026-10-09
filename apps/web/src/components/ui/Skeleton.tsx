import { cn } from '@/lib/cn'
/**
 * Skeletons render identically on server and first client render, are `aria-hidden`, and are sized
 * by the caller. The single announcement per page comes from `LoadingStatus`.
 */

import type React from 'react'

/** `motion-safe:`: without JS the pending state lasts forever, and an endless pulse fails WCAG 2.2.2. */
const PULSE = 'motion-safe:animate-pulse'

export type SkeletonProps = {
	/** Required: a skeleton with no size satisfies presence assertions while reserving no space. */
	className: string
	testId?: string
}

/** A `<span>`, so it is legal inside a `<p>` or `<td>`. */
export function Skeleton({ className, testId }: SkeletonProps): React.ReactElement {
	return <span aria-hidden="true" data-testid={testId} className={cn(PULSE, className)} />
}

/** Not baked into `Skeleton`: Tailwind resolves conflicting backgrounds by source order, not class order. */
export const SKELETON_BAR = 'rounded bg-gray-200 dark:bg-gray-700'

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

/**
 * One per page, never one per skeleton. The message is text content, not an `aria-label`:
 * an empty live region announces nothing.
 */
export function LoadingStatus(): React.ReactElement {
	return (
		<div role="status" data-testid="page-loading-status" className="sr-only">
			Loading your figures
		</div>
	)
}

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
