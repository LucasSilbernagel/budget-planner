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

/** Class-token membership, never substring. */
describe('MagicLinkForm theming', () => {
  it('gives the email input a full dark bg/text/border/placeholder set', () => {
    render(<MagicLinkForm />)
    const input = screen.getByLabelText(/email/i)
    const tokens = [...input.classList]

    expect(tokens).toContain('dark:bg-gray-700')
    expect(tokens).toContain('dark:text-gray-100')
    expect(tokens).toContain('dark:border-gray-600')
    expect(input).toHaveAttribute('placeholder')
    expect(tokens).toContain('dark:placeholder-gray-400')
    expect(tokens).toContain('focus:ring-2')
    expect(tokens).toContain('focus:ring-blue-500')
  })

  it('themes the label and the submit button', () => {
    render(<MagicLinkForm />)

    const label = document.querySelector('label[for="login-email"]')
    if (!label) throw new Error('missing label')
    expect([...label.classList]).toContain('dark:text-gray-300')

    const submit = screen.getByRole('button', { name: /sign-in link/i })
    const tokens = [...submit.classList]
    // blue-500 on dark measures 3.68:1 against white (AA needs 4.5:1); blue-600 is 5.17:1.
    expect(tokens).toContain('bg-blue-600')
    expect(tokens).toContain('hover:bg-blue-700')
    expect(tokens).toContain('text-white')
    // The invariant, not one token: any dark background override reintroduces the AA failure.
    expect(tokens.filter((token) => token.startsWith('dark:bg-'))).toEqual([])
    expect(tokens.filter((token) => token.startsWith('dark:hover:bg-'))).toEqual([])
    // Tailwind's ring-offset colour defaults to white, which would band on the gray-800 card.
    expect(tokens).toContain('focus:ring-offset-2')
    expect(tokens).toContain('dark:focus:ring-offset-gray-800')
  })

  it('themes the validation alert', () => {
    render(<MagicLinkForm initialError="Something went wrong." />)
    expect([...screen.getByRole('alert').classList]).toContain('dark:text-red-400')
  })

  /** The success panel replaces the form, so only a real submit reaches its classes. */
  it('themes the post-submit success panel', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    )
    const user = userEvent.setup()
    render(<MagicLinkForm />)

    await user.type(screen.getByLabelText(/email/i), 'user@example.com')
    await user.click(screen.getByRole('button', { name: /sign-in link/i }))

    const panel = await screen.findByRole('status')
    const tokens = [...panel.classList]
    expect(tokens).toContain('dark:border-green-800')
    expect(tokens).toContain('dark:bg-green-900/30')
    expect(tokens).toContain('dark:text-green-300')
    expect(tokens).toContain('bg-green-50')
    expect(tokens).toContain('text-green-800')
  })
})
