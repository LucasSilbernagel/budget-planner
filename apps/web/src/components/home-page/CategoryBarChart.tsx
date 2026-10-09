import type React from 'react'
import { Suspense } from 'react'
import { categoryChartHeight } from '../../lib/chart-axis'
import { lazyWithRetry } from '../../lib/lazy-with-retry'
import { ErrorBoundary } from '../ErrorBoundary'
import { ChartPending } from './ChartPending'

// Lazy so Recharts stays off the critical path: route chunks' static imports are awaited before hydration.
// Every call site must stay inside the `hydrated` branch so no chart renders on the server.
const CategoryBarCanvas = lazyWithRetry(() =>
	import('../HomeChartCanvases').then((m) => ({ default: m.CategoryBarCanvas }))
)

type CategoryBarDatum = { category: string; amount: number; fill: string }

type CategoryBarChartProps = {
	testId: string
	data: CategoryBarDatum[]
	ticks: number[]
	// Only when every bar is also on the page as text: the balances totals appear nowhere else.
	hiddenFromScreenReaders?: boolean
}

export function CategoryBarChart({
	testId,
	data,
	ticks,
	hiddenFromScreenReaders = false,
}: CategoryBarChartProps): React.ReactElement {
	return (
		// On the sized wrapper, not the lazy canvas, so the pending skeleton and error fallback are hidden too.
		<div
			style={{ height: categoryChartHeight(data.length) }}
			data-testid={testId}
			aria-hidden={hiddenFromScreenReaders || undefined}
		>
			<ErrorBoundary
				fallback={<div className="p-4 text-red-600 dark:text-red-400">Chart error occurred</div>}
			>
				<Suspense fallback={<ChartPending />}>
					<CategoryBarCanvas data={data} ticks={ticks} />
				</Suspense>
			</ErrorBoundary>
		</div>
	)
}
