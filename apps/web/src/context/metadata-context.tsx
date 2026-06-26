/**
 * Metadata context (story 4-12, FR14 / UX-DR8).
 *
 * Captures privacy-respecting acquisition metadata from the LANDING URL's query
 * string and makes it (plus an in-memory analytics service) available to the
 * component tree. Strictly URL-based: no cookies, no localStorage, no
 * persistence — the capture lives in React state for the session only.
 *
 * SSR note: state starts empty so the server render and the client's first
 * paint match; the URL is read in an effect after mount (client-only), avoiding
 * hydration mismatches. Reading `window.location.search` (rather than the
 * router) intentionally pins the entry-point params even after the user
 * navigates client-side.
 */

import {
  type AnalyticsService,
  type ClientMetadata,
  createAnalyticsService,
  parseMetadataFromUrl,
} from '@budget-planner/core'
import { type ReactNode, createContext, useContext, useEffect, useRef, useState } from 'react'

interface MetadataContextValue {
  /** Acquisition metadata captured from the landing URL (empty until mount). */
  metadata: ClientMetadata
  /** In-memory analytics recorder enriched with the captured metadata. */
  analytics: AnalyticsService
}

const MetadataContext = createContext<MetadataContextValue | null>(null)

export function MetadataProvider({ children }: { children: ReactNode }) {
  const [metadata, setMetadata] = useState<ClientMetadata>({})

  // One analytics instance for the app's lifetime; in-memory only.
  const analyticsRef = useRef<AnalyticsService | null>(null)
  if (analyticsRef.current === null) {
    analyticsRef.current = createAnalyticsService()
  }
  const analytics = analyticsRef.current

  // Guards the one-time capture so it runs at most once regardless of React
  // StrictMode's double-invoked effects (dev) or any provider remount — keeping
  // the `page_view` count honest to the "exactly once" promise below.
  const hasCapturedRef = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined' || hasCapturedRef.current) {
      return
    }
    hasCapturedRef.current = true
    // Capture acquisition metadata from the entry URL exactly once.
    const captured = parseMetadataFromUrl(window.location.search)
    setMetadata(captured)
    analytics.setMetadata(captured)
    // Record a single page_view so the metadata flows into analytics. The event
    // is held in memory only (no network, no persistence) and carries no PII.
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

/** Returns the acquisition metadata captured from the landing URL. */
export function useMetadata(): ClientMetadata {
  return useMetadataContext().metadata
}

/** Returns the in-memory analytics service for recording events. */
export function useAnalytics(): AnalyticsService {
  return useMetadataContext().analytics
}
