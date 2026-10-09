import type { ClientMetadata } from '@budget-planner/core/analytics/metadata'
import type { AnalyticsService } from '@budget-planner/core/analytics/service'
import { createContext } from 'react'

export type MetadataContextValue = {
	metadata: ClientMetadata
	analytics: AnalyticsService
}

export const MetadataContext = createContext<MetadataContextValue | null>(null)
