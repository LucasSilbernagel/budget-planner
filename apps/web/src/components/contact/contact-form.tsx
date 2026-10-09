import { cn } from '@/lib/cn'
// Posts client-side to Formspark with a public form id: no server route and no secret.
// It is an accepted exception to the EU-only data rule because it carries free-text feedback only.

import { useState } from 'react'
import {
	type ContactValidationError,
	MESSAGE_MAX_LENGTH,
	validateContactForm,
} from './validate-contact-form'

type Status = 'idle' | 'submitting' | 'success' | 'error' | 'unavailable'

const GENERIC_ERROR = 'Something went wrong sending your message. Please try again.'

const NAME_MAX_LENGTH = 100

// Read at render time so tests can stub it with vi.stubEnv.
function getFormId(): string {
	return (import.meta.env.VITE_FORMSPARK_FORM_ID ?? '').trim()
}

export type ContactFormProps = {
	className?: string
}

export function ContactForm({ className = '' }: ContactFormProps) {
	const formId = getFormId()

	const [name, setName] = useState('')
	const [email, setEmail] = useState('')
	const [message, setMessage] = useState('')
	// Honeypot kept in state so it is sent: Formspark drops a filled one server-side too.
	const [honeypot, setHoneypot] = useState('')
	const [errors, setErrors] = useState<ContactValidationError[]>([])
	const [submitAttempted, setSubmitAttempted] = useState(false)
	const [status, setStatus] = useState<Status>('idle')

	// The form stays mounted under the banner so keyboard focus is never lost.
	const clearTerminalStatus = () => {
		if (status === 'success' || status === 'error' || status === 'unavailable') {
			setStatus('idle')
		}
	}

	const revalidate = (next: Partial<{ name: string; email: string; message: string }>) => {
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

		// Fake success so the bot gets no signal.
		if (honeypot.trim().length > 0) {
			setStatus('success')
			return
		}

		if (!formId) {
			setStatus('unavailable')
			return
		}

		setStatus('submitting')
		try {
			// Trimmed so validation (which trims) and the delivered payload agree.
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
		<form onSubmit={handleSubmit} className={cn('space-y-4', className)} noValidate>
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

			<div>
				<label
					htmlFor="contact-name"
					className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
				>
					Name <span className="text-muted">(optional)</span>
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

			<div>
				<label
					htmlFor="contact-email"
					className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
				>
					Email <span className="text-muted">(optional)</span>
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
					className={cn(
						'w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 dark:bg-gray-700 dark:text-white',
						hasFieldError('email')
							? 'border-red-500 focus:border-red-500 focus:ring-red-500'
							: 'border-gray-300 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600'
					)}
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
					className={cn(
						'w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 dark:bg-gray-700 dark:text-white',
						hasFieldError('message')
							? 'border-red-500 focus:border-red-500 focus:ring-red-500'
							: 'border-gray-300 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600'
					)}
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

			{/* hidden removes it from the a11y tree, tab order and focus, so no aria-hidden is needed. */}
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
				className="w-full rounded-lg bg-blue-600 px-4 py-2 font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
			>
				{isSubmitting ? 'Sending…' : 'Send message'}
			</button>
		</form>
	)
}
