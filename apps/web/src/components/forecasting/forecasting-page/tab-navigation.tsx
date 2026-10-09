import type React from 'react'
import { useRef } from 'react'
import { cn } from '@/lib/cn'
import { TabIcon } from './tab-icon'
import { type ForecastingTab, tabId, tabPanelId } from './tab-ids'

type TabNavigationProps = {
	activeTab: ForecastingTab
	onTabChange: (tab: ForecastingTab) => void
	disabled?: boolean
}

const tabs = [
	{ id: 'scenarios', label: 'Scenario Builder' },
	{ id: 'projections', label: 'Projections' },
	{ id: 'saved', label: 'My Forecasts' },
] satisfies { id: ForecastingTab; label: string }[]

/**
 * Phone-only: drops icons and padding so three tabs fit 320px; `min-w-0` lets larger
 * fonts squeeze the buttons instead of scrolling the page sideways.
 */
const TAB_BUTTON_PHONE_CLASS = 'max-sm:flex-1 max-sm:min-w-0 max-sm:px-1.5'
const TAB_CONTENT_CLASS = 'flex items-center max-sm:justify-center max-sm:text-center'
/** Phone only: a word wider than its button breaks rather than overflowing the neighbour. */
const TAB_LABEL_CLASS = 'ml-2 max-sm:ml-0 max-sm:[overflow-wrap:anywhere]'

/**
 * WAI-ARIA tabs with automatic activation and roving tabIndex. The tablist must stay the
 * direct parent of the buttons; tests locate the strip that way.
 */
export function TabNavigation({
	activeTab,
	onTabChange,
	disabled = false,
}: TabNavigationProps): React.ReactElement {
	const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

	const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
		if (disabled) return
		// A held modifier belongs to the browser or AT (Alt+Arrow is Back/Forward): never swallow it.
		if (event.altKey || event.ctrlKey || event.metaKey) return
		const current = tabs.findIndex((tab) => tab.id === activeTab)
		let target: number
		switch (event.key) {
			case 'ArrowRight':
				target = (current + 1) % tabs.length
				break
			case 'ArrowLeft':
				target = (current - 1 + tabs.length) % tabs.length
				break
			case 'Home':
				target = 0
				break
			case 'End':
				target = tabs.length - 1
				break
			default:
				return
		}
		event.preventDefault()
		const next = tabs[target]
		if (!next) return
		onTabChange(next.id)
		tabRefs.current[target]?.focus()
	}

	return (
		<div className="flex flex-col sm:flex-row gap-4">
			<div
				role="tablist"
				aria-label="Forecasting views"
				onKeyDown={handleKeyDown}
				className="flex space-x-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-1"
			>
				{tabs.map((tab, index) => (
					<button
						key={tab.id}
						ref={(element) => {
							tabRefs.current[index] = element
						}}
						type="button"
						role="tab"
						id={tabId(tab.id)}
						aria-selected={activeTab === tab.id}
						aria-controls={tabPanelId(tab.id)}
						tabIndex={activeTab === tab.id ? 0 : -1}
						onClick={() => onTabChange(tab.id)}
						disabled={disabled}
						className={cn(
							'px-4',
							TAB_BUTTON_PHONE_CLASS,
							'py-2 text-sm font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed',
							activeTab === tab.id
								? 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 shadow-sm'
								: 'text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 hover:text-gray-700 dark:hover:text-gray-100'
						)}
					>
						<span className={TAB_CONTENT_CLASS}>
							<TabIcon tab={tab.id} isActive={activeTab === tab.id} />
							<span className={TAB_LABEL_CLASS}>{tab.label}</span>
						</span>
					</button>
				))}
			</div>
		</div>
	)
}
