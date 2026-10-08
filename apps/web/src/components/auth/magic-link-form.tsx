// The confirmation is deliberately generic so the UI never reveals whether the address
// is registered.

import { useState } from 'react'

type Status = 'idle' | 'submitting' | 'sent' | 'error'

export interface MagicLinkFormProps {
  initialError?: string
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
        className={`rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800 dark:border-green-800 dark:bg-green-900/30 dark:text-green-300 ${className}`}
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
        <label
          htmlFor="login-email"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
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
          className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400"
          placeholder="you@example.com"
        />
      </div>

      {message && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {message}
        </p>
      )}

      <button
        type="submit"
        disabled={status === 'submitting'}
        aria-busy={status === 'submitting'}
        // blue-600 in both themes: blue-500 on dark fails AA against white. The ring offset
        // matches the gray-800 card, or a white band shows around the focus ring.
        className="w-full rounded-lg bg-blue-600 px-4 py-2 font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {status === 'submitting' ? 'Sending…' : 'Email me a sign-in link'}
      </button>
    </form>
  )
}
