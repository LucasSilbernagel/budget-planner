/**
 * Configuration Schema
 *
 * Centralized configuration with Zod validation for environment variables.
 *
 * Architecture: Zod schema validation with runtime loading
 */

import { z } from 'zod'

// Environment schema
export const envSchema = z.object({
  // Node environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Application
  PORT: z.coerce.number().default(3000),

  // Paddle Configuration (UK-based - CLOUD Act compliant)
  PADDLE_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),
  PADDLE_VENDOR_ID: z.string().optional(),
  PADDLE_API_KEY: z.string().optional(),
  PADDLE_PUBLIC_KEY: z.string().optional(),
  PADDLE_WEBHOOK_SECRET: z.string().optional(),

  // Database (Scaleway PostgreSQL)
  DATABASE_URL: z.string().optional(),

  // Session signing secret (HMAC-SHA256 key for signed session cookies).
  // Optional at the schema level so dev/test can run without it (a guarded,
  // insecure fallback is used); production enforcement lives in
  // getSessionSecret(), which fails closed. Length is validated there rather
  // than here so a short value warns in dev instead of crashing config load.
  SESSION_SECRET: z.string().optional(),

  // Deployment
  SITE_URL: z.string().default('http://localhost:5173'),
})

// Runtime configuration type
export type Env = z.infer<typeof envSchema>

// Validate and load environment
function loadEnv(): Env {
  return envSchema.parse(process.env)
}

// Singleton configuration instance
let config: Env | null = null

/**
 * Get the validated configuration
 */
export function getConfig(): Env {
  if (!config) {
    config = loadEnv()
  }
  return config
}

/**
 * Reset configuration (useful for testing)
 */
export function resetConfig(): void {
  config = null
}

// Paddle-specific configuration
export interface PaddleConfig {
  environment: 'sandbox' | 'production'
  vendorId: string | undefined
  apiKey: string | undefined
  publicKey: string | undefined
  webhookSecret: string | undefined
  isConfigured: boolean
}

/**
 * Get Paddle configuration
 */
export function getPaddleConfig(): PaddleConfig {
  const env = getConfig()
  const isConfigured = !!env.PADDLE_VENDOR_ID && !!env.PADDLE_API_KEY && !!env.PADDLE_PUBLIC_KEY

  return {
    environment: env.PADDLE_ENVIRONMENT,
    vendorId: env.PADDLE_VENDOR_ID,
    apiKey: env.PADDLE_API_KEY,
    publicKey: env.PADDLE_PUBLIC_KEY,
    webhookSecret: env.PADDLE_WEBHOOK_SECRET,
    isConfigured,
  }
}

/**
 * Minimum acceptable length (characters) for SESSION_SECRET.
 * 32 chars ≈ the entropy of `openssl rand -hex 32` truncated; enforced in production.
 */
export const SESSION_SECRET_MIN_LENGTH = 32

/**
 * Insecure development-only fallback used when SESSION_SECRET is not configured.
 * NEVER reached in production: getSessionSecret() throws there if the secret is
 * missing or too short, so this value can only sign cookies locally.
 */
const DEV_FALLBACK_SESSION_SECRET = 'dev-only-insecure-session-secret-do-not-use-in-production'

/**
 * Minimum number of distinct characters a session secret must contain.
 *
 * A length check alone accepts degenerate keys like 32 identical characters or
 * whitespace padding. Requiring a spread of distinct characters rejects the
 * obvious low-entropy values while staying comfortably below the variety of any
 * real `openssl rand -hex 32` output (which has ~16 distinct hex chars).
 */
export const SESSION_SECRET_MIN_DISTINCT_CHARS = 8

/**
 * Trim a secret and collapse blank values to undefined. A secret made only of
 * whitespace (e.g. a 32-space string) trims to empty and is therefore treated
 * as "not set", which fails the production check below.
 */
function normalizeSecret(secret: string | undefined): string | undefined {
  const trimmed = secret?.trim()
  return trimmed ? trimmed : undefined
}

/**
 * A secret is acceptable when, after trimming, it is long enough AND has enough
 * distinct characters. This rejects whitespace-only and trivially-padded /
 * low-entropy secrets that would otherwise pass a bare length check.
 */
function isAcceptableSecret(secret: string): boolean {
  return (
    secret.length >= SESSION_SECRET_MIN_LENGTH &&
    new Set(secret).size >= SESSION_SECRET_MIN_DISTINCT_CHARS
  )
}

/**
 * Resolve the HMAC key used to sign and verify session cookies.
 *
 * NODE_ENV is a `z.enum(['development','production','test']).default('development')`,
 * so the branches resolve as follows:
 * - **production / test** (the only non-development enum members): fails closed —
 *   throws unless SESSION_SECRET, after trimming, is long enough and has enough
 *   distinct characters. The committed dev fallback can never sign cookies here.
 * - **unset NODE_ENV**: resolves to `development` via the schema default, so it
 *   takes the development branch and may use the insecure fallback. (It does NOT
 *   fail closed — deployments must set NODE_ENV explicitly.)
 * - **a non-enum value** (e.g. `staging`, `preview`): rejected at `envSchema.parse()`
 *   before this function ever runs, which also fails closed.
 *
 * Development only: uses the configured secret when strong enough (warning if
 * weak), otherwise falls back to a fixed insecure dev key so local auth works
 * without extra setup. The secret is server-side only and must never be logged
 * or sent to the client.
 */
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

// Application constants
export const APP_CONFIG = {
  // Default currency
  DEFAULT_CURRENCY: 'USD',
  // Storage keys for localStorage
  STORAGE_PREFIX: 'budget-planner',
  // API endpoints
  API_BASE_PATH: '/api',
} as const

// Subscription status constants
// Note: 'canceled' spelling used (not 'cancelled') to match database schema
export const SUBSCRIPTION_STATUS = {
  FREE: 'free',
  ACTIVE: 'active',
  CANCELED: 'canceled',
  PAST_DUE: 'past_due',
} as const

// Currency constants
export const CURRENCY = {
  NONE: 'NONE',
  USD: 'USD',
  EUR: 'EUR',
  GBP: 'GBP',
  // Add more currencies as needed
} as const

// Application metadata
export const APP_METADATA = {
  // GitHub repository for issue tracking
  GITHUB_REPO: 'lucassilbernagel/budget-planner',
  GITHUB_ISSUES_URL: 'https://github.com/lucassilbernagel/budget-planner/issues',
  // Application name
  NAME: 'Budget Planner',
  // Application description
  DESCRIPTION: 'Personal finance tracking application',
} as const
