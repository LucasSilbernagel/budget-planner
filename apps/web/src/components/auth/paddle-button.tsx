/**
 * Paddle Authentication Button
 *
 * Component for triggering Paddle OAuth authentication flow.
 * Renders a button that initiates the Paddle authentication popup.
 *
 * Usage:
 * ```tsx
 * <PaddleAuthButton />
 * <PaddleAuthButton variant="secondary" />
 * <PaddleAuthButton className="custom-classes" />
 * ```
 */

import { loadPaddleScript, openPaddleAuth } from '@/lib/paddle/client'
import { useEffect, useState } from 'react'

export interface PaddleAuthButtonProps {
  /** Button variant styling */
  variant?: 'primary' | 'secondary' | 'ghost'
  /** Additional CSS classes */
  className?: string
  /** Loading state override */
  isLoading?: boolean
  /** Text to display when loading */
  loadingText?: string
  /** Text to display on button */
  children?: React.ReactNode
}

const baseClasses = `
  inline-flex items-center justify-center gap-2
  px-4 py-2
  font-medium
  rounded-lg
  transition-colors duration-200
  focus:outline-none focus:ring-2 focus:ring-offset-2
  disabled:opacity-50 disabled:cursor-not-allowed
`

const variantClasses = {
  primary: `
    bg-blue-600 text-white
    hover:bg-blue-700
    focus:ring-blue-500
    active:bg-blue-800
  `,
  secondary: `
    bg-white text-blue-600 border border-blue-600
    hover:bg-blue-50
    focus:ring-blue-500
    active:bg-blue-100
  `,
  ghost: `
    text-blue-600
    hover:bg-blue-50
    focus:ring-blue-500
    active:bg-blue-100
  `,
}

export function PaddleAuthButton({
  variant = 'primary',
  className = '',
  isLoading = false,
  loadingText = 'Signing in...',
  children = 'Sign up with Paddle',
}: PaddleAuthButtonProps) {
  const [paddleReady, setPaddleReady] = useState(false)
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load Paddle.js script on component mount
  useEffect(() => {
    loadPaddleScript()
      .then(() => {
        setPaddleReady(true)
        // Initialize Paddle auth
        try {
          // Note: Paddle.Initialize is called in the client.ts file
          // The script is loaded, Paddle object should be available
        } catch (err) {
          console.warn('Paddle initialization warning:', err)
        }
      })
      .catch((err) => {
        console.error('Failed to load Paddle.js:', err)
        setError('Failed to load authentication service')
      })
  }, [])

  const handleClick = async () => {
    if (!paddleReady || isAuthenticating) return

    setIsAuthenticating(true)
    setError(null)

    try {
      openPaddleAuth()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
      setIsAuthenticating(false)
    }
  }

  const disabled = !paddleReady || isAuthenticating || !!error
  const loading = isAuthenticating || isLoading

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        className={`${baseClasses} ${variantClasses[variant]} ${className}`}
        aria-label={loading ? loadingText : (children as string) || 'Sign up with Paddle'}
        aria-busy={loading}
      >
        {loading ? (
          <>
            <svg
              className="animate-spin h-5 w-5"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            {loadingText}
          </>
        ) : (
          <>
            <PaddleIcon />
            {children}
          </>
        )}
      </button>

      {error && <p className="text-sm text-red-600 text-center">{error}</p>}

      {!paddleReady && !error && (
        <p className="text-sm text-gray-500 text-center">Loading authentication...</p>
      )}
    </div>
  )
}

/**
 * Paddle Icon Component
 * Simple Paddle logo SVG icon
 */
function PaddleIcon() {
  return (
    <svg
      className="w-5 h-5"
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
