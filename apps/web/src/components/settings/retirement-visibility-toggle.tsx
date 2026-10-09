import type React from 'react'
import { cn } from '@/lib/cn'
import {
	useShowRetirementPlanner,
	useToggleRetirementPlanner,
} from '../../stores/plannerVisibilityStore'

// The accessible name must not contain "dark mode": a settings test filters
// every switch on /dark mode/i.
export type RetirementVisibilityToggleProps = {
	className?: string
	describedBy?: string
}

const CONTROL_CLASS =
	'inline-flex items-center gap-2 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2'

export function RetirementVisibilityToggle({
	className,
	describedBy,
}: RetirementVisibilityToggleProps): React.ReactElement {
	const showRetirementPlanner = useShowRetirementPlanner()
	const toggleRetirementPlanner = useToggleRetirementPlanner()

	const controlClass = cn(CONTROL_CLASS, className)

	return (
		<button
			type="button"
			role="switch"
			aria-checked={showRetirementPlanner}
			aria-describedby={describedBy}
			onClick={toggleRetirementPlanner}
			className={controlClass}
		>
			<span className="text-sm font-medium text-gray-700 dark:text-gray-300">
				Show Retirement planner
			</span>
			<SwitchTrack on={showRetirementPlanner} />
		</button>
	)
}

function SwitchTrack({ on }: { on: boolean }): React.ReactElement {
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
