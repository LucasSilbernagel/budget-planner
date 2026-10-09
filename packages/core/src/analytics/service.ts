// Best-effort PII filter, not a comprehensive scrubber: it misses phone/SSN/address values under
// benign keys.

import type { ClientMetadata } from './metadata'

type AnalyticsPropertyValue = string | number | boolean

export type AnalyticsEventProperties = Record<string, AnalyticsPropertyValue>

type AnalyticsEvent = {
	name: string
	metadata: ClientMetadata
	properties: AnalyticsEventProperties
	timestamp: number
}

// Plain substring, not `\bname\b`: camelCase `*Name` keys have no word boundary at the hump.
const PII_KEY_PATTERN =
	/(email|e-?mail|name|phone|mobile|\btel\b|ssn|password|passwd|secret|token|address|\bdob\b|birth|credit|\bcard\b|cvv|iban|account)/i

const EMAIL_VALUE_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/

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

export type AnalyticsServiceOptions = {
	metadata?: ClientMetadata
	now?: () => number
}

export type AnalyticsService = {
	track(name: string, properties?: AnalyticsEventProperties): AnalyticsEvent
	getEvents(): readonly AnalyticsEvent[]
	setMetadata(metadata: ClientMetadata): void
	clear(): void
}

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
