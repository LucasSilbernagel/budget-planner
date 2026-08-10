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

/**
 * Theming guards (story 31-1, AC-5/AC-7).
 *
 * The variants mirror `components/contact/contact-form.tsx`, the already-dark
 * twin whose own docblock says it mirrors this form — so the two stay one idiom
 * rather than three. Class-TOKEN membership, never substring.
 *
 * The email input is the load-bearing case: before this story it carried NO
 * `bg-`/`text-` class at all, only `border-gray-300`, so a border-only fix would
 * have left a UA-white field holding dark text on a dark card.
 */
describe('MagicLinkForm theming', () => {
  it('gives the email input a full dark bg/text/border/placeholder set', () => {
    render(<MagicLinkForm />)
    const input = screen.getByLabelText(/email/i)
    const tokens = [...input.classList]

    expect(tokens).toContain('dark:bg-gray-700')
    expect(tokens).toContain('dark:text-gray-100')
    expect(tokens).toContain('dark:border-gray-600')
    // This input HAS a placeholder, unlike contact-form's mirrored name field —
    // an un-themed placeholder is gray-400-on-gray-700 mush in dark mode.
    expect(input).toHaveAttribute('placeholder')
    expect(tokens).toContain('dark:placeholder-gray-400')
    // The focus affordance must survive the swap (AC-7: no ring removed).
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
    // The blue-600 fill is held in BOTH themes on purpose: contact-form's twin
    // drops to blue-500 on dark, which measures 3.68:1 against white text —
    // below AA's 4.5:1 — where blue-600 measures 5.17:1 (story 31-1, AC-7).
    expect(tokens).toContain('bg-blue-600')
    expect(tokens).toContain('hover:bg-blue-700')
    expect(tokens).toContain('text-white')
    // The INVARIANT, not one token: any dark background override reintroduces
    // the AA failure. A code review found `not.toContain('dark:bg-blue-500')`
    // still permitted `dark:bg-blue-400`, `dark:bg-sky-500` and friends.
    expect(tokens.filter((token) => token.startsWith('dark:bg-'))).toEqual([])
    expect(tokens.filter((token) => token.startsWith('dark:hover:bg-'))).toEqual([])
    // AC-7: Tailwind's `--tw-ring-offset-color` defaults to WHITE and nothing
    // overrides it globally, so on the gray-800 `.surface` card this button sits
    // on, a focused button would paint a white band without this.
    expect(tokens).toContain('focus:ring-offset-2')
    expect(tokens).toContain('dark:focus:ring-offset-gray-800')
  })

  it('themes the validation alert', () => {
    render(<MagicLinkForm initialError="Something went wrong." />)
    expect([...screen.getByRole('alert').classList]).toContain('dark:text-red-400')
  })

  /**
   * The success panel replaces the whole form, so it renders on no other test's
   * path — without driving a real submit here its classes are never swept.
   */
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
    // The light values stay put (AC-8).
    expect(tokens).toContain('bg-green-50')
    expect(tokens).toContain('text-green-800')
  })
})
