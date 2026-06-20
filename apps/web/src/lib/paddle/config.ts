/**
 * Paddle Configuration
 * 
 * Centralized configuration for Paddle integration.
 * Handles environment-specific settings and client initialization.
 */

import { getPaddleConfig } from '@budget-planner/config'

// Paddle API endpoints
export const PADDLE_API_BASE_URLS = {
  sandbox: 'https://sandbox-vendors.paddle.com',
  production: 'https://vendors.paddle.com',
} as const

// Paddle OAuth endpoints
export const PADDLE_OAUTH_BASE_URLS = {
  sandbox: 'https://sandbox-checkout.paddle.com',
  production: 'https://checkout.paddle.com',
} as const

/**
 * Get Paddle environment configuration
 */
export function getPaddleEnvironment() {
  const paddleConfig = getPaddleConfig()
  
  return {
    environment: paddleConfig.environment,
    isSandbox: paddleConfig.environment === 'sandbox',
    isProduction: paddleConfig.environment === 'production',
    apiBaseUrl: PADDLE_API_BASE_URLS[paddleConfig.environment],
    oauthBaseUrl: PADDLE_OAUTH_BASE_URLS[paddleConfig.environment],
    vendorId: paddleConfig.vendorId,
    publicKey: paddleConfig.publicKey,
    isConfigured: paddleConfig.isConfigured,
  }
}

/**
 * Paddle OAuth configuration
 * Used for client-side Paddle.js initialization
 */
export function getPaddleOAuthConfig() {
  const { environment, vendorId, publicKey, isConfigured } = getPaddleEnvironment()
  
  if (!isConfigured) {
    console.warn('Paddle configuration is not complete. Some features may not work.')
  }
  
  return {
    vendorId: vendorId || '',
    publicKey: publicKey || '',
    environment,
    // OAuth settings
    // Paddle redirects back to this URL after authentication
    redirectUri: typeof window !== 'undefined' ? `${window.location.origin}/api/auth/paddle/callback` : '',
  }
}

/**
 * Type for Paddle user data from webhooks
 */
export interface PaddleWebhookUser {
  id: string
  email: string
  subscription_status: 'free' | 'active' | 'past_due' | 'canceled'
  currency?: string
}

/**
 * Type for client-side Paddle user
 */
export interface PaddleUser {
  id: string
  email: string
  subscriptionStatus: 'free' | 'active' | 'past_due' | 'canceled'
  currency: string
}
