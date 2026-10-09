import { ErrorBoundary } from './ErrorBoundary'
import { RetirementAccumulationPlannerInner } from './RetirementAccumulationPlanner/RetirementAccumulationPlannerInner'

export function RetirementAccumulationPlanner() {
	return (
		<ErrorBoundary>
			<RetirementAccumulationPlannerInner />
		</ErrorBoundary>
	)
}
