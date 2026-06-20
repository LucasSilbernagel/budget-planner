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

import { useRouter } from '@tanstack/react-router'
import { useQuery, useMutation } from '@tanstack/react-query'
import { PaddleAuthButton } from './paddle-button'

export interface AuthStatusProps {
  /** Whether to show user avatar/initial */
  showAvatar?: boolean
  /** Custom className for container */
  className?: string
}

/**
 * Fetch current user session
 */
async function fetchCurrentUser(): Promise<any | null> {
  const response = await fetch('/api/auth/me')
  
  if (!response.ok) {
    return null
  }
  
  const data = await response.json()
  return data.user || null
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
export function AuthStatus({ 
  showAvatar = false, 
  className = '',
}: AuthStatusProps) {
  const router = useRouter()
  const { data: user, isLoading, refetch } = useQuery({
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
    // Not authenticated - show login button
    return (
      <div className={`flex items-center gap-3 ${className}`}>
        <PaddleAuthButton variant="primary" />
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
        <span className="text-xs text-gray-500 capitalize">
          {user.subscriptionStatus}
        </span>
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
