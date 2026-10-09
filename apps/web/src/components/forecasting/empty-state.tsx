import type React from 'react'
import { Card } from '@/components/ui/Card'
import { CardTitle } from '@/components/ui/CardTitle'
import { FolderIcon } from '../icons/FolderIcon'

export function EmptyState(): React.ReactElement {
	return (
		<Card className="rounded-xl shadow-lg border border-default p-12 text-center">
			<div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-4">
				<FolderIcon className="w-8 h-8 text-gray-400" />
			</div>
			<CardTitle as="h3" className="mb-2">
				No Saved Forecasts
			</CardTitle>
			<p className="text-muted text-sm mb-4">
				Create and save your first forecasting scenario to get started.
			</p>
			<p className="text-faint text-xs">
				Saved forecasts are stored securely in DanubeData (Germany - EU)
			</p>
		</Card>
	)
}
