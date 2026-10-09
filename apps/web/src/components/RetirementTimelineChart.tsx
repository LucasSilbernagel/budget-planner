import { ErrorBoundary } from './ErrorBoundary'
import type { RetirementTimelineChartProps } from './RetirementTimelineChart/chart-helpers'
import { RetirementTimelineChartInner } from './RetirementTimelineChart/RetirementTimelineChartInner'

export function RetirementTimelineChart(props: RetirementTimelineChartProps) {
	return (
		<ErrorBoundary>
			<RetirementTimelineChartInner {...props} />
		</ErrorBoundary>
	)
}
