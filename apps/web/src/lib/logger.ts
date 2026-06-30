/**
 * Structured, PII-safe logger (story 5-5, AC-2)
 *
 * A thin, dependency-free structured logger that replaces ad-hoc `console.*` on
 * the server paths (auth, sync, webhooks, server functions). Two hard rules:
 *
 *  1. Output is structured (level / time / msg / context) so it is queryable in
 *     the platform log stream, and routed to the matching `console` method so
 *     the runtime maps log levels correctly.
 *  2. It NEVER emits PII, financial values, secrets, or session material. The
 *     `redact()` pass strips them by key name AND scrubs emails / bearer tokens
 *     embedded in free-text strings. This mirrors the no-tracking, EU-sovereign
 *     privacy posture (NFR1/NFR2) — scrubbing is a tested deliverable, not a
 *     default. `redact()` is exported so the error tracker reuses the same pass.
 *
 * No JWT/heavy logging dep, by the same lean ethos as session.ts.
 */

import { getConfig } from '@budget-planner/config'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogContext = Record<string, unknown>

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

const REDACTED = '[REDACTED]'
const MAX_DEPTH = 6

/**
 * Keys whose VALUES must never be logged. Covers secrets/PII (email, tokens,
 * cookies, auth, secrets, DSNs, DATABASE_URL, session material) and financial
 * values (the app's crown jewels). Non-PII identifiers like `userId` are NOT
 * matched and survive — exactly the AC-2 contract (userId UUID OK, email not).
 *
 * Matching runs against the NORMALIZED key (camelCase/snake/kebab split into
 * space-separated words — see `normalizeKey`), so `\b`-anchored single words
 * (`card`, `ip`, `price`, `ssn`, `dsn`) catch compound forms like `cardNumber`
 * / `clientIp` / `unitPrice` while still NOT over-matching `recipient`/`script`.
 *
 * NOTE (documented limitation — see deferred-work.md): financial *values* are
 * protected by key NAME only. A numeric money value logged under a generic key
 * (`{ value: 4200 }`) is NOT redacted. Contract: name money-carrying keys with a
 * financial token (amount/balance/total/price/…).
 */
const REDACT_KEY_PATTERNS: RegExp[] = [
  /pass(word|phrase)?/i,
  /secret/i,
  /token/i,
  /cookie/i,
  /authorization/i,
  /api[\s_-]?key/i,
  /\bdsn\b/i,
  /database[\s_-]?url/i,
  /session/i,
  /email/i,
  /\bssn\b/i,
  /\bcard\b/i,
  // network identifiers that are personal data under GDPR
  /ip[\s_-]?address/i,
  /\bip\b/i,
  /user[\s_-]?agent/i,
  // financial values
  /amount/i,
  /balance/i,
  /income/i,
  /expense/i,
  /salary/i,
  /savings/i,
  /net[\s_-]?worth/i,
  /withdrawal/i,
  /contribution/i,
  /\bprice\b/i,
  /deposit/i,
]

const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/g
// Bearer token — broadened to standard base64 chars (+ / =), not just base64url.
const BEARER_RE = /\bBearer\s+[\w.\-+/=]+/gi
// userinfo credentials embedded in a connection string / URL: scheme://user:pass@host
const URL_CREDENTIALS_RE = /\/\/[^/\s:@]+:[^/\s:@]+@/g
// secret-bearing query/string params (e.g. magic-link `?token=`, OAuth, API keys)
const SECRET_PARAM_RE =
  /\b((?:access_token|refresh_token|api[_-]?key|token|secret|passwd|password|jwt|key)=)[^\s&"']+/gi
// standalone JWT-shaped strings (header.payload.signature)
const JWT_RE = /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g

/** Split camelCase / snake / kebab keys into lowercased space-separated words. */
function normalizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key)
  return REDACT_KEY_PATTERNS.some((re) => re.test(normalized))
}

function scrubString(value: string): string {
  return value
    .replace(URL_CREDENTIALS_RE, '//[REDACTED]@')
    .replace(SECRET_PARAM_RE, '$1[REDACTED]')
    .replace(JWT_RE, REDACTED)
    .replace(EMAIL_RE, REDACTED)
    .replace(BEARER_RE, `Bearer ${REDACTED}`)
}

/**
 * Deep-scrub an arbitrary value for safe logging/telemetry. Redacts the values
 * of sensitive keys, scrubs PII patterns out of strings, normalizes Errors to
 * `{ name, message }` (scrubbed), and caps depth so malformed/deeply-nested
 * input can never throw or run away.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[TRUNCATED]'
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return scrubString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Error) {
    return { name: value.name, message: scrubString(value.message) }
  }
  // Non-plain objects that Object.entries would silently mangle:
  if (value instanceof Date) return value.toISOString()
  if (ArrayBuffer.isView(value)) return '[BINARY]' // Buffer / typed arrays / DataView
  if (value instanceof Map) return redact(Object.fromEntries(value), depth + 1)
  if (value instanceof Set) return redact([...value], depth + 1)
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key) ? REDACTED : redact(val, depth + 1)
    }
    return out
  }
  // functions, symbols, etc. are dropped from telemetry
  return undefined
}

/**
 * Minimum level to emit. Lean in production (info+), verbose in dev/test (debug+).
 * Config load is guarded so logging never crashes if env is unavailable.
 */
function minLevel(): number {
  let nodeEnv = 'development'
  try {
    nodeEnv = getConfig().NODE_ENV
  } catch {
    // config unavailable (e.g. very early boot) — default to verbose
  }
  return nodeEnv === 'production' ? LEVEL_PRIORITY.info : LEVEL_PRIORITY.debug
}

function emit(level: LogLevel, message: string, context?: LogContext): void {
  if (LEVEL_PRIORITY[level] < minLevel()) return

  const entry = {
    level,
    time: new Date().toISOString(),
    msg: scrubString(message),
    ...(context !== undefined ? { context: redact(context) } : {}),
  }

  const line = JSON.stringify(entry)
  if (level === 'error') {
    console.error(line)
  } else if (level === 'warn') {
    console.warn(line)
  } else {
    console.log(line)
  }
}

export const logger = {
  debug: (message: string, context?: LogContext): void => emit('debug', message, context),
  info: (message: string, context?: LogContext): void => emit('info', message, context),
  warn: (message: string, context?: LogContext): void => emit('warn', message, context),
  error: (message: string, context?: LogContext): void => emit('error', message, context),
}
