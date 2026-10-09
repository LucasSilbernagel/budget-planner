/**
 * Reads window.location.search after mount, not via the router: SSR markup matches, and the entry
 * params survive client-side navigation.
 */

import { type ClientMetadata, parseMetadataFromUrl } from '@budget-planner/core/analytics/metadata'
import {
	type AnalyticsService,
	createAnalyticsService,
} from '@budget-planner/core/analytics/service'
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react'

type MetadataContextValue = {
	metadata: ClientMetadata
	analytics: AnalyticsService
}

const MetadataContext = createContext<MetadataContextValue | null>(null)

export function MetadataProvider({ children }: { children: ReactNode }) {
	const [metadata, setMetadata] = useState<ClientMetadata>({})

	const analyticsRef = useRef<AnalyticsService | null>(null)
	if (analyticsRef.current === null) {
		analyticsRef.current = createAnalyticsService()
	}
	const analytics = analyticsRef.current

	// Runs the capture at most once despite StrictMode's double-invoked effects or a remount.
	const hasCapturedRef = useRef(false)

	useEffect(() => {
		if (typeof window === 'undefined' || hasCapturedRef.current) {
			return
		}
		hasCapturedRef.current = true
		const captured = parseMetadataFromUrl(window.location.search)
		setMetadata(captured)
		analytics.setMetadata(captured)
		analytics.track('page_view')
	}, [analytics])

	return (
		<MetadataContext.Provider value={{ metadata, analytics }}>{children}</MetadataContext.Provider>
	)
}

function useMetadataContext(): MetadataContextValue {
	const ctx = useContext(MetadataContext)
	if (ctx === null) {
		throw new Error('useMetadata/useAnalytics must be used within a <MetadataProvider>')
	}
	return ctx
}

export function useMetadata(): ClientMetadata {
	return useMetadataContext().metadata
}

export function useAnalytics(): AnalyticsService {
	return useMetadataContext().analytics
}
