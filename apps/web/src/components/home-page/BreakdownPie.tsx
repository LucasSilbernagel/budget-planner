import type { RechartsDataItem } from '@budget-planner/core/finance/visualization'
import { CATEGORY_COLORS } from '@budget-planner/core/finance/visualization'
import type React from 'react'
import { Suspense } from 'react'
import { cn } from '@/lib/cn'
import { lazyWithRetry } from '../../lib/lazy-with-retry'
import { useFormattedAmount } from '../../stores/currencyStore'
import { ErrorBoundary } from '../ErrorBoundary'
import { Card } from '../ui/Card'
import { CardHeader } from '../ui/CardHeader'
import { CardTitle } from '../ui/CardTitle'
import { ChartPending } from './ChartPending'

// Lazy so Recharts stays off the critical path: route chunks' static imports are awaited before hydration.
// Every call site must stay inside the `hydrated` branch so no chart renders on the server.
const BreakdownPieCanvas = lazyWithRetry(() =>
	import('../HomeChartCanvases').then((m) => ({ default: m.BreakdownPieCanvas }))
)

type BreakdownPieProps = {
	// testid, not the title: the title carries the period suffix and changes with the selector.
	testId: string
	title: string
	data: RechartsDataItem[]
	// Not necessarily sum(data): Recharts sizes wedges by sum(data), so wedges and legend percentages diverge when they differ.
	total: number
	totalDisplay?: string
	note?: string
	emptyLabel: string
	accentClass: string
	legendValue?: (cents: number) => string
}

export function BreakdownPie({
	testId,
	title,
	data,
	total,
	totalDisplay,
	note,
	emptyLabel,
	accentClass,
	legendValue,
}: BreakdownPieProps): React.ReactElement {
	const formatAmount = useFormattedAmount()
	const sorted = [...data].sort((a, b) => b.value - a.value)
	const formatLegendValue = legendValue ?? formatAmount
	return (
		<div data-testid={`breakdown-pie-${testId}`}>
			<CardHeader className="mb-2 items-baseline gap-2">
				<CardTitle as="h3" className="text-sm">
					{title}
				</CardTitle>
				{data.length > 0 && (
					<span
						data-testid={`breakdown-pie-total-${testId}`}
						className={cn('text-sm font-semibold', accentClass)}
					>
						{totalDisplay ?? formatAmount(total)}
					</span>
				)}
			</CardHeader>
			{note && (
				<p
					data-testid={`breakdown-pie-note-${testId}`}
					className="mb-2 rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300"
				>
					{note}
				</p>
			)}
			{data.length === 0 ? (
				<Card
					variant="inset"
					className="flex h-[240px] items-center justify-center p-6 text-center"
				>
					<p className="text-sm text-muted">{emptyLabel}</p>
				</Card>
			) : (
				<>
					{/* Hidden from screen readers: the list below reads every slice. On the wrapper so the fallbacks are hidden too. */}
					<div className="h-[240px]" aria-hidden="true">
						<ErrorBoundary
							fallback={
								<div className="p-4 text-red-600 dark:text-red-400">Chart error occurred</div>
							}
						>
							<Suspense fallback={<ChartPending />}>
								<BreakdownPieCanvas data={data} total={total} />
							</Suspense>
						</ErrorBoundary>
					</div>
					<ul className="mt-3 space-y-1">
						{sorted.map((item, index) => (
							<li
								key={`${item.type}-${item.name}`}
								className="flex items-center justify-between gap-2 text-xs"
							>
								<span className="flex min-w-0 items-center gap-2">
									<span
										className="h-2 w-2 shrink-0 rounded-full"
										style={{
											backgroundColor: item.fill || CATEGORY_COLORS[index % CATEGORY_COLORS.length],
										}}
									/>
									<span className="truncate text-body">{item.name}</span>
								</span>
								<span className="shrink-0 text-muted">{formatLegendValue(item.value)}</span>
							</li>
						))}
					</ul>
				</>
			)}
		</div>
	)
}
