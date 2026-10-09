// Only allow-listed params are captured, so PII-bearing params (`?email=`) never reach analytics.

export type ClientMetadata = {
	source?: string
	medium?: string
	campaign?: string
	term?: string
	content?: string
	referrer?: string
}

const MAX_VALUE_LENGTH = 256

// Order matters: the FIRST entry wins for a shared field, so canonical UTM names precede shorthands.
const PARAM_TO_FIELD = [
	['utm_source', 'source'],
	['utm_medium', 'medium'],
	['utm_campaign', 'campaign'],
	['utm_term', 'term'],
	['utm_content', 'content'],
	['referrer', 'referrer'],
	['ref', 'source'],
	['source', 'source'],
] satisfies ReadonlyArray<readonly [string, keyof ClientMetadata]>

export const TRACKED_PARAMS: readonly string[] = PARAM_TO_FIELD.map(([param]) => param)

export function sanitizeMetadataValue(raw: string): string | undefined {
	// Strip control, zero-width and bidi characters too, so values can't smuggle in text-spoofing.
	const stripped = raw
		// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control chars is the purpose here
		.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, '')
		.trim()
	if (stripped.length === 0) {
		return undefined
	}
	// Cap by code points so the slice never splits a surrogate pair.
	return [...stripped].slice(0, MAX_VALUE_LENGTH).join('')
}

function toSearchParams(search: string | URLSearchParams): URLSearchParams {
	if (search instanceof URLSearchParams) {
		return search
	}
	// If a `?` is present the query is everything after the FIRST one; otherwise
	// treat the whole string as a bare query. Drop any trailing `#fragment`.
	const questionIndex = search.indexOf('?')
	const afterQuestion = questionIndex === -1 ? search : search.slice(questionIndex + 1)
	const withoutFragment = afterQuestion.split('#')[0] ?? ''
	return new URLSearchParams(withoutFragment)
}

export function parseMetadataFromUrl(search: string | URLSearchParams): ClientMetadata {
	const params = toSearchParams(search)
	const metadata: ClientMetadata = {}

	for (const [param, field] of PARAM_TO_FIELD) {
		if (metadata[field] !== undefined) {
			continue
		}
		const raw = params.get(param)
		if (raw === null) {
			continue
		}
		const value = sanitizeMetadataValue(raw)
		if (value !== undefined) {
			metadata[field] = value
		}
	}

	return metadata
}

export function isMetadataEmpty(metadata: ClientMetadata): boolean {
	return Object.keys(metadata).length === 0
}
