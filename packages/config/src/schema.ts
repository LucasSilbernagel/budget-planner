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

  // Paddle Billing Configuration (UK Merchant of Record - CLOUD Act compliant).
  // Story 5-3 reconciled this from the deprecated Paddle Classic model (vendor
  // id + RSA public key + `v1,{ts},{hmac}` webhooks) to Paddle Billing
  // (server API key + browser client token + `Paddle-Signature` webhooks).
  PADDLE_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),
  // Server-side API key (`pdl_sdbx_...` / `pdl_live_...`) — used for the
  // Billing REST API (e.g. resolving a customer's email on a webhook).
  PADDLE_API_KEY: z.string().optional(),
  // Client-side token (`live_...` / `test_...`) passed to Paddle.js in the
  // browser to open a Billing checkout. Distinct from the API key and safe to
  // ship to the client. (Checkout UI wiring is Story 5-3 Task 2a.)
  PADDLE_CLIENT_TOKEN: z.string().optional(),
  // Notification-destination secret (`pdl_ntfset_...`) — HMAC key for the
  // `Paddle-Signature` header on incoming webhooks.
  PADDLE_WEBHOOK_SECRET: z.string().optional(),
  // Max age (seconds) of a webhook's signed timestamp before it is rejected as a
  // replay. Paddle's SDKs default to 5s; a self-hosted receiver behind clock
  // skew needs a wider window. 300s (5 min) is the default.
  // ⚠️ Deliberately NOT `z.coerce.number()` — that throws inside `getConfig()`
  // on ANY invalid value (not just `''`: `' '`, `'abc'`, `'0'`, `'-1'`,
  // `'1.5'` all reach `.positive()`/`.int()` and throw too), 500ing SSR and
  // every `/api/*` route, not just billing, for a deploy manifest with a
  // stray value in this one var. Falls back to the 300s default on anything
  // that isn't a positive integer instead of ever throwing.
  PADDLE_WEBHOOK_MAX_AGE_SECONDS: z
    .string()
    .optional()
    .transform((val) => {
      const parsed = val === undefined ? Number.NaN : Number(val)
      return Number.isInteger(parsed) && parsed > 0 ? parsed : 300
    }),
  // Paddle price IDs for the three Premium plans: the recurring €5.99/mo monthly
  // plan (story 5-20), the recurring €39/yr annual plan and the one-time €99
  // lifetime license (both story 25-2). Kept out of source (never hardcoded) so
  // the same build points at sandbox or production prices.
  // PADDLE_LIFETIME_PRICE_ID is what the webhook keys off to recognise a
  // one-time lifetime purchase and grant permanent Premium (see webhooks/paddle.ts).
  // Monthly needs no such id-matching: like annual it arrives as a `subscription.*`
  // event and resolves through `mapWebhookSubscriptionStatus`, price-agnostically.
  //
  // ⚠️ Story 5-20 REVERSED story 25-2's "no monthly" decision. 25-2 was right that
  // monthly is the least fee-efficient plan (Paddle's fixed €0.50 alone is 8.3% of
  // €5.99, so monthly nets 14.2-14.7% in fees against annual's 7.1-7.6%); the
  // reversal is on conversion grounds for an unproven product, not by disputing
  // that arithmetic.
  PADDLE_MONTHLY_PRICE_ID: z.string().optional(),
  PADDLE_ANNUAL_PRICE_ID: z.string().optional(),
  PADDLE_LIFETIME_PRICE_ID: z.string().optional(),

  // Database (Scaleway PostgreSQL)
  DATABASE_URL: z.string().optional(),

  // Transactional email (Story 5-16, magic-link login).
  // Provider: Brevo (Sendinblue) — Paris, France; EU-hosted data centers, so a
  // recipient email address (personal data) never leaves the EU (NFR1, NFR2).
  // EMAIL_API_KEY is a RUNTIME SECRET injected via Rapids — never committed.
  // Optional at the schema level so dev/test load without it; getEmailConfig()
  // reports `isConfigured`, and the mailer fails closed outside development.
  EMAIL_API_KEY: z.string().optional(),
  // Verified sender address for the EU provider (the "from" on the magic link).
  // Longhand-owned, verified with the email provider (Brevo) — Story 5-3.
  // `z.string().default()` applies ONLY to `undefined` — a manifest that
  // declares `EMAIL_FROM` with no value validates as `''`, every send is then
  // rejected by Brevo, and nobody can sign in with nothing failing at
  // startup. Map an empty/whitespace-only value to undefined FIRST so the
  // default actually applies. (Deliberately NOT `.email()`-validated: unlike
  // the numeric configs above, a strict format check here would make an
  // already-live typo THROW inside `getConfig()` and 500 every route — not
  // just email — trading a silent mailer failure for a total outage.)
  EMAIL_FROM: z.preprocess(
    (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
    z.string().default('hello@longhandbudget.com')
  ),

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

// Paddle Billing configuration
export interface PaddleConfig {
  environment: 'sandbox' | 'production'
  /** Server-side Billing REST API key. */
  apiKey: string | undefined
  /** Browser token for Paddle.js checkout. */
  clientToken: string | undefined
  /** HMAC key for the `Paddle-Signature` webhook header. */
  webhookSecret: string | undefined
  /** Rejection age (seconds) for a webhook's signed timestamp. */
  webhookMaxAgeSeconds: number
  /** Billing REST API base URL, derived from `environment`. */
  apiBaseUrl: string
  /**
   * Paddle price ID for the recurring €5.99/mo monthly plan (story 5-20).
   *
   * REQUIRED in production, like its two siblings — `assertPaddleProductionConfig()`
   * throws without it, because `pricing.md` states the €5.99 price on the legal
   * pricing page and that claim must be chargeable.
   *
   * Still typed `| undefined` and still absent in dev/sandbox builds, so consumers
   * must go on degrading gracefully (render the plan disabled, omit it from the
   * price preview) rather than assuming a string. They simply can no longer reach
   * that state in production.
   */
  monthlyPriceId: string | undefined
  /** Paddle price ID for the recurring €39/yr annual plan (story 25-2). */
  annualPriceId: string | undefined
  /** Paddle price ID for the one-time €99 lifetime license (story 25-2). */
  lifetimePriceId: string | undefined
  /** True only when the full Billing credential set is present. */
  isConfigured: boolean
}

/** Billing REST API base URL for each environment. */
export const PADDLE_API_BASE_URL = {
  sandbox: 'https://sandbox-api.paddle.com',
  production: 'https://api.paddle.com',
} as const

/**
 * Get Paddle Billing configuration.
 *
 * `isConfigured` requires the API key, the client token, and the webhook secret
 * — the three secrets every part of the Billing integration needs. Price IDs are
 * checked separately by `assertPaddleProductionConfig()` because a build can be
 * "configured" for sandbox smoke tests before the live prices exist.
 */
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

/**
 * Fail-closed production assertion for Paddle Billing (mirrors getSessionSecret /
 * getSiteUrl). Every `PADDLE_*` var is `.optional()` in the schema so a
 * dev/test/sandbox build loads without them — but a production build with a
 * missing secret or price ID would silently degrade to "billing disabled" (no
 * checkout, no webhook processing, no revenue) with only a log line. Call this on
 * the revenue-critical paths (the webhook handler; the checkout route) so a
 * misdeployed production build crashes loudly instead.
 *
 * Throws in production/test when the full Billing set is absent, or when any two
 * price IDs are equal (which would make a subscription renewal invoice match the
 * lifetime price and be mis-granted as a permanent entitlement, or charge one
 * cadence at the other's price).
 *
 * ⚠️ **All three price IDs are REQUIRED, monthly included** (story 5-20, settled
 * at code review). An earlier draft of that story made monthly OPTIONAL, reasoning
 * that it was a post-launch addition the other two plans did not depend on, and
 * that requiring it would turn "the monthly price does not exist yet" into a total
 * billing outage. That was sound while monthly was unshipped — but the SAME story
 * put "Premium is €39 per year, **€5.99 per month**, or €99 once" on
 * `content/legal/pricing.md`, the Paddle-required legal pricing page. Once a price
 * is stated on a compliance surface, the id is no longer optional: without it the
 * page advertises a price the product cannot charge. A loud boot failure is the
 * correct response to that, and is exactly what this function is for.
 *
 * ⚠️ Every price ID is checked with `.trim()`, and that is load-bearing rather than
 * defensive. A plain `!env.X` treats `'  '` (a pasted-blank manifest value) as
 * PRESENT, so a whitespace-only id passed this required check, then dropped out of
 * the distinctness comparison below as trimmed-empty, and the whole assertion
 * reported healthy. Downstream, `checkout-config` trimmed it to `''` and served a
 * disabled plan, while the webhook silently ignored every lifetime purchase whose
 * price could no longer match — money collected, no entitlement granted. Both
 * checks must share ONE notion of "configured", which is the trimmed value.
 *
 * Runs the strict checks whenever `NODE_ENV` is non-development OR
 * `PADDLE_ENVIRONMENT === 'production'`. The `PADDLE_ENVIRONMENT` clause closes
 * the known "NODE_ENV split-brain" gap: the env schema defaults an UNSET
 * `NODE_ENV` to `development`, so a container that forgets `NODE_ENV=production`
 * but sets `PADDLE_ENVIRONMENT=production` (as any real deploy does) is still
 * validated. Local dev (`PADDLE_ENVIRONMENT=sandbox`) stays exempt so it needs
 * no Paddle account.
 */
export function assertPaddleProductionConfig(): void {
  const env = getConfig()
  if (env.NODE_ENV === 'development' && env.PADDLE_ENVIRONMENT !== 'production') {
    return
  }

  const missing: string[] = []
  if (!env.PADDLE_API_KEY) missing.push('PADDLE_API_KEY')
  if (!env.PADDLE_CLIENT_TOKEN) missing.push('PADDLE_CLIENT_TOKEN')
  if (!env.PADDLE_WEBHOOK_SECRET) missing.push('PADDLE_WEBHOOK_SECRET')
  // `.trim()` on all three — see the whitespace note in the docblock.
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

  // Distinctness across all three price ids.
  //
  // The filter below still drops trimmed-empty values. That is now belt-and-braces
  // rather than the load-bearing behaviour it once was: the required check above
  // has already rejected any blank id, so this loop can only ever see real values
  // in production. It is kept so the function stays correct if the required set is
  // ever narrowed again — `undefined === undefined` must never read as a collision
  // between two unset vars.
  //
  // Trimmed before comparing, mirroring the trimming the webhook does before
  // matching an id and `checkout-config` does before handing ids to the browser
  // — an id pasted with a trailing newline must not slip a collision past here
  // only to collide for real downstream.
  //
  // Only configured ids take part: an absent monthly id is a supported state
  // (see the docblock), and `undefined === undefined` would otherwise report a
  // phantom collision between two unset vars.
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

// Email (transactional) configuration — Story 5-16
export interface EmailConfig {
  /** Brevo (EU) API key; undefined when unset. Runtime secret, never logged. */
  apiKey: string | undefined
  /** Verified sender address. */
  from: string
  /** Display name shown alongside the sender address. */
  fromName: string
  /** True only when an API key is present (so the mailer can actually send). */
  isConfigured: boolean
}

/** Display name attached to outbound magic-link emails. */
export const EMAIL_FROM_NAME = 'Longhand Budget'

/**
 * Resolve the public site origin used to build absolute links in emails
 * (magic-link, Story 5-16).
 *
 * Fails closed in production (mirrors getSessionSecret): a missing, localhost, or
 * non-HTTPS `SITE_URL` outside development would otherwise silently email users a
 * `http://localhost:5173/...` link. NODE_ENV is the enum-defaulted
 * `development`, so production/test take the strict branch; an unset NODE_ENV
 * resolves to `development` and returns the (localhost) default for local use.
 */
export function getSiteUrl(): string {
  const env = getConfig()
  const url = env.SITE_URL?.trim()

  if (env.NODE_ENV === 'production') {
    if (!url || url.includes('localhost') || !url.startsWith('https://')) {
      throw new Error(
        'SITE_URL must be set to the public https origin (not localhost) in production — magic-link emails build absolute links from it.'
      )
    }
  }

  return url || 'http://localhost:5173'
}

/**
 * Get transactional-email configuration (EU provider — Brevo/Sendinblue, France).
 * The recipient address is personal data, so the provider must be EU-resident
 * (NFR1, NFR2). The API key is a runtime secret resolved here from the environment.
 */
export function getEmailConfig(): EmailConfig {
  const env = getConfig()
  return {
    apiKey: env.EMAIL_API_KEY,
    from: env.EMAIL_FROM,
    fromName: EMAIL_FROM_NAME,
    isConfigured: !!env.EMAIL_API_KEY,
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
  NAME: 'Longhand Budget',
  // Application description
  DESCRIPTION: 'Privacy-first budget & retirement planner',
} as const
