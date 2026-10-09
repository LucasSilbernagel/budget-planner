import type React from 'react'
import { GroupedAmount } from '../../ui/GroupedAmount'

export function TotalRow({
	label,
	value,
	emphasis = false,
}: {
	label: string
	value: string
	emphasis?: boolean
}): React.ReactElement {
	return (
		// The label gives up width first so a wrapped value stays right-aligned.
		<div className="border-default flex items-baseline justify-between gap-4 border-t py-2">
			<dt
				className={
					emphasis
						? 'shrink-[1000] text-sm font-semibold text-heading'
						: 'shrink-[1000] text-sm text-label'
				}
			>
				{label}
			</dt>
			<dd
				className={
					emphasis
						? 'text-right text-base font-semibold tabular-nums text-heading'
						: 'text-right text-sm tabular-nums text-body'
				}
			>
				<GroupedAmount text={value} />
			</dd>
		</div>
	)
}
