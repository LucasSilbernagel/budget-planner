/**
 * usePremiumAccess Hook
 * 
 * React hook for checking premium feature access.
 * Provides subscription status and access control for premium features.
 * 
 * Architecture: React Hook with TanStack Start Server Functions
 * Data Sovereignty: All checks performed server-side, data in DanubeData (Germany - EU)
 */

import { useState, useEffect, useCallback } from 'react'
import type { UserSession } from '../server/api/auth/paddle'

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Premium access status
 */
export interface PremiumAccessStatus {
  /** Whether user has access to premium features */
  hasAccess: boolean
  /** User's subscription status */
  subscriptionStatus: 'free' | 'active' | 'past_due' | 'canceled' | null
  /** Whether the check is currently loading */
  isLoading: boolean
  /** Error message if check failed */
  error: string | null
  /** Whether user is authenticated */
  isAuthenticated: boolean
}

/**
 * Result of premium access check
 */
export interface PremiumAccessCheckResult {
  hasAccess: boolean
  subscriptionStatus: 'free' | 'active' | 'past_due' | 'canceled' | null
  isAuthenticated: boolean
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Default premium access status
 */
const defaultStatus: PremiumAccessStatus = {
  hasAccess: false,
  subscriptionStatus: null,
  isLoading: true,
  error: null,
  isAuthenticated: false,
}

/**
 * Custom hook for checking premium feature access
 * 
 * @returns Premium access status and check function
 * 
 * @example
 * ```tsx
 * const { hasAccess, subscriptionStatus, isLoading, checkAccess } = usePremiumAccess()
 * 
 * if (isLoading) return <LoadingSpinner />
 * if (!hasAccess) return <UpgradePrompt />
 * return <PremiumFeature />
 * ```
 */
export function usePremiumAccess(): {
  status: PremiumAccessStatus
  checkAccess: () => Promise<PremiumAccessCheckResult>
  refresh: () => Promise<void>
} {
  const [status, setStatus] = useState<PremiumAccessStatus>(defaultStatus)

  /**
   * Check premium access by calling server function
   */
  const checkAccess = useCallback(async (): Promise<PremiumAccessCheckResult> => {
    try {
      setStatus((prev) => ({ ...prev, isLoading: true, error: null }))

      // Import server function dynamically to avoid circular dependencies
      const { checkPremiumAccessServer } = await import('../server/api/data/forecasting')
      
      // Create request object for server function
      // In browser environment, use document.cookie; in SSR, this will be undefined
      // and the server function will handle authentication from context
      const request = getRequestContext()
      
      const result = await checkPremiumAccessServer(request)

      if (result.success && result.data) {
        const newStatus: PremiumAccessStatus = {
          hasAccess: result.data.hasAccess,
          subscriptionStatus: result.data.subscriptionStatus,
          isLoading: false,
          error: null,
          // User is authenticated if we successfully got their subscription status
          // (even if it's 'free', they have a valid session)
          isAuthenticated: true,
        }
        setStatus(newStatus)
        return {
          hasAccess: result.data.hasAccess,
          subscriptionStatus: result.data.subscriptionStatus,
          isAuthenticated: true,
        }
      } else {
        // Fallback for when server check fails - assume no access
        // Log the error for debugging
        console.error('Premium access check failed:', result.error)
        const fallbackStatus: PremiumAccessStatus = {
          hasAccess: false,
          subscriptionStatus: 'free',
          isLoading: false,
          error: result.error || 'Failed to check premium access',
          isAuthenticated: false,
        }
        setStatus(fallbackStatus)
        return {
          hasAccess: false,
          subscriptionStatus: 'free',
          isAuthenticated: false,
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to check premium access'
      const errorStatus: PremiumAccessStatus = {
        hasAccess: false,
        subscriptionStatus: null,
        isLoading: false,
        error: errorMessage,
        isAuthenticated: false,
      }
      setStatus(errorStatus)
      return {
        hasAccess: false,
        subscriptionStatus: null,
        isAuthenticated: false,
      }
    }
  }, [])

  /**
   * Refresh premium access status
   */
  const refresh = useCallback(async (): Promise<void> => {
    await checkAccess()
  }, [checkAccess])

  // Check access on mount
  useEffect(() => {
    checkAccess()
  }, [checkAccess])

  return { status, checkAccess, refresh }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get request context for server functions
 * Creates a Request object with cookies from the browser
 * Safe for SSR - returns a basic request without cookies in server environment
 */
function getRequestContext(): Request {
  // In TanStack Start, the request is available in the loader/context
  // For client-side calls, we need to pass a Request with cookies
  // Check for document to avoid SSR errors
  const headers: Record<string, string> = {}
  
  if (typeof document !== 'undefined') {
    headers.cookie = document.cookie
  }
  
  // @ts-expect-error - Creating Request with headers
  return new Request('http://localhost:5173', {
    headers,
  })
}

// ============================================================================
// Utility Hook for Route Protection
// ============================================================================

/**
 * Hook for protecting premium routes
 * Returns whether user can access the route and loading state
 * 
 * @returns Object with access status and loading state
 */
export function usePremiumRouteAccess(): {
  canAccess: boolean
  isLoading: boolean
  subscriptionStatus: 'free' | 'active' | 'past_due' | 'canceled' | null
  isAuthenticated: boolean
} {
  const { status } = usePremiumAccess()

  return {
    canAccess: status.hasAccess,
    isLoading: status.isLoading,
    subscriptionStatus: status.subscriptionStatus,
    isAuthenticated: status.isAuthenticated,
  }
}

// ============================================================================
// Server-Side Access Check
// ============================================================================

/**
 * Server-side function to check premium access from request
 * Used in loaders and server functions
 * 
 * @param request - Incoming request
 * @returns Promise resolving to access check result
 */
export async function checkPremiumAccess(request: Request): Promise<PremiumAccessCheckResult> {
  try {
    const { checkPremiumAccessServer } = await import('../server/api/data/forecasting')
    const result = await checkPremiumAccessServer(request)

    if (result.success && result.data) {
      return {
        hasAccess: result.data.hasAccess,
        subscriptionStatus: result.data.subscriptionStatus,
        // User is authenticated if we successfully got their subscription status
        isAuthenticated: true,
      }
    }
    // If check failed, assume no access and not authenticated
    console.error('Premium access check failed:', result.error)
    return { hasAccess: false, subscriptionStatus: 'free', isAuthenticated: false }
  } catch (error) {
    // Log the error for debugging
    console.error('Premium access check error:', error)
    return { hasAccess: false, subscriptionStatus: 'free', isAuthenticated: false }
  }
}
