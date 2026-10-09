import { getConfig } from '@budget-planner/config/schema'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogContext = Record<string, unknown>

const LEVEL_PRIORITY = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
} satisfies Record<LogLevel, number>

const REDACTED = '[REDACTED]'
const MAX_DEPTH = 6

/**
 * Matched against the normalized key, so `\b` words catch `cardNumber`/`clientIp` but not `recipient`.
 * Money is redacted by key name only: name money-carrying keys with a financial token.
 */
const REDACT_KEY_PATTERNS = [
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
	/ip[\s_-]?address/i,
	/\bip\b/i,
	/user[\s_-]?agent/i,
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
] satisfies RegExp[]

const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/g
const BEARER_RE = /\bBearer\s+[\w.\-+/=]+/gi
// userinfo credentials embedded in a connection string / URL: scheme://user:pass@host
const URL_CREDENTIALS_RE = /\/\/[^/\s:@]+:[^/\s:@]+@/g
// secret-bearing query/string params (e.g. magic-link `?token=`, OAuth, API keys)
const SECRET_PARAM_RE =
	/\b((?:access_token|refresh_token|api[_-]?key|token|secret|passwd|password|jwt|key)=)[^\s&"']+/gi
// standalone JWT-shaped strings (header.payload.signature)
const JWT_RE = /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g

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

export function redact(value: unknown, depth = 0): unknown {
	if (depth > MAX_DEPTH) return '[TRUNCATED]'
	if (value === null || value === undefined) return value
	if (typeof value === 'string') return scrubString(value)
	if (typeof value === 'number' || typeof value === 'boolean') return value
	if (typeof value === 'bigint') return value.toString()
	if (value instanceof Error) {
		return { name: value.name, message: scrubString(value.message) }
	}
	if (value instanceof Date) return value.toISOString()
	if (ArrayBuffer.isView(value)) return '[BINARY]'
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
	return undefined
}

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
