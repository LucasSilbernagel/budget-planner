import type React from 'react'
import { cn } from '@/lib/cn'
import { ChartIcon } from '../../icons/ChartIcon'
import { SaveIcon } from '../../icons/SaveIcon'
import { ScenarioIcon } from '../../icons/ScenarioIcon'
import type { ForecastingTab } from './tab-ids'

const TAB_ICON_PHONE_CLASS = 'max-sm:hidden'

export function TabIcon({
	tab,
	isActive,
}: {
	tab: ForecastingTab
	isActive: boolean
}): React.ReactElement {
	const className = cn(
		'w-4 h-4',
		TAB_ICON_PHONE_CLASS,
		isActive ? 'text-blue-600' : 'text-gray-400'
	)

	switch (tab) {
		case 'scenarios':
			return <ScenarioIcon className={className} />
		case 'projections':
			return <ChartIcon className={className} />
		case 'saved':
			return <SaveIcon className={className} />
		default:
			return <div className={className} />
	}
}
