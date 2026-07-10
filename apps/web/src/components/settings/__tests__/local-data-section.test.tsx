/**
 * LocalDataSection tests (Story 17-2).
 *
 * The all-users "Clear local data" control on `/settings`. Unlike AccountSection
 * (which self-hides for free users and deletes the SERVER account), this renders
 * for EVERYONE and only wipes this device's local storage.
 *
 *  - it is present for a free / unauthenticated user (AC-1);
 *  - clicking opens the themed ConfirmDialog rather than a browser confirm() (AC-2),
 *    and Cancel / dismissal aborts without purging;
 *  - confirming calls `purgeLocalFinancialData` — with `undefined` when there is no
 *    session (free tier has no sync queue) and with the resolved userId when signed
 *    in (AC-3).
 *
 * `purgeLocalFinancialData` is mocked to keep the test on wiring, not the purge
 * internals (those are covered in purge-local-financial-data.test.ts). The session
 * is resolved via a stubbed `fetch('/api/auth/me')`, mirroring AuthIndicator.
 */

import { render, screen, userEvent, waitFor } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const purgeLocalFinancialData = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('@/lib/account/purge-local-financial-data', () => ({ purgeLocalFinancialData }))

import { LocalDataSection } from '../local-data-section'

const originalFetch = global.fetch

/** Route `fetch` by URL: /api/auth/me → `user` (or a network failure). */
function stubFetch({ user, fail }: { user?: unknown; fail?: boolean }) {
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/auth/me')) {
      if (fail) {
        return Promise.reject(new Error('network down'))
      }
      return Promise.resolve(new Response(JSON.stringify({ user }), { status: 200 }))
    }
    return Promise.resolve(new Response('{}', { status: 200 }))
  }) as typeof global.fetch
}

beforeEach(() => {
  vi.clearAllMocks()
  stubFetch({ user: null })
})
afterEach(() => {
  global.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('LocalDataSection', () => {
  it('renders the "Clear local data" control for a free / unauthenticated user (AC-1)', () => {
    render(<LocalDataSection />)
    expect(screen.getByRole('button', { name: /clear local data/i })).toBeInTheDocument()
  })

  it('opens a themed confirmation dialog instead of a browser confirm() (AC-2)', async () => {
    const user = userEvent.setup()
    render(<LocalDataSection />)

    // No dialog before interaction.
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /clear local data/i }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /clear local data\?/i })).toBeInTheDocument()
    expect(screen.getByText(/permanently|cannot be undone/i)).toBeInTheDocument()
  })

  it('Cancel closes the dialog WITHOUT purging (AC-2)', async () => {
    const user = userEvent.setup()
    render(<LocalDataSection />)

    await user.click(screen.getByRole('button', { name: /clear local data/i }))
    await screen.findByRole('alertdialog')
    await user.click(screen.getByRole('button', { name: /cancel/i }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(purgeLocalFinancialData).not.toHaveBeenCalled()
  })

  it('confirming purges with undefined for an unauthenticated user (AC-3)', async () => {
    const user = userEvent.setup()
    render(<LocalDataSection />)

    await user.click(screen.getByRole('button', { name: /clear local data/i }))
    await screen.findByRole('alertdialog')
    await user.click(screen.getByRole('button', { name: /^clear data$/i }))

    await waitFor(() => expect(purgeLocalFinancialData).toHaveBeenCalledTimes(1))
    // userId is resolved at confirm time; no session → undefined → queue skipped.
    expect(purgeLocalFinancialData).toHaveBeenCalledWith(undefined)
    // Feedback confirms the wipe (the /settings surface shows no financial data).
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/cleared/i))
  })

  it('confirming purges with the resolved userId for a signed-in user (AC-3)', async () => {
    stubFetch({ user: { userId: 'user-42', email: 'a@b.co', subscriptionStatus: 'active' } })
    const user = userEvent.setup()
    render(<LocalDataSection />)

    await user.click(screen.getByRole('button', { name: /clear local data/i }))
    await screen.findByRole('alertdialog')
    await user.click(screen.getByRole('button', { name: /^clear data$/i }))

    // Resolved at CONFIRM time (no mount-time prefetch), so a signed-in user who
    // confirms immediately still passes the real userId — the reviewed race is gone.
    await waitFor(() => expect(purgeLocalFinancialData).toHaveBeenCalledWith('user-42'))
  })
})
