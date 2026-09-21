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

const { purgeLocalFinancialData } = vi.hoisted(() => ({
  purgeLocalFinancialData: vi.fn(),
}))
vi.mock('@/lib/account/purge-local-financial-data', () => ({ purgeLocalFinancialData }))

/**
 * Sign-out is a FULL DOCUMENT LOAD, not a router navigation (story 58.1 review).
 *
 * ⚠️ This used to mock `useRouter` and assert `navigate({ to: '/' })`. That was
 * changed because a client-side navigation keeps the root route mounted, so every
 * consumer that reads the SSR session seed once as a `useState` initializer keeps
 * its signed-in value — since 58.1 that includes `GlobalNav`, which went on
 * showing a paid user's premium destinations to a session that had just signed
 * out. Asserting the document load is asserting the thing that actually clears
 * that state, so the assertion is on `location.assign`, not on a router spy.
 */
const assign = vi.fn()

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
  // jsdom's `location.assign` is not implemented and logs "Not implemented:
  // navigation" if called for real, so it is replaced rather than spied.
  vi.stubGlobal('location', { ...globalThis.location, assign })
})
afterEach(() => {
  global.fetch = originalFetch
  vi.unstubAllGlobals()
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
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'))
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
    expect(assign).not.toHaveBeenCalled()
  })
})

/**
 * Story 5-19, AC-6 — deletion states the billing consequence plainly.
 *
 * `subscription-api.ts` cancels with `effective_from: 'immediately'`, so an
 * annual subscriber who deletes in month 11 forfeits the rest. The product
 * decision was to KEEP immediate cancellation — scheduling at period end would
 * leave a live Paddle subscription with no `users` row behind it, and the next
 * `subscription.*` webhook would take the first-seen-insert path and RESURRECT
 * the deleted account — and to say so, rather than let it happen silently.
 */
describe('AccountSection — deletion forfeits paid time (5-19 AC-6)', () => {
  it.each(['active', 'past_due', 'lifetime'])(
    'warns a %s subscriber that paid time is forfeited, in both the panel and the dialog',
    async (subscriptionStatus) => {
      stubFetch({ user: { userId: 'u1', email: 'user@example.com', subscriptionStatus } })
      const user = userEvent.setup()
      render(<AccountSection />)

      const panelWarning = await screen.findByText(/remaining paid time is forfeited/i)
      expect(panelWarning).toBeInTheDocument()
      expect(panelWarning).toHaveTextContent(/cancelled immediately/i)
      expect(panelWarning).toHaveTextContent(/will not be refunded/i)

      // The confirmation step — the last point before an irreversible action —
      // must carry it too, not just the panel the user may have scrolled past.
      await user.click(screen.getByRole('button', { name: /^delete account$/i }))
      const dialog = await screen.findByRole('alertdialog')
      expect(dialog).toHaveTextContent(/cancelled immediately/i)
      expect(dialog).toHaveTextContent(/will not be refunded/i)
    }
  )

  it.each(['free', 'canceled'])(
    'does NOT claim a %s user is losing a subscription — there is nothing to forfeit',
    async (subscriptionStatus) => {
      stubFetch({ user: { userId: 'u1', email: 'user@example.com', subscriptionStatus } })
      const user = userEvent.setup()
      render(<AccountSection />)

      expect(await screen.findByText('user@example.com')).toBeInTheDocument()
      expect(screen.queryByText(/remaining paid time is forfeited/i)).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: /^delete account$/i }))
      const dialog = await screen.findByRole('alertdialog')
      // The erasure warning still stands; only the billing sentence is absent.
      expect(dialog).toHaveTextContent(/cannot be undone/i)
      expect(dialog).not.toHaveTextContent(/cancelled immediately/i)
    }
  )
})
