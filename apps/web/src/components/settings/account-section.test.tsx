import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { purgeLocalFinancialData } = vi.hoisted(() => ({
  purgeLocalFinancialData: vi.fn(),
}))
vi.mock('@/lib/account/purge-local-financial-data', () => ({ purgeLocalFinancialData }))

// Sign-out must be a full document load: a client navigation keeps state seeded
// once from the SSR session (e.g. GlobalNav).
const assign = vi.fn()

vi.mock('@/lib/account/sign-out', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/account/sign-out')>()
  return {
    ...real,
    signOut: vi.fn(real.signOut),
    returnToSignedOutHome: vi.fn(real.returnToSignedOutHome),
  }
})

import { resetSignOutStateForTests, returnToSignedOutHome, signOut } from '@/lib/account/sign-out'
import { expectNoDarkFill } from '@/test/white-fill-tokens'
import { AccountSection } from './account-section'
import { LocalDataSection } from './local-data-section'

const originalFetch = global.fetch

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
  resetSignOutStateForTests()
  // jsdom doesn't implement `location.assign`, so it is replaced rather than spied.
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
    const deleteCache = vi.fn(async () => true)
    vi.stubGlobal('caches', { delete: deleteCache })
    const user = userEvent.setup()
    render(<AccountSection />)

    await user.click(await screen.findByRole('button', { name: /^delete account$/i }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(/cannot be undone/i)

    await user.click(screen.getByTestId('delete-confirm-confirm'))

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/account/delete',
        expect.objectContaining({ method: 'POST' })
      )
    )
    await waitFor(() => expect(purgeLocalFinancialData).toHaveBeenCalledWith('user-42'))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'))
    expect(deleteCache).toHaveBeenCalledTimes(1)
    expect(deleteCache).toHaveBeenCalledWith('app-shell')
    expect(deleteCache.mock.invocationCallOrder[0]).toBeLessThan(assign.mock.invocationCallOrder[0])
    expect(returnToSignedOutHome).toHaveBeenCalledTimes(1)
    expect(signOut).not.toHaveBeenCalled()
  })

  it('signs out through the shared implementation: logout POST, then a document load to /', async () => {
    stubFetch({
      user: { userId: 'user-1', email: 'user@example.com', subscriptionStatus: 'free' },
    })
    const user = userEvent.setup()
    render(<AccountSection />)

    await user.click(await screen.findByRole('button', { name: /^sign out$/i }))

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'))
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('shows a VISIBLE inline error (dialog closed) and does NOT sign out when erasure fails', async () => {
    stubFetch({
      user: { userId: 'user-1', email: 'user@example.com', subscriptionStatus: 'active' },
      deleteOk: false,
    })
    const deleteCache = vi.fn(async () => true)
    vi.stubGlobal('caches', { delete: deleteCache })
    const user = userEvent.setup()
    render(<AccountSection />)

    await user.click(await screen.findByRole('button', { name: /^delete account$/i }))
    await user.click(screen.getByTestId('delete-confirm-confirm'))

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not delete your account/i)
    expect(deleteCache).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(purgeLocalFinancialData).not.toHaveBeenCalled()
    expect(assign).not.toHaveBeenCalled()
  })
})

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
      expect(dialog).toHaveTextContent(/cannot be undone/i)
      expect(dialog).not.toHaveTextContent(/cancelled immediately/i)
    }
  )
})

describe('AccountSection — plan label (Story 70.1)', () => {
  it.each([
    ['active', 'year', 'Annual Plan'],
    ['active', 'month', 'Monthly Plan'],
    ['active', null, 'Active'],
    ['lifetime', null, 'Lifetime Plan'],
    ['past_due', 'year', 'Annual Plan · payment overdue'],
    ['canceled', 'year', 'Cancelled'],
  ])('renders %s + %s as "%s"', async (subscriptionStatus, billingInterval, label) => {
    stubFetch({
      user: { userId: 'u1', email: 'user@example.com', subscriptionStatus, billingInterval },
    })
    render(<AccountSection />)

    expect(await screen.findByText(label)).toBeInTheDocument()
  })

  it('falls back to "Active" when the server omits billingInterval (AC-6 / rolling deploy)', async () => {
    stubFetch({ user: { userId: 'u1', email: 'user@example.com', subscriptionStatus: 'active' } })
    render(<AccountSection />)

    expect(await screen.findByText('Active')).toBeInTheDocument()
  })

  it('no longer renders the raw enum: past_due is not "Past_due" / "past_due"', async () => {
    stubFetch({
      user: {
        userId: 'u1',
        email: 'user@example.com',
        subscriptionStatus: 'past_due',
        billingInterval: null,
      },
    })
    render(<AccountSection />)

    const label = await screen.findByText('Payment overdue')
    expect(screen.queryByText(/past_due/i)).not.toBeInTheDocument()
    expect(label).not.toHaveClass('capitalize')
  })
})

// Asserted by class token, not substring: `/bg-/` would match `hover:bg-gray-100`.
describe('AccountSection — Sign out affordance (Story 70.2)', () => {
  async function renderSignOut() {
    stubFetch({
      user: { userId: 'user-1', email: 'user@example.com', subscriptionStatus: 'free' },
    })
    render(<AccountSection />)
    return screen.findByRole('button', { name: /^sign out$/i })
  }

  it('has a border and a background at rest, in both themes, not only on hover', async () => {
    const signOutButton = await renderSignOut()

    expect(signOutButton).toHaveClass(
      'border',
      'border-gray-500',
      'bg-white',
      'dark:border-gray-500',
      'dark:bg-gray-800'
    )
  })

  it('matches Clear local data, the other secondary button on the page, apart from spacing and in-flight states', async () => {
    const signOutButton = await renderSignOut()
    render(<LocalDataSection />)
    const clearButton = screen.getByRole('button', { name: /^clear local data$/i })

    const comparable = (element: HTMLElement) =>
      element.className
        .split(/\s+/)
        .filter((token) => token !== 'mt-3' && !token.startsWith('disabled:'))
        .sort()
    expect(comparable(signOutButton)).toEqual(comparable(clearButton))
  })

  it('stays subordinate to Delete account: outlined and neutral, never a solid or red fill', async () => {
    const signOutButton = await renderSignOut()
    const tokens = signOutButton.className.split(/\s+/)

    expect(tokens.filter((token) => token.startsWith('bg-'))).toEqual(['bg-white'])
    expect(tokens.filter((token) => token.startsWith('dark:bg-'))).toEqual(['dark:bg-gray-800'])
    expect(tokens.some((token) => /(^|:)bg-red-/.test(token))).toBe(false)
    expect(screen.getByRole('button', { name: /^delete account$/i })).toHaveClass('bg-red-600')
    expectNoDarkFill(screen.getByRole('button', { name: /^delete account$/i }))
  })
})
