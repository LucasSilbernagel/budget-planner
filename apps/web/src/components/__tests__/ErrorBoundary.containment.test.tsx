import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '../ErrorBoundary'

function Exploding({ message }: { message: string }): never {
	throw new Error(message)
}

describe('ErrorBoundary — containment (story 51.1)', () => {
	let consoleError: ReturnType<typeof vi.spyOn>

	beforeEach(() => {
		consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
	})

	afterEach(() => {
		consoleError.mockRestore()
	})

	it('renders its default fallback instead of propagating the throw (AC-18)', () => {
		// console.error having been called proves a throw was actually caught.
		render(
			<ErrorBoundary>
				<Exploding message="a plain rendering failure occurred here" />
			</ErrorBoundary>
		)

		expect(screen.getByRole('alert')).toBeInTheDocument()
		expect(screen.getByText('Something went wrong')).toBeInTheDocument()
		expect(consoleError.mock.calls.length).toBeGreaterThanOrEqual(1)
	})

	it('renders a provided fallback in place of the default (AC-18)', () => {
		render(
			<ErrorBoundary fallback={<p>sync unavailable</p>}>
				<Exploding message="a plain rendering failure occurred here" />
			</ErrorBoundary>
		)

		expect(screen.getByText('sync unavailable')).toBeInTheDocument()
		expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
	})

	it('renders children untouched when nothing throws (the positive control)', () => {
		render(
			<ErrorBoundary>
				<p>the real content</p>
			</ErrorBoundary>
		)

		expect(screen.getByText('the real content')).toBeInTheDocument()
		expect(screen.queryByRole('alert')).not.toBeInTheDocument()
	})

	it('strips file locations and stack fragments out of the displayed message (AC-18)', () => {
		render(
			<ErrorBoundary>
				<Exploding message="database write failed at handleSubmit ( SavingsPage.tsx:1024:17" />
			</ErrorBoundary>
		)

		const details = screen.getByText(/database write failed/)
		expect(details.textContent).not.toMatch(/\.tsx:\d+:\d+/)
		expect(details.textContent).not.toMatch(/at \w+ \(/)
	})

	it('falls back to a generic message when sanitising leaves too little (AC-18)', () => {
		render(
			<ErrorBoundary>
				<Exploding message="at boot (" />
			</ErrorBoundary>
		)

		expect(screen.getByText('An unexpected error occurred')).toBeInTheDocument()
	})
})
