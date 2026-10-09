import type React from 'react'
import { cn } from '@/lib/cn'

// chevronHidden makes the glyph `invisible`, not hidden, to reserve its width so the badges stay aligned.
// Never pass it to a box the user can activate: the chevron is the touch affordance.
export function LockedTileContent({
	label,
	chevronHidden = false,
}: {
	label: React.ReactNode
	chevronHidden?: boolean
}): React.ReactElement {
	return (
		<>
			<span className="mr-auto">{label}</span>
			<span
				aria-hidden="true"
				className={cn(
					'order-last pl-2 text-lg leading-none text-accent',
					chevronHidden && ' invisible'
				)}
			>
				›
			</span>
		</>
	)
}
