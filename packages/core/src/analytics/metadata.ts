/**
 * Client Metadata Capture via clean URL strings (story 4-12, FR14 / UX-DR8).
 *
 * Privacy-respecting acquisition tracking: marketing attribution is read from
 * URL query parameters ONLY. No cookies, no localStorage, no fingerprinting.
 * This module is pure and isomorphic — it parses and sanitizes a query string
 * into a typed {@link ClientMetadata} object and has no environment side
 * effects (the web layer owns reading `window.location.search` and holding the
 * result in memory; see `apps/web/src/context/metadata-context.tsx`).
 *
 * Only an explicit allow-list of well-known marketing parameters is captured
 * ({@link TRACKED_PARAMS}); every other query parameter is ignored, so
 * arbitrary/PII-bearing params (e.g. `?email=`) can never leak into analytics.
 */

/** Marketing attribution captured from the URL. All fields are optional. */
export interface ClientMetadata {
  /** Acquisition source, e.g. `newsletter`, `twitter` (utm_source or ref). */
  source?: string
  /** Marketing medium, e.g. `email`, `cpc` (utm_medium). */
  medium?: string
  /** Campaign name, e.g. `launch` (utm_campaign). */
  campaign?: string
  /** Paid-search term (utm_term). */
  term?: string
  /** Content / A-B variant identifier (utm_content). */
  content?: string
  /** Explicit referrer passed as a URL param (referrer). */
  referrer?: string
}

/** Max characters retained for any single captured value. */
const MAX_VALUE_LENGTH = 256

/**
 * Allow-list mapping of URL parameter name → {@link ClientMetadata} field.
 *
 * Order matters: when two params map to the same field (e.g. `utm_source` and
 * the `ref` shorthand both feed `source`), the FIRST entry wins because parsing
 * does not overwrite an already-populated field. Keep canonical UTM names ahead
 * of their shorthands.
 */
const PARAM_TO_FIELD: ReadonlyArray<readonly [string, keyof ClientMetadata]> = [
  ['utm_source', 'source'],
  ['utm_medium', 'medium'],
  ['utm_campaign', 'campaign'],
  ['utm_term', 'term'],
  ['utm_content', 'content'],
  ['referrer', 'referrer'],
  // Shorthands (lower precedence than their canonical counterparts above).
  ['ref', 'source'],
  ['source', 'source'],
]

/** The set of URL parameter names this module will capture. */
export const TRACKED_PARAMS: readonly string[] = PARAM_TO_FIELD.map(([param]) => param)

/**
 * Normalizes a raw captured value: strips control characters, collapses to a
 * trimmed string, and caps length. Returns `undefined` when nothing meaningful
 * remains so callers can omit the field entirely.
 */
export function sanitizeMetadataValue(raw: string): string | undefined {
  // Strip control AND invisible/bidi characters before trimming so values can't
  // smuggle in invisible or text-spoofing characters: C0/C1 controls + DEL,
  // zero-width chars, word-joiner, BOM, and bidi marks/overrides.
  const stripped = raw
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control chars is the purpose here
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, '')
    .trim()
  if (stripped.length === 0) {
    return undefined
  }
  // Cap by code points (spread yields whole code points) so the slice can never
  // split a surrogate pair into a lone, ill-formed surrogate.
  return [...stripped].slice(0, MAX_VALUE_LENGTH).join('')
}

/**
 * Coerces the input into a {@link URLSearchParams}. Accepts an existing
 * `URLSearchParams`, a bare query string (`a=b`), a `?`-prefixed query, or a
 * full URL (`https://host/path?a=b#frag`) — since the function name invites
 * passing a URL, extract the query rather than mis-parsing the whole string.
 */
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

/**
 * Parses marketing metadata from a URL query string or `URLSearchParams`.
 *
 * Only {@link TRACKED_PARAMS} are read; unknown parameters are ignored. Values
 * are sanitized and empty results are dropped. Returns only the fields that
 * were actually present.
 */
export function parseMetadataFromUrl(search: string | URLSearchParams): ClientMetadata {
  const params = toSearchParams(search)
  const metadata: ClientMetadata = {}

  for (const [param, field] of PARAM_TO_FIELD) {
    // Respect precedence: never overwrite a field already filled by an
    // earlier (higher-precedence) parameter.
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

/** True when no metadata fields were captured. */
export function isMetadataEmpty(metadata: ClientMetadata): boolean {
  return Object.keys(metadata).length === 0
}
