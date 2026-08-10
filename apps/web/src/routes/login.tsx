/**
 * Login Page
 *
 * Passwordless email magic-link sign-in (Story 5-16). A returning paid user
 * enters their email and receives a one-time link; opening it mints the signed
 * session. Account creation happens at Paddle Billing checkout (Story 5-3), not
 * here — this page is re-authentication only.
 *
 * Route: /login
 *
 * Data Sovereignty: the sign-in email is sent via an EU-resident provider (NFR1/NFR2).
 */

import { MagicLinkForm } from '@/components/auth/magic-link-form'
import { createFileRoute } from '@tanstack/react-router'

interface LoginSearch {
  /** Generic error code from a failed verify redirect (e.g. invalid_or_expired). */
  error?: string
}

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    error: typeof search.error === 'string' ? search.error : undefined,
  }),
  component: LoginPage,
})

/** Map an opaque error code to a generic, non-enumerating message. */
function errorMessage(code: string | undefined): string | undefined {
  if (code === 'invalid_or_expired') {
    return 'That sign-in link was invalid or has expired. Please request a new one.'
  }
  return code ? 'Unable to sign you in. Please request a new link.' : undefined
}

function LoginPage() {
  const { error } = Route.useSearch()

  return (
    <div className="min-h-screen flex flex-col items-center justify-center surface-sunken p-4">
      <div className="w-full max-w-md">
        {/* Logo / Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-heading">Longhand Budget</h1>
          <p className="text-body mt-2">Track your finances with privacy and control</p>
        </div>

        {/* Auth Card */}
        <div className="surface shadow-md rounded-2xl p-6 sm:p-8 border border-default">
          <div className="text-center">
            <h2 className="text-2xl font-semibold text-heading mb-2">Sign in</h2>
            <p className="text-body mb-6">
              Enter your email and we&apos;ll send you a one-time sign-in link to access your
              subscription and synced data on any device.
            </p>
          </div>

          {/* Magic-link email form */}
          <MagicLinkForm initialError={errorMessage(error)} />

          <div className="mt-4 text-center text-sm text-muted">
            <p>
              By signing in, you agree to our{' '}
              <a href="/terms" className="text-accent hover:underline">
                Terms of Service
              </a>{' '}
              and{' '}
              <a href="/privacy" className="text-accent hover:underline">
                Privacy Policy
              </a>
            </p>
          </div>

          {/* Free Tier Notice — `.surface-inset`, not `.surface-sunken`: this
              panel is nested ON the auth card, so it should read a touch lighter
              than the gray-800 card rather than matching the gray-900 canvas. */}
          <div className="mt-6 p-4 surface-inset rounded-lg border border-default">
            <h3 className="font-medium text-heading mb-1">No account needed</h3>
            <p className="text-sm text-body">
              You can also use Longhand without an account. Your data will be stored locally on this
              device only.
            </p>
            <a
              href="/"
              className="inline-block mt-2 text-sm text-accent hover:underline font-medium"
            >
              Continue without account →
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
