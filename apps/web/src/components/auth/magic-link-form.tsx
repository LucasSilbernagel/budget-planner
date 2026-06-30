/**
 * Magic-Link Login Form (Story 5-16, Task 5, AC-5)
 *
 * Passwordless re-authentication: the user enters their email and we POST it to
 * the request endpoint, which emails a one-time sign-in link to EXISTING
 * accounts. The confirmation is deliberately GENERIC ("if an account exists…")
 * so the UI never reveals whether the address is registered — matching the
 * endpoint's no-enumeration contract.
 *
 * Accessibility: a single labeled email input, an aria-busy submit button, a
 * polite live region for the confirmation, and a role="alert" for errors.
 */

import { useState } from 'react'

type Status = 'idle' | 'submitting' | 'sent' | 'error'

export interface MagicLinkFormProps {
  /** Pre-populated generic error (e.g. from an expired-link redirect). */
  initialError?: string
  /** Additional classes for the form container. */
  className?: string
}

const GENERIC_ERROR = 'Something went wrong sending your link. Please try again.'

export function MagicLinkForm({ initialError, className = '' }: MagicLinkFormProps) {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>(initialError ? 'error' : 'idle')
  const [message, setMessage] = useState(initialError ?? '')

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (status === 'submitting') {
      return
    }
    setStatus('submitting')
    setMessage('')

    try {
      const response = await fetch('/api/auth/login/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (!response.ok) {
        throw new Error('request failed')
      }
      setStatus('sent')
    } catch {
      setStatus('error')
      setMessage(GENERIC_ERROR)
    }
  }

  if (status === 'sent') {
    return (
      <div
        role="status"
        aria-live="polite"
        className={`rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800 ${className}`}
      >
        <p>
          Check your email — if an account exists for <strong>{email}</strong>, we&apos;ve sent a
          one-time sign-in link. It expires in 15 minutes.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className={`space-y-4 ${className}`} noValidate>
      <div className="text-left">
        <label htmlFor="login-email" className="block text-sm font-medium text-gray-700 mb-1">
          Email address
        </label>
        <input
          id="login-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="you@example.com"
        />
      </div>

      {message && (
        <p role="alert" className="text-sm text-red-600">
          {message}
        </p>
      )}

      <button
        type="submit"
        disabled={status === 'submitting'}
        aria-busy={status === 'submitting'}
        className="w-full rounded-lg bg-blue-600 px-4 py-2 font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {status === 'submitting' ? 'Sending…' : 'Email me a sign-in link'}
      </button>
    </form>
  )
}
