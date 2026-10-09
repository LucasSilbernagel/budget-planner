import type React from 'react'
import { cn } from '@/lib/cn'

export function SwitchTrack({ on }: { on: boolean }): React.ReactElement {
	return (
		<span
			aria-hidden="true"
			className={cn(
				'relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors',
				on ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
			)}
		>
			<span
				className={cn(
					'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
					on ? 'translate-x-6' : 'translate-x-1'
				)}
			/>
		</span>
	)
}
