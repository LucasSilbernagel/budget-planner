/**
 * Authentication Status Component
 *
 * Displays current user authentication status.
 * Shows user info when authenticated, login button when not.
 *
 * Usage:
 * ```tsx
 * <AuthStatus />
 * <AuthStatus showAvatar={true} />
 * ```
 */

import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useRouter } from '@tanstack/react-router'

export interface AuthStatusProps {
  /** Whether to show user avatar/initial */
  showAvatar?: boolean
  /** Custom className for container */
  className?: string
}

/**
 * Authenticated user shape consumed by this component.
 */
interface AuthUser {
  email: string
  subscriptionStatus: string
}

/**
 * Fetch current user session
 */
async function fetchCurrentUser(): Promise<AuthUser | null> {
  const response = await fetch('/api/auth/me')

  if (!response.ok) {
    return null
  }

  const data = (await response.json()) as { user?: AuthUser }
  return data.user ?? null
}

/**
 * Logout user
 */
async function logoutUser(): Promise<void> {
  const response = await fetch('/api/auth/logout', {
    method: 'POST',
  })

  if (!response.ok) {
    throw new Error('Failed to logout')
  }
}

/**
 * Authentication Status Component
 */
export function AuthStatus({ showAvatar = false, className = '' }: AuthStatusProps) {
  const router = useRouter()
  const {
    data: user,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['currentUser'],
    queryFn: fetchCurrentUser,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })

  const logoutMutation = useMutation({
    mutationFn: logoutUser,
    onSuccess: () => {
      // Clear client-side state
      router.invalidate()
      // Refresh user data
      refetch()
    },
  })

  const handleLogout = async () => {
    try {
      await logoutMutation.mutateAsync()
    } catch (error) {
      console.error('Logout failed:', error)
    }
  }

  if (isLoading) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <div className="animate-spin h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full" />
        <span className="text-sm text-gray-600">Loading...</span>
      </div>
    )
  }

  if (!user) {
    // Not authenticated - link to the magic-link sign-in page (Story 5-16).
    return (
      <div className={`flex items-center gap-3 ${className}`}>
        <Link
          to="/login"
          className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Sign in
        </Link>
      </div>
    )
  }

  // Authenticated - show user info
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {showAvatar && (
        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
          <span className="text-sm font-medium text-blue-600">
            {user.email.charAt(0).toUpperCase()}
          </span>
        </div>
      )}

      <div className="flex flex-col">
        <span className="text-sm font-medium text-gray-900">{user.email}</span>
        <span className="text-xs text-gray-500 capitalize">{user.subscriptionStatus}</span>
      </div>

      <button
        type="button"
        onClick={handleLogout}
        disabled={logoutMutation.isPending}
        className="text-sm text-gray-600 hover:text-red-600 transition-colors"
        aria-label="Logout"
      >
        {logoutMutation.isPending ? 'Logging out...' : 'Logout'}
      </button>
    </div>
  )
}
