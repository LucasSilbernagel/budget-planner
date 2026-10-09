import { z } from 'zod'

export const envSchema = z.object({
	NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

	PORT: z.coerce.number().default(3000),

	PADDLE_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),
	PADDLE_API_KEY: z.string().optional(),
	PADDLE_CLIENT_TOKEN: z.string().optional(),
	PADDLE_WEBHOOK_SECRET: z.string().optional(),
	// Not `z.coerce.number()`: that throws inside getConfig() on any bad value, 500ing every route.
	// Falls back to 300s on anything that isn't a positive integer.
	PADDLE_WEBHOOK_MAX_AGE_SECONDS: z
		.string()
		.optional()
		.transform((val) => {
			const parsed = val === undefined ? Number.NaN : Number(val)
			return Number.isInteger(parsed) && parsed > 0 ? parsed : 300
		}),
	// PADDLE_LIFETIME_PRICE_ID is how the webhook recognises a one-time lifetime purchase; monthly
	// and annual resolve price-agnostically through subscription events.
	PADDLE_MONTHLY_PRICE_ID: z.string().optional(),
	PADDLE_ANNUAL_PRICE_ID: z.string().optional(),
	PADDLE_LIFETIME_PRICE_ID: z.string().optional(),

	DATABASE_URL: z.string().optional(),

	// Optional so dev/test load without it; the mailer fails closed outside development.
	EMAIL_API_KEY: z.string().optional(),
	// Map blank to undefined first: `.default()` applies only to undefined. Not `.email()`-validated:
	// a typo would throw inside getConfig() and 500 every route.
	EMAIL_FROM: z.preprocess(
		(val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
		z.string().default('hello@longhandbudget.com')
	),

	// Optional here; getSessionSecret() enforces it, and its length, in production.
	SESSION_SECRET: z.string().optional(),

	SITE_URL: z.string().default('http://localhost:5173'),

	// Unset or too short: the endpoint refuses every call.
	RETENTION_SWEEP_TOKEN: z.string().optional(),
})

export type Env = z.infer<typeof envSchema>

function loadEnv(): Env {
	return envSchema.parse(process.env)
}

let config: Env | null = null

export function getConfig(): Env {
	if (!config) {
		config = loadEnv()
	}
	return config
}

export function resetConfig(): void {
	config = null
}

export type PaddleConfig = {
	environment: 'sandbox' | 'production'
	apiKey: string | undefined
	clientToken: string | undefined
	webhookSecret: string | undefined
	webhookMaxAgeSeconds: number
	apiBaseUrl: string
	// Required in production (the legal pricing page states this price) but absent in dev/sandbox,
	// so consumers must degrade gracefully.
	monthlyPriceId: string | undefined
	annualPriceId: string | undefined
	lifetimePriceId: string | undefined
	isConfigured: boolean
}

export const PADDLE_API_BASE_URL = {
	sandbox: 'https://sandbox-api.paddle.com',
	production: 'https://api.paddle.com',
} as const

export function getPaddleConfig(): PaddleConfig {
	const env = getConfig()
	const isConfigured =
		!!env.PADDLE_API_KEY && !!env.PADDLE_CLIENT_TOKEN && !!env.PADDLE_WEBHOOK_SECRET

	return {
		environment: env.PADDLE_ENVIRONMENT,
		apiKey: env.PADDLE_API_KEY,
		clientToken: env.PADDLE_CLIENT_TOKEN,
		webhookSecret: env.PADDLE_WEBHOOK_SECRET,
		webhookMaxAgeSeconds: env.PADDLE_WEBHOOK_MAX_AGE_SECONDS,
		apiBaseUrl: PADDLE_API_BASE_URL[env.PADDLE_ENVIRONMENT],
		monthlyPriceId: env.PADDLE_MONTHLY_PRICE_ID,
		annualPriceId: env.PADDLE_ANNUAL_PRICE_ID,
		lifetimePriceId: env.PADDLE_LIFETIME_PRICE_ID,
		isConfigured,
	}
}

// Strict whenever NODE_ENV isn't development OR PADDLE_ENVIRONMENT is production (an unset
// NODE_ENV defaults to development). Ids are trimmed: a blank id must not count as configured.
export function assertPaddleProductionConfig(): void {
	const env = getConfig()
	if (env.NODE_ENV === 'development' && env.PADDLE_ENVIRONMENT !== 'production') {
		return
	}

	const missing: string[] = []
	if (!env.PADDLE_API_KEY) missing.push('PADDLE_API_KEY')
	if (!env.PADDLE_CLIENT_TOKEN) missing.push('PADDLE_CLIENT_TOKEN')
	if (!env.PADDLE_WEBHOOK_SECRET) missing.push('PADDLE_WEBHOOK_SECRET')
	if (!env.PADDLE_MONTHLY_PRICE_ID?.trim()) missing.push('PADDLE_MONTHLY_PRICE_ID')
	if (!env.PADDLE_ANNUAL_PRICE_ID?.trim()) missing.push('PADDLE_ANNUAL_PRICE_ID')
	if (!env.PADDLE_LIFETIME_PRICE_ID?.trim()) missing.push('PADDLE_LIFETIME_PRICE_ID')
	if (missing.length > 0) {
		throw new Error(
			`Paddle Billing is not fully configured for production — missing: ${missing.join(
				', '
			)}. A production build must have the full Billing credential set or it silently earns no revenue.`
		)
	}

	// Only configured, trimmed ids take part: `undefined === undefined` is no collision, and a
	// trailing newline must not hide a real one.
	const configuredPriceIds: [name: string, id: string][] = []
	for (const [name, value] of [
		['PADDLE_MONTHLY_PRICE_ID', env.PADDLE_MONTHLY_PRICE_ID],
		['PADDLE_ANNUAL_PRICE_ID', env.PADDLE_ANNUAL_PRICE_ID],
		['PADDLE_LIFETIME_PRICE_ID', env.PADDLE_LIFETIME_PRICE_ID],
	] as [string, string | undefined][]) {
		const trimmed = value?.trim()
		if (trimmed) configuredPriceIds.push([name, trimmed])
	}

	for (let i = 0; i < configuredPriceIds.length; i++) {
		for (let j = i + 1; j < configuredPriceIds.length; j++) {
			const first = configuredPriceIds[i]
			const second = configuredPriceIds[j]
			if (first && second && first[1] === second[1]) {
				throw new Error(
					`${first[0]} and ${second[0]} must differ — sharing one price ID makes a subscription invoice match the other plan's price: against the lifetime price that grants a permanent entitlement on every renewal, and between the two recurring plans it charges one cadence at the other's price.`
				)
			}
		}
	}
}

export type EmailConfig = {
	apiKey: string | undefined
	from: string
	fromName: string
	isConfigured: boolean
}

export const EMAIL_FROM_NAME = 'Longhand Budget'

// Fails closed outside development, or users would be emailed localhost links.
export function getSiteUrl(): string {
	const env = getConfig()
	const url = env.SITE_URL?.trim()

	if (
		env.NODE_ENV === 'production' &&
		(!url || url.includes('localhost') || !url.startsWith('https://'))
	) {
		throw new Error(
			'SITE_URL must be set to the public https origin (not localhost) in production — magic-link emails build absolute links from it.'
		)
	}

	return url || 'http://localhost:5173'
}

export function getEmailConfig(): EmailConfig {
	const env = getConfig()
	return {
		apiKey: env.EMAIL_API_KEY,
		from: env.EMAIL_FROM,
		fromName: EMAIL_FROM_NAME,
		isConfigured: !!env.EMAIL_API_KEY,
	}
}

export const SESSION_SECRET_MIN_LENGTH = 32

// Never reached in production: getSessionSecret() throws there.
const DEV_FALLBACK_SESSION_SECRET = 'dev-only-insecure-session-secret-do-not-use-in-production'

// Rejects low-entropy keys like 32 identical chars; real hex secrets have ~16 distinct chars.
export const SESSION_SECRET_MIN_DISTINCT_CHARS = 8

function normalizeSecret(secret: string | undefined): string | undefined {
	const trimmed = secret?.trim()
	return trimmed ? trimmed : undefined
}

// Same floor as SESSION_SECRET; the route fails closed on undefined.
export function getRetentionSweepToken(): string | undefined {
	const token = normalizeSecret(getConfig().RETENTION_SWEEP_TOKEN)
	return token && isAcceptableSecret(token) ? token : undefined
}

function isAcceptableSecret(secret: string): boolean {
	return (
		secret.length >= SESSION_SECRET_MIN_LENGTH &&
		new Set(secret).size >= SESSION_SECRET_MIN_DISTINCT_CHARS
	)
}

// An unset NODE_ENV resolves to development and may use the insecure fallback, so
// deployments must set NODE_ENV explicitly.
export function getSessionSecret(): string {
	const env = getConfig()
	const secret = normalizeSecret(env.SESSION_SECRET)

	if (env.NODE_ENV !== 'development') {
		if (!secret || !isAcceptableSecret(secret)) {
			throw new Error(
				`SESSION_SECRET must be a strong value outside development: at least ${SESSION_SECRET_MIN_LENGTH} characters (after trimming) with at least ${SESSION_SECRET_MIN_DISTINCT_CHARS} distinct characters.`
			)
		}
		return secret
	}

	if (secret && isAcceptableSecret(secret)) {
		return secret
	}

	if (secret) {
		console.warn(
			`SESSION_SECRET is weak (under ${SESSION_SECRET_MIN_LENGTH} chars or low entropy); acceptable only in development.`
		)
		return secret
	}

	console.warn(
		'SESSION_SECRET is not set; using an insecure development fallback. Set SESSION_SECRET before deploying.'
	)
	return DEV_FALLBACK_SESSION_SECRET
}
