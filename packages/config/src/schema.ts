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
  const isConfigured = 
    !!env.PADDLE_VENDOR_ID &&
    !!env.PADDLE_API_KEY &&
    !!env.PADDLE_PUBLIC_KEY

  return {
    environment: env.PADDLE_ENVIRONMENT,
    vendorId: env.PADDLE_VENDOR_ID,
    apiKey: env.PADDLE_API_KEY,
    publicKey: env.PADDLE_PUBLIC_KEY,
    webhookSecret: env.PADDLE_WEBHOOK_SECRET,
    isConfigured,
  }
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
