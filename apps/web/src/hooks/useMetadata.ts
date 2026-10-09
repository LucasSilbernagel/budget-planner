import type { ClientMetadata } from '@budget-planner/core/analytics/metadata'
import { useMetadataContext } from './useMetadataContext'

export function useMetadata(): ClientMetadata {
	return useMetadataContext().metadata
}
