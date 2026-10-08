import { render, screen, userEvent, waitFor } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const purgeLocalFinancialData = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('@/lib/account/purge-local-financial-data', () => ({ purgeLocalFinancialData }))

import { LocalDataSection } from '../local-data-section'

const originalFetch = global.fetch

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
    expect(purgeLocalFinancialData).toHaveBeenCalledWith(undefined)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/cleared/i))
  })

  it('confirming purges with the resolved userId for a signed-in user (AC-3)', async () => {
    stubFetch({ user: { userId: 'user-42', email: 'a@b.co', subscriptionStatus: 'active' } })
    const user = userEvent.setup()
    render(<LocalDataSection />)

    await user.click(screen.getByRole('button', { name: /clear local data/i }))
    await screen.findByRole('alertdialog')
    await user.click(screen.getByRole('button', { name: /^clear data$/i }))

    await waitFor(() => expect(purgeLocalFinancialData).toHaveBeenCalledWith('user-42'))
  })
})
