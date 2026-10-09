import type { AnalyticsService } from '@budget-planner/core/analytics/service'
import { useMetadataContext } from './useMetadataContext'

export function useAnalytics(): AnalyticsService {
	return useMetadataContext().analytics
}
