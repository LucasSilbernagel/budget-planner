import type React from 'react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { signedAmount } from '../../lib/forecasting/today-baseline'
import type { AriaSortValue } from '../../lib/table-sort'
import type { SavedForecast } from '../../routes/forecasting'
import { useFormattedAmount } from '../../stores/currencyStore'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { PencilIcon } from '../ui/RowActionIcons'
import { useSortHeaderAnnouncements } from '../ui/SortableColumnHeader'

export interface ForecastListProps {
	forecasts: SavedForecast[]
	onDelete: (id: string) => void
	onLoad?: (forecast: SavedForecast) => void
	// Ending net worth minus today's data projected flat over the same years; a missing id shows no line.
	vsToday?: ReadonlyMap<string, number>
}

type SortField = 'name' | 'date' | 'netWorth'

const SORT_FIELD_LABELS: Readonly<Record<SortField, string>> = {
	name: 'Name',
	date: 'Created',
	netWorth: 'Ending Net Worth',
}

function formatDate(dateString: string): string {
	const date = new Date(dateString)
	return date.toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	})
}

function truncate(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text
	return `${text.slice(0, maxLength)}...`
}

// On the selected bg-blue-50 row text-muted is 4.44:1, below AA, so it switches to text-body.
function mutedOnRow(selected: boolean): 'text-body' | 'text-muted' {
	return selected ? 'text-body' : 'text-muted'
}

export function ForecastList({
	forecasts,
	onDelete,
	onLoad,
	vsToday,
}: ForecastListProps): React.ReactElement {
	const formatCurrency = useFormattedAmount()
	const [searchQuery, setSearchQuery] = useState('')
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
	const [sortBy, setSortBy] = useState<'name' | 'date' | 'netWorth'>('date')
	const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
	const [pendingDelete, setPendingDelete] = useState<
		{ type: 'single'; id: string } | { type: 'bulk' } | null
	>(null)
	const headingRef = useRef<HTMLHeadingElement>(null)

	const filteredForecasts = useMemo(() => {
		let result = [...forecasts]

		if (searchQuery) {
			const query = searchQuery.toLowerCase()
			result = result.filter(
				(f) =>
					f.name.toLowerCase().includes(query) ||
					f.description?.toLowerCase().includes(query) ||
					f.scenario.name?.toLowerCase().includes(query)
			)
		}

		// Every comparison is ascending, so desc really is descending and aria-sort tells the truth.
		result.sort((a, b) => {
			let comparison = 0

			switch (sortBy) {
				case 'name':
					comparison = a.name.localeCompare(b.name)
					break
				case 'date':
					comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
					break
				case 'netWorth': {
					const aWorth = a.result.summary.endingNetWorth
					const bWorth = b.result.summary.endingNetWorth
					comparison = aWorth - bWorth
					break
				}
			}

			return sortDirection === 'asc' ? comparison : -comparison
		})

		return result
	}, [forecasts, searchQuery, sortBy, sortDirection])

	// Only visible selections count; ids hidden by the search stay selected and are never deleted from here.
	const visibleSelectedIds = useMemo(
		() => filteredForecasts.filter((f) => selectedIds.has(f.id)).map((f) => f.id),
		[filteredForecasts, selectedIds]
	)
	const selectedCount = visibleSelectedIds.length
	const totalCount = filteredForecasts.length

	const toggleSelection = useCallback((id: string) => {
		setSelectedIds((prev) => {
			const newSet = new Set(prev)
			if (newSet.has(id)) {
				newSet.delete(id)
			} else {
				newSet.add(id)
			}
			return newSet
		})
	}, [])

	const toggleAllSelection = useCallback(() => {
		const allVisibleSelected = selectedCount === totalCount && totalCount > 0
		setSelectedIds((prev) => {
			const newSet = new Set(prev)
			for (const f of filteredForecasts) {
				if (allVisibleSelected) newSet.delete(f.id)
				else newSet.add(f.id)
			}
			return newSet
		})
	}, [selectedCount, totalCount, filteredForecasts])

	const handleDelete = useCallback((id: string, e: React.MouseEvent) => {
		e.stopPropagation()
		setPendingDelete({ type: 'single', id })
	}, [])

	const handleBulkDelete = useCallback(() => {
		if (selectedCount === 0) return
		setPendingDelete({ type: 'bulk' })
	}, [selectedCount])

	const handleConfirmDelete = useCallback(() => {
		if (pendingDelete === null) return
		if (pendingDelete.type === 'single') {
			const { id } = pendingDelete
			onDelete(id)
			setSelectedIds((prev) => {
				const newSet = new Set(prev)
				newSet.delete(id)
				return newSet
			})
		} else {
			for (const id of visibleSelectedIds) {
				onDelete(id)
			}
			setSelectedIds((prev) => {
				const newSet = new Set(prev)
				for (const id of visibleSelectedIds) newSet.delete(id)
				return newSet
			})
		}
		setPendingDelete(null)
	}, [pendingDelete, visibleSelectedIds, onDelete])

	const handleLoad = useCallback(
		(forecast: SavedForecast) => {
			onLoad?.(forecast)
		},
		[onLoad]
	)

	const toggleSortDirection = useCallback(
		(field: 'name' | 'date' | 'netWorth') => {
			if (sortBy === field) {
				setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
			} else {
				setSortBy(field)
				setSortDirection('desc')
			}
		},
		[sortBy]
	)

	const sortA11y = useSortHeaderAnnouncements({
		label: SORT_FIELD_LABELS[sortBy],
		direction: sortDirection,
	})
	const ariaSortOf = (field: SortField): AriaSortValue => {
		if (sortBy !== field) {
			return 'none'
		}
		return sortDirection === 'asc' ? 'ascending' : 'descending'
	}
	const activateSort = (field: SortField) => {
		sortA11y.markActivated()
		toggleSortDirection(field)
	}

	const getSortIndicator = (field: 'name' | 'date' | 'netWorth'): React.ReactElement => {
		if (sortBy !== field) {
			return <span className="text-gray-400">↕</span>
		}
		return sortDirection === 'asc' ? (
			<span className="text-blue-600">↑</span>
		) : (
			<span className="text-blue-600">↓</span>
		)
	}

	return (
		<div className="space-y-6">
			<div className="mb-4">
				<h2
					ref={headingRef}
					tabIndex={-1}
					className="text-2xl font-bold text-subheading rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
				>
					My Saved Forecasts
				</h2>
				<p className="text-muted mt-1">Manage your saved forecasting scenarios</p>
			</div>

			{forecasts.length === 0 && <EmptyState />}

			{forecasts.length > 0 && (
				<div className="surface-inset rounded-xl p-4 flex flex-col md:flex-row gap-4 items-center justify-between">
					<div className="flex-1 min-w-[200px]">
						<label htmlFor="search" className="sr-only">
							Search forecasts
						</label>
						<div className="relative">
							<SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
							<input
								id="search"
								type="search"
								placeholder="Search forecasts..."
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
							/>
						</div>
					</div>

					<div className="flex items-center gap-4">
						{selectedCount > 0 && (
							<span className="text-sm text-body">{selectedCount} selected</span>
						)}

						<button
							type="button"
							onClick={handleBulkDelete}
							disabled={selectedCount === 0}
							className="px-4 py-2 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 text-sm font-medium rounded-lg hover:bg-red-200 hover:text-red-800 dark:hover:bg-red-900/60 dark:hover:text-red-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
						>
							Delete Selected
						</button>
					</div>
				</div>
			)}

			{filteredForecasts.length > 0 && (
				<div className="surface rounded-xl shadow-lg border border-default overflow-x-auto">
					<table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
						<thead className="surface-inset">
							<tr>
								<th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
									<input
										type="checkbox"
										checked={selectedCount === totalCount && totalCount > 0}
										onChange={toggleAllSelection}
										className="h-4 w-4 text-blue-600 border-gray-300 dark:border-gray-600 rounded focus:ring-blue-500"
										aria-label="Select all"
									/>
								</th>
								<th
									aria-sort={ariaSortOf('name')}
									className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider"
								>
									<button
										type="button"
										className="flex items-center uppercase cursor-pointer hover:text-gray-700 dark:hover:text-gray-200"
										onClick={() => activateSort('name')}
										aria-describedby={sortA11y.describedBy(ariaSortOf('name'))}
									>
										{SORT_FIELD_LABELS.name}
										<span className="ml-1" aria-hidden="true">
											{getSortIndicator('name')}
										</span>
									</button>
								</th>
								<th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
									Description
								</th>
								<th
									aria-sort={ariaSortOf('date')}
									className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider"
								>
									<button
										type="button"
										className="flex items-center uppercase cursor-pointer hover:text-gray-700 dark:hover:text-gray-200"
										onClick={() => activateSort('date')}
										aria-describedby={sortA11y.describedBy(ariaSortOf('date'))}
									>
										{SORT_FIELD_LABELS.date}
										<span className="ml-1" aria-hidden="true">
											{getSortIndicator('date')}
										</span>
									</button>
								</th>
								<th
									aria-sort={ariaSortOf('netWorth')}
									className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider"
								>
									<button
										type="button"
										className="flex items-center uppercase cursor-pointer hover:text-gray-700 dark:hover:text-gray-200"
										onClick={() => activateSort('netWorth')}
										aria-describedby={sortA11y.describedBy(ariaSortOf('netWorth'))}
									>
										{SORT_FIELD_LABELS.netWorth}
										<span className="ml-1" aria-hidden="true">
											{getSortIndicator('netWorth')}
										</span>
									</button>
								</th>
								<th className="px-6 py-3 text-right text-xs font-medium text-muted uppercase tracking-wider">
									Actions
								</th>
							</tr>
						</thead>

						<tbody className="surface divide-y divide-gray-200 dark:divide-gray-700">
							{filteredForecasts.map((forecast) => (
								<tr
									key={forecast.id}
									onClick={() => toggleSelection(forecast.id)}
									className={`cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors ${
										selectedIds.has(forecast.id) ? 'bg-blue-50 dark:bg-blue-950/40' : ''
									}`}
								>
									<td className="px-4 py-4 whitespace-nowrap">
										<input
											type="checkbox"
											checked={selectedIds.has(forecast.id)}
											onChange={() => toggleSelection(forecast.id)}
											// Keeps the click off the row's own toggle, or one click toggles twice.
											onClick={(e) => e.stopPropagation()}
											className="h-4 w-4 text-blue-600 border-gray-300 dark:border-gray-600 rounded focus:ring-blue-500"
											aria-label={`Select ${forecast.name}`}
										/>
									</td>

									<td className="px-6 py-4 whitespace-nowrap">
										<div className="text-sm font-medium text-subheading">
											{truncate(forecast.name, 40)}
										</div>
										<div className={`text-xs mt-1 ${mutedOnRow(selectedIds.has(forecast.id))}`}>
											v{forecast.version ?? 1}
										</div>
									</td>

									<td className="px-6 py-4">
										<div className="text-sm text-body">
											{truncate(forecast.description || 'No description', 60)}
										</div>
									</td>

									<td className="px-6 py-4 whitespace-nowrap">
										<div className="text-sm text-body">{formatDate(forecast.createdAt)}</div>
									</td>

									<td className="px-6 py-4 whitespace-nowrap">
										<div className="text-sm font-semibold text-subheading">
											{formatCurrency(forecast.result.summary.endingNetWorth)}
										</div>
										{/* The + is conditional: formatCurrency emits its own -, which would render +-40,000.00. */}
										<div className={`text-xs mt-1 ${mutedOnRow(selectedIds.has(forecast.id))}`}>
											{forecast.result.summary.totalGrowth >= 0 ? '+' : ''}
											{formatCurrency(forecast.result.summary.totalGrowth)}
										</div>
										{vsToday?.has(forecast.id) && (
											<div className={`text-xs mt-1 ${mutedOnRow(selectedIds.has(forecast.id))}`}>
												{signedAmount(vsToday.get(forecast.id) ?? 0, formatCurrency)} vs. today
											</div>
										)}
									</td>

									<td className="px-6 py-4 whitespace-nowrap text-right">
										<div className="flex items-center justify-end gap-2">
											{onLoad && (
												<button
													type="button"
													onClick={(e) => {
														e.stopPropagation()
														handleLoad(forecast)
													}}
													className="p-2 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-lg transition-colors"
													aria-label={`Edit ${forecast.name}`}
													title="Edit"
												>
													<PencilIcon className="w-4 h-4" />
												</button>
											)}
											<button
												type="button"
												onClick={(e) => handleDelete(forecast.id, e)}
												className="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors"
												aria-label={`Delete ${forecast.name}`}
												title="Delete"
											>
												<DeleteIcon className="w-4 h-4" />
											</button>
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
					{sortA11y.nodes}
				</div>
			)}

			{forecasts.length > 0 && (
				<p className="text-sm text-muted">
					Showing {filteredForecasts.length} of {forecasts.length} forecasts
					{searchQuery && ` (filtered by "${searchQuery}")`}
				</p>
			)}

			<ConfirmDialog
				isOpen={pendingDelete !== null}
				onConfirm={handleConfirmDelete}
				onCancel={() => setPendingDelete(null)}
				finalFocusRef={headingRef}
				message={
					pendingDelete?.type === 'bulk'
						? `Are you sure you want to delete ${selectedCount} selected forecast(s)? This cannot be undone.`
						: 'Are you sure you want to delete this forecast? This cannot be undone.'
				}
			/>
		</div>
	)
}

function EmptyState(): React.ReactElement {
	return (
		<div className="surface rounded-xl shadow-lg border border-default p-12 text-center">
			<div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-4">
				<FolderIcon className="w-8 h-8 text-gray-400" />
			</div>
			<h3 className="text-lg font-semibold text-subheading mb-2">No Saved Forecasts</h3>
			<p className="text-muted text-sm mb-4">
				Create and save your first forecasting scenario to get started.
			</p>
			<p className="text-faint text-xs">
				Saved forecasts are stored securely in DanubeData (Germany - EU)
			</p>
		</div>
	)
}

function SearchIcon({ className }: { className: string }): React.ReactElement {
	return (
		<svg
			aria-hidden="true"
			className={className}
			fill="none"
			stroke="currentColor"
			viewBox="0 0 24 24"
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={2}
				d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
			/>
		</svg>
	)
}

function FolderIcon({ className }: { className: string }): React.ReactElement {
	return (
		<svg
			aria-hidden="true"
			className={className}
			fill="none"
			stroke="currentColor"
			viewBox="0 0 24 24"
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={2}
				d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
			/>
		</svg>
	)
}

function DeleteIcon({ className }: { className: string }): React.ReactElement {
	return (
		<svg
			aria-hidden="true"
			className={className}
			fill="none"
			stroke="currentColor"
			viewBox="0 0 24 24"
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={2}
				d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
			/>
		</svg>
	)
}
