/**
 * In-app contact form (story 9-1, FR27 / AC-1, AC-2, AC-4).
 *
 * Replaces the old GitHub "new issue" link with a first-party form. Submissions
 * are delivered client-side to Formspark (`submit-form.com`) via a native
 * `fetch` POST using a *public* form id — there is no server route, no mailer,
 * and no secret in the client (AC-4). The fetch/async-state shape mirrors
 * {@link MagicLinkForm}; the inline field-level validation mirrors the app's
 * established inline validation pattern (no `alert()` — forbidden since story 6-8).
 *
 * Data sovereignty (AC-3): Formspark stores submissions in Ireland (EU) but its
 * subprocessor AWS is US-owned, so this is the one CLOUD-Act-exposed path in the
 * app. It carries free-text feedback only (never financial data) — a scoped,
 * documented exception (see ADR-004). All other app data stays DanubeData/EU.
 *
 * Graceful degrade: when `VITE_FORMSPARK_FORM_ID` is unset (local dev / before
 * the Formspark form exists) the form still renders, but submitting shows a
 * friendly "temporarily unavailable" message instead of POSTing to an undefined
 * endpoint — the same philosophy as {@link EthicalAds}.
 */

import { useState } from 'react'
import {
  type ContactValidationError,
  MESSAGE_MAX_LENGTH,
  validateContactForm,
} from './validate-contact-form'

type Status = 'idle' | 'submitting' | 'success' | 'error' | 'unavailable'

const GENERIC_ERROR = 'Something went wrong sending your message. Please try again.'

/** UI cap on the optional name so a single submission can't be arbitrarily large. */
const NAME_MAX_LENGTH = 100

/**
 * The Formspark form id, read at render time (not module scope) so tests can
 * stub it via `vi.stubEnv` and so an unset value degrades to "unavailable".
 * Trimmed so a stray-whitespace `.env` value degrades gracefully.
 */
function getFormId(): string {
  return (import.meta.env.VITE_FORMSPARK_FORM_ID ?? '').trim()
}

export interface ContactFormProps {
  /** Additional classes for the form container. */
  className?: string
}

export function ContactForm({ className = '' }: ContactFormProps) {
  const formId = getFormId()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  // Formspark honeypot. Kept in state so its value is actually included in the
  // submitted payload (see handleSubmit) — a real user leaves it empty; a bot
  // that fills it is dropped, both client-side and by Formspark.
  const [honeypot, setHoneypot] = useState('')
  const [errors, setErrors] = useState<ContactValidationError[]>([])
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const [status, setStatus] = useState<Status>('idle')

  // Editing any field clears a terminal banner (success/error/unavailable) so
  // the form returns to a clean state for the next submit; it stays mounted the
  // whole time, so keyboard focus is never lost to a form/banner swap.
  const clearTerminalStatus = () => {
    if (status === 'success' || status === 'error' || status === 'unavailable') {
      setStatus('idle')
    }
  }

  const revalidate = (next: Partial<{ name: string; email: string; message: string }>) => {
    // Re-validate on change only after the first submit attempt, so the form
    // doesn't shout errors before the user has tried to submit.
    if (submitAttempted) {
      setErrors(
        validateContactForm({
          name: next.name ?? name,
          email: next.email ?? email,
          message: next.message ?? message,
        })
      )
    }
  }

  const getFieldError = (field: ContactValidationError['field']): string | undefined =>
    errors.find((error) => error.field === field)?.message

  const hasFieldError = (field: ContactValidationError['field']): boolean =>
    errors.some((error) => error.field === field)

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (status === 'submitting') {
      return
    }
    setSubmitAttempted(true)

    const newErrors = validateContactForm({ name, email, message })
    setErrors(newErrors)
    if (newErrors.length > 0) {
      return
    }

    // Honeypot tripped: a real user never fills the hidden `_gotcha` field.
    // Silently show success without sending so the bot gets no signal.
    if (honeypot.trim().length > 0) {
      setStatus('success')
      return
    }

    // No Formspark form configured (e.g. local dev): degrade gracefully rather
    // than POSTing to `https://submit-form.com/` with an empty id.
    if (!formId) {
      setStatus('unavailable')
      return
    }

    setStatus('submitting')
    try {
      // Send trimmed values so validation (which trims) and the delivered
      // payload agree — no whitespace-padded reply-to address or message.
      // `_gotcha` is included so Formspark's server-side honeypot can also act.
      const response = await fetch(`https://submit-form.com/${formId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          message: message.trim(),
          _gotcha: honeypot,
        }),
      })
      if (!response.ok) {
        throw new Error('submission failed')
      }
      setStatus('success')
      // Reset the fields so a returning user starts fresh.
      setName('')
      setEmail('')
      setMessage('')
      setHoneypot('')
      setSubmitAttempted(false)
      setErrors([])
    } catch {
      setStatus('error')
    }
  }

  const isSubmitting = status === 'submitting'

  return (
    <form onSubmit={handleSubmit} className={`space-y-4 ${className}`} noValidate>
      {/* Success confirmation. Rendered inline while the form stays mounted so a
          user can send another message and keyboard focus is never lost to a
          form/banner swap. Editing any field clears it (clearTerminalStatus). */}
      {status === 'success' && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800 dark:border-green-800 dark:bg-green-900/30 dark:text-green-300"
        >
          <p>
            Thanks for reaching out — your message has been sent. We&apos;ll be in touch if needed.
          </p>
        </div>
      )}

      {/* Name (optional) */}
      <div>
        <label
          htmlFor="contact-name"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          Name <span className="text-gray-400 dark:text-gray-500">(optional)</span>
        </label>
        <input
          id="contact-name"
          name="name"
          type="text"
          autoComplete="name"
          maxLength={NAME_MAX_LENGTH}
          value={name}
          onChange={(event) => {
            setName(event.target.value)
            revalidate({ name: event.target.value })
            clearTerminalStatus()
          }}
          className="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        />
      </div>

      {/* Email (optional, validated when provided) */}
      <div>
        <label
          htmlFor="contact-email"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          Email <span className="text-gray-400 dark:text-gray-500">(optional)</span>
        </label>
        <input
          id="contact-email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value)
            revalidate({ email: event.target.value })
            clearTerminalStatus()
          }}
          placeholder="you@example.com"
          className={`w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 dark:bg-gray-700 dark:text-white ${
            hasFieldError('email')
              ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
              : 'border-gray-300 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600'
          }`}
          aria-invalid={hasFieldError('email')}
          aria-describedby={hasFieldError('email') ? 'contact-email-error' : undefined}
        />
        {hasFieldError('email') && (
          <p
            id="contact-email-error"
            className="mt-1 text-sm text-red-600 dark:text-red-400"
            role="alert"
          >
            {getFieldError('email')}
          </p>
        )}
      </div>

      {/* Message (required) */}
      <div>
        <label
          htmlFor="contact-message"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          Message *
        </label>
        <textarea
          id="contact-message"
          name="message"
          rows={5}
          maxLength={MESSAGE_MAX_LENGTH}
          value={message}
          onChange={(event) => {
            setMessage(event.target.value)
            revalidate({ message: event.target.value })
            clearTerminalStatus()
          }}
          placeholder="Share feedback or report an issue…"
          className={`w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 dark:bg-gray-700 dark:text-white ${
            hasFieldError('message')
              ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
              : 'border-gray-300 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600'
          }`}
          aria-invalid={hasFieldError('message')}
          aria-describedby={hasFieldError('message') ? 'contact-message-error' : undefined}
        />
        {hasFieldError('message') && (
          <p
            id="contact-message-error"
            className="mt-1 text-sm text-red-600 dark:text-red-400"
            role="alert"
          >
            {getFieldError('message')}
          </p>
        )}
      </div>

      {/* Formspark honeypot: hidden from real users. Its value is submitted in
          the payload (see handleSubmit), and a non-empty value also short-
          circuits the submit client-side, so a bot that fills it is dropped
          both here and by Formspark. `hidden` (display:none) removes it from the
          a11y tree, the tab order, AND programmatic focus, so it never traps
          assistive tech or keyboard users — which is also why no `aria-hidden`
          is needed (and Biome forbids aria-hidden on a focusable input). */}
      <input
        type="text"
        name="_gotcha"
        tabIndex={-1}
        autoComplete="off"
        className="hidden"
        data-testid="contact-honeypot"
        value={honeypot}
        onChange={(event) => setHoneypot(event.target.value)}
      />

      {status === 'error' && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {GENERIC_ERROR}
        </p>
      )}

      {status === 'unavailable' && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          The contact form is temporarily unavailable. Please try again later.
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        aria-busy={isSubmitting}
        className="w-full rounded-lg bg-blue-600 px-4 py-2 font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
      >
        {isSubmitting ? 'Sending…' : 'Send message'}
      </button>
    </form>
  )
}
