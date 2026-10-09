/**
 * Reads window.location.search after mount, not via the router: SSR markup matches, and the entry
 * params survive client-side navigation.
 */

import { type ClientMetadata, parseMetadataFromUrl } from '@budget-planner/core/analytics/metadata'
import {
	type AnalyticsService,
	createAnalyticsService,
} from '@budget-planner/core/analytics/service'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { MetadataContext } from './metadata-context'

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
