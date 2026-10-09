import type React from 'react'
import { cn } from '@/lib/cn'
import { LockIcon } from '../icons/LockIcon'

export type PremiumLockBadgeProps = {
	className?: string
}

export function PremiumLockBadge({ className }: PremiumLockBadgeProps): React.ReactElement {
	return (
		<span
			className={cn(
				'inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
				className
			)}
		>
			<LockIcon className="h-3 w-3" />
			Premium
		</span>
	)
}
