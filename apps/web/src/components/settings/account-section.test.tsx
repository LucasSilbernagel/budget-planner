/**
 * AccountSection tests (Story 10-5, AC-4/5)
 *
 * The signed-in account surface on `/settings`:
 *  - the destructive delete control is NEVER shown to unauthenticated visitors
 *    (AC-4, fail-closed);
 *  - an authenticated user gets a themed ConfirmDialog (Story 6-3), NOT a
 *    browser confirm(); confirming POSTs the erasure, purges local financial
 *    data (AC-5) and lands signed-out;
 *  - a failed erasure surfaces an inline error and does NOT sign the user out.
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { navigate, invalidate, purgeLocalFinancialData } = vi.hoisted(() => ({
  navigate: vi.fn(),
  invalidate: vi.fn(),
  purgeLocalFinancialData: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate, invalidate }),
}))
vi.mock('@/lib/account/purge-local-financial-data', () => ({ purgeLocalFinancialData }))

import { AccountSection } from './account-section'

const originalFetch = global.fetch

/** Route `fetch` by URL: /api/auth/me → `user`, POST /api/account/delete → `deleteOk`. */
function stubFetch({ user, deleteOk }: { user: unknown; deleteOk?: boolean }) {
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/auth/me')) {
      return Promise.resolve(new Response(JSON.stringify({ user }), { status: 200 }))
    }
    if (url.includes('/api/account/delete')) {
      return Promise.resolve(
        new Response(JSON.stringify({ success: !!deleteOk }), { status: deleteOk ? 200 : 500 })
      )
    }
    return Promise.resolve(new Response('{}', { status: 200 }))
  }) as typeof global.fetch
}

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => {
  global.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('AccountSection', () => {
  it('renders nothing for an unauthenticated visitor (no delete control) — AC-4', async () => {
    stubFetch({ user: null })
    const { container } = render(<AccountSection />)

    // Give the mount-effect fetch a tick to resolve.
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())

    expect(screen.queryByRole('button', { name: /delete account/i })).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the account + delete control once authenticated', async () => {
    stubFetch({
      user: { userId: 'user-1', email: 'user@example.com', subscriptionStatus: 'active' },
    })
    render(<AccountSection />)

    expect(await screen.findByText('user@example.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^delete account$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument()
  })

  it('confirms via a themed dialog, erases, purges local data (with userId), and signs out — AC-5', async () => {
    stubFetch({
      user: { userId: 'user-42', email: 'user@example.com', subscriptionStatus: 'active' },
      deleteOk: true,
    })
    const user = userEvent.setup()
    render(<AccountSection />)

    await user.click(await screen.findByRole('button', { name: /^delete account$/i }))

    // A themed alertdialog opens (NOT window.confirm).
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(/cannot be undone/i)

    await user.click(screen.getByTestId('delete-confirm-confirm'))

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/account/delete',
        expect.objectContaining({ method: 'POST' })
      )
    )
    // Purge must be scoped to the deleted user so the durable sync queue
    // (bp-sync-queue-<userId>) is cleared too.
    await waitFor(() => expect(purgeLocalFinancialData).toHaveBeenCalledWith('user-42'))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/' }))
  })

  it('shows a VISIBLE inline error (dialog closed) and does NOT sign out when erasure fails', async () => {
    stubFetch({
      user: { userId: 'user-1', email: 'user@example.com', subscriptionStatus: 'active' },
      deleteOk: false,
    })
    const user = userEvent.setup()
    render(<AccountSection />)

    await user.click(await screen.findByRole('button', { name: /^delete account$/i }))
    await user.click(screen.getByTestId('delete-confirm-confirm'))

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not delete your account/i)
    // The dialog must close on failure so the inline error is not occluded by the overlay.
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(purgeLocalFinancialData).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })
})
