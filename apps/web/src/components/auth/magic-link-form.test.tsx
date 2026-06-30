/**
 * Magic-link login form tests (Story 5-16, Task 5 — AC-5)
 *
 * Accessible passwordless form: a labeled email field, a clear submit/confirm
 * flow, and a GENERIC confirmation that never reveals whether the account exists.
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MagicLinkForm } from './magic-link-form'

const originalFetch = global.fetch

beforeEach(() => {
  global.fetch = vi.fn()
})
afterEach(() => {
  global.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('MagicLinkForm', () => {
  it('renders an accessible, labeled email field and a submit button', () => {
    render(<MagicLinkForm />)
    const input = screen.getByLabelText(/email/i)
    expect(input).toHaveAttribute('type', 'email')
    expect(input).toBeRequired()
    expect(screen.getByRole('button', { name: /sign-in link/i })).toBeInTheDocument()
  })

  it('posts the email and shows a GENERIC confirmation (no account-existence signal)', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    )
    const user = userEvent.setup()
    render(<MagicLinkForm />)

    await user.type(screen.getByLabelText(/email/i), 'user@example.com')
    await user.click(screen.getByRole('button', { name: /sign-in link/i }))

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/auth/login/request',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'user@example.com' }),
      })
    )

    const status = await screen.findByRole('status')
    // Confirmation is conditional ("if an account exists") — no enumeration.
    expect(status).toHaveTextContent(/if an account exists/i)
  })

  it('shows a generic error when the request fails', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('nope', { status: 500 })
    )
    const user = userEvent.setup()
    render(<MagicLinkForm />)

    await user.type(screen.getByLabelText(/email/i), 'user@example.com')
    await user.click(screen.getByRole('button', { name: /sign-in link/i }))

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
  })

  it('renders an initial error (e.g. from an expired-link redirect) as an alert', () => {
    render(<MagicLinkForm initialError="That sign-in link was invalid or has expired." />)
    expect(screen.getByRole('alert')).toHaveTextContent(/invalid or has expired/i)
  })
})
