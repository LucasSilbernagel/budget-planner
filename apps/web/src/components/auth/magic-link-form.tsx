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
 *
 * Theming (story 31-1): the `dark:` variants mirror `contact/contact-form.tsx`,
 * whose docblock says it mirrors THIS form — keeping the two on one idiom rather
 * than inventing a third. The one deliberate addition is
 * `dark:placeholder-gray-400` on the email field: this input has a placeholder
 * and contact-form's mirrored field does not, and it is the app-wide convention
 * for placeholder-bearing inputs (IncomePage, ExpensesPage, BalancePage, …).
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
        // The blue-600 fill is deliberately kept in BOTH themes — see the note on
        // `pricing-page.tsx`'s primary CTA. contact-form's button drops to
        // blue-500 on dark, which measures 3.68:1 against white (AA needs 4.5:1).
        //
        // `dark:focus:ring-offset-gray-800` is load-bearing, not decoration:
        // Tailwind's `--tw-ring-offset-color` defaults to WHITE and nothing
        // overrides it globally, so once this button moved onto a `.surface`
        // (gray-800) card it would otherwise paint a white band between the
        // button and its blue focus ring. gray-800 matches the CARD this sits on
        // — `NotFoundPage.tsx:55` and `components/profiles/profiles-page.tsx:85` use gray-900
        // because those buttons sit on the page canvas instead.
        className="w-full rounded-lg bg-blue-600 px-4 py-2 font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {status === 'submitting' ? 'Sending…' : 'Email me a sign-in link'}
      </button>
    </form>
  )
}
