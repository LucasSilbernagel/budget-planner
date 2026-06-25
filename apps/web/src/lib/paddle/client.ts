/**
 * Paddle Client
 *
 * Client-side Paddle.js integration for authentication.
 * Handles Paddle OAuth flow initialization.
 */

import { getPaddleOAuthConfig } from './config'

/**
 * Minimal typing for the Paddle.js global injected by the loaded script.
 * Only the members this client uses are declared.
 */
interface PaddleGlobal {
  Initialize: (options: { vendor: number; environment: string }) => void
  Checkout: { open: (options: Record<string, unknown>) => void }
}

/**
 * Cached Paddle user shape. Currently unused (server is the source of truth),
 * declared so the accessor avoids `any`.
 */
interface PaddleUser {
  id: string
  email?: string
}

/**
 * Safely read the Paddle global off `window` with a narrow type instead of `any`.
 */
function getPaddleGlobal(): PaddleGlobal | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }
  return (window as unknown as { Paddle?: PaddleGlobal }).Paddle
}

/**
 * Paddle.js script URL
 * This loads the Paddle checkout script which provides the Paddle object
 */
export const PADDLE_SCRIPT_URL = 'https://cdn.paddle.com/paddle/v2/paddle.js'

/**
 * Flag to track if Paddle.js has been loaded
 */
let paddleLoaded = false
let paddleLoading = false

/**
 * Load Paddle.js script dynamically
 */
export async function loadPaddleScript(): Promise<void> {
  if (paddleLoaded || paddleLoading) {
    return
  }

  paddleLoading = true

  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = PADDLE_SCRIPT_URL
    script.async = true
    script.defer = true

    script.onload = () => {
      paddleLoaded = true
      paddleLoading = false
      resolve()
    }

    script.onerror = () => {
      paddleLoading = false
      reject(new Error('Failed to load Paddle.js'))
    }

    document.head.appendChild(script)
  })
}

/**
 * Initialize Paddle authentication
 * Opens Paddle's OAuth popup for user authentication
 */
export function initializePaddleAuth(): void {
  const config = getPaddleOAuthConfig()

  if (!config.vendorId || !config.publicKey) {
    console.error('Paddle vendor ID and public key are required')
    throw new Error('Paddle configuration is incomplete')
  }

  // Initialize Paddle with vendor configuration
  const paddle = getPaddleGlobal()
  if (paddle) {
    paddle.Initialize({
      vendor: parseInt(config.vendorId),
      environment: config.environment,
    })
  }
}

/**
 * Open Paddle authentication popup
 * Redirects user to Paddle for login/signup
 */
export function openPaddleAuth(): void {
  const config = getPaddleOAuthConfig()

  if (!config.vendorId || !config.publicKey) {
    throw new Error('Paddle configuration is incomplete. Cannot authenticate.')
  }

  // Use Paddle's Checkout.open method for authentication
  const paddle = getPaddleGlobal()
  if (paddle) {
    paddle.Checkout.open({
      vendor: parseInt(config.vendorId),
      environment: config.environment,
      // This will trigger Paddle's authentication flow
      // After successful auth, Paddle redirects to our callback URL
    })
  } else {
    // Fallback: redirect to Paddle manually
    const paddleAuthUrl = new URL('https://checkout.paddle.com/v1/auth')
    paddleAuthUrl.searchParams.set('vendor', config.vendorId)
    paddleAuthUrl.searchParams.set('environment', config.environment)
    paddleAuthUrl.searchParams.set('redirect_uri', config.redirectUri)

    window.location.href = paddleAuthUrl.toString()
  }
}

/**
 * Check if user is authenticated with Paddle
 * This is a client-side check - server should verify actual session
 */
export function isPaddleAuthenticated(): boolean {
  // Check for session cookie or localStorage token
  // In a real implementation, this would check your session management
  return false
}

/**
 * Get current Paddle user from local storage/session
 * Note: This is cached data - server should verify with database
 */
export function getCurrentPaddleUser(): PaddleUser | null {
  // In a real implementation, this would read from your session
  return null
}
