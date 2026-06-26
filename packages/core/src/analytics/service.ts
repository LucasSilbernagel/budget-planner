/**
 * In-memory analytics service (story 4-12, FR14 / UX-DR8).
 *
 * Records lightweight analytics events enriched with URL-derived
 * {@link ClientMetadata}. The service is deliberately a pure, in-memory sink:
 *
 *   - No network calls and no persistence (no cookies / localStorage), honoring
 *     the free-tier "client-side only, no tracking persistence" constraint.
 *   - A best-effort privacy filter ({@link filterPiiProperties}) drops
 *     PII-named property keys and email-like string values before recording.
 *     It is intentionally conservative, not a comprehensive PII scrubber — it
 *     does not detect phone/SSN/address values hidden under benign keys.
 *
 * A real dispatch transport (to an EU-hosted, data-sovereign analytics endpoint)
 * would be layered on top of this buffer later; that integration is out of scope
 * for this story. Keeping the buffer in `packages/core` makes the privacy rules
 * unit-testable in Node with no environment side effects.
 */

import type { ClientMetadata } from './metadata'

/** Allowed primitive value types for analytics event properties. */
export type AnalyticsPropertyValue = string | number | boolean

/** Free-form, non-PII properties attached to an analytics event. */
export type AnalyticsEventProperties = Record<string, AnalyticsPropertyValue>

/** A recorded analytics event. */
export interface AnalyticsEvent {
  /** Event name, e.g. `page_view`, `signup_click`. */
  name: string
  /** Snapshot of the acquisition metadata in effect when the event fired. */
  metadata: ClientMetadata
  /** Privacy-filtered event properties. */
  properties: AnalyticsEventProperties
  /** Epoch milliseconds when the event was recorded. */
  timestamp: number
}

/**
 * Property keys whose names suggest personally identifiable information. Matched
 * case-insensitively as a substring, so `userEmail`, `phoneNumber`, `fullName`,
 * `displayName`, `customerName`, `surname` are all caught. `name` is matched as
 * a plain substring (not `\bname\b`) precisely so camelCase `*Name` keys — which
 * have no regex word boundary at the hump — do not slip through.
 */
const PII_KEY_PATTERN =
  /(email|e-?mail|name|phone|mobile|\btel\b|ssn|password|passwd|secret|token|address|\bdob\b|birth|credit|\bcard\b|cvv|iban|account)/i

/** Value pattern for an email address (dropped wherever it appears). */
const EMAIL_VALUE_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/

/**
 * Removes properties that are likely to carry PII: keys whose names match
 * {@link PII_KEY_PATTERN}, and string values that look like email addresses.
 * Numeric and boolean values are always retained.
 */
export function filterPiiProperties(
  properties: AnalyticsEventProperties
): AnalyticsEventProperties {
  const safe: AnalyticsEventProperties = {}
  for (const [key, value] of Object.entries(properties)) {
    if (PII_KEY_PATTERN.test(key)) {
      continue
    }
    if (typeof value === 'string' && EMAIL_VALUE_PATTERN.test(value)) {
      continue
    }
    safe[key] = value
  }
  return safe
}

/** Options for {@link createAnalyticsService}. */
export interface AnalyticsServiceOptions {
  /** Acquisition metadata attached to events (see {@link parseMetadataFromUrl}). */
  metadata?: ClientMetadata
  /** Clock injection point (defaults to `Date.now`), useful for tests. */
  now?: () => number
}

/** An in-memory analytics recorder. */
export interface AnalyticsService {
  /** Record an event; returns the stored, privacy-filtered event. */
  track(name: string, properties?: AnalyticsEventProperties): AnalyticsEvent
  /** All recorded events (defensive copy). */
  getEvents(): readonly AnalyticsEvent[]
  /** Replace the ambient acquisition metadata for subsequent events. */
  setMetadata(metadata: ClientMetadata): void
  /** Drop all recorded events. */
  clear(): void
}

/**
 * Creates an in-memory {@link AnalyticsService}. Events are buffered in memory
 * only; nothing is sent over the network or persisted.
 */
export function createAnalyticsService(options: AnalyticsServiceOptions = {}): AnalyticsService {
  const now = options.now ?? Date.now
  let metadata: ClientMetadata = { ...(options.metadata ?? {}) }
  const events: AnalyticsEvent[] = []

  return {
    track(name, properties = {}) {
      const event: AnalyticsEvent = {
        name,
        // Snapshot metadata so later mutations don't rewrite history.
        metadata: { ...metadata },
        properties: filterPiiProperties(properties),
        timestamp: now(),
      }
      events.push(event)
      return event
    },
    getEvents() {
      return [...events]
    },
    setMetadata(next) {
      metadata = { ...next }
    },
    clear() {
      events.length = 0
    },
  }
}
