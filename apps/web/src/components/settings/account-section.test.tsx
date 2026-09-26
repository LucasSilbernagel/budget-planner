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

/**
 * Story 59.3 (AC-7): sign-out lives in ONE shared module, called from here and
 * from the chrome's account menu. The module is WRAPPED, not replaced: every
 * export still runs its real body (so `assign` above still fires), and the
 * spies prove this component reaches it through the shared function rather
 * than a second copy. The same wrap is used in `auth-indicator.test.tsx`.
 */
vi.mock('@/lib/account/sign-out', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/account/sign-out')>()
  return {
    ...real,
    signOut: vi.fn(real.signOut),
    returnToSignedOutHome: vi.fn(real.returnToSignedOutHome),
  }
})

import { resetSignOutStateForTests, returnToSignedOutHome, signOut } from '@/lib/account/sign-out'
import { AccountSection } from './account-section'
import { LocalDataSection } from './local-data-section'

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
  resetSignOutStateForTests()
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
    // The post-deletion exit is the shared document-load helper (story 59.3).
    expect(returnToSignedOutHome).toHaveBeenCalledTimes(1)
    // NOT a second logout POST: the delete endpoint already cleared the session.
    expect(signOut).not.toHaveBeenCalled()
  })

  // Story 59.3 (AC-7). There was no test of this button before: the only
  // assertion was that it rendered.
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

/**
 * Story 70.1 — the Account section names the plan the user bought, from the
 * `/api/auth/me` payload. The label table itself is pinned in
 * `lib/account/plan-label.test.ts`; these prove the component RENDERS it from
 * the payload rather than the raw status enum.
 */
describe('AccountSection — plan label (Story 70.1)', () => {
  it.each([
    ['active', 'year', 'Annual Plan'],
    ['active', 'month', 'Monthly Plan'],
    // AC-6: a row that predates the column — the pre-70.1 text, never blank.
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
    // The CSS `capitalize` that turned it into "Past_due" is gone with it.
    expect(label).not.toHaveClass('capitalize')
  })
})

/**
 * Story 70.2 (FR112) — Sign out has a RESTING affordance: a border and a
 * background with no `hover:` prefix, which is all a touch user ever sees.
 *
 * ⚠️ Asserted by whole class TOKEN (`toHaveClass`), never by a substring of
 * `className`: a regex like `/bg-/` is satisfied by the `hover:bg-gray-100`
 * the button already had, and would pass against the bug.
 *
 * The border is `gray-500` in BOTH themes (review decision, Lucas 2026-09-25):
 * the fill equals the card's, so the border is the only affordance, and it must
 * reach 3:1 against that fill. Measured (WCAG relative luminance): gray-500 on
 * white 4.83, on gray-800 3.04. The first choice, gray-300 / gray-600, measured
 * 1.47 / 1.94. gray-400 on white is still only 2.54.
 */
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

    // Sign out drops Clear local data's `mt-3` (it sits in a flex row) and adds
    // `disabled:` states (sign-out is in flight for a moment). Every other token
    // must be the same, so the two cannot drift apart silently.
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

    // The only resting fills are the card's own: white, and gray-800 in dark.
    expect(tokens.filter((token) => token.startsWith('bg-'))).toEqual(['bg-white'])
    expect(tokens.filter((token) => token.startsWith('dark:bg-'))).toEqual(['dark:bg-gray-800'])
    expect(tokens.some((token) => /(^|:)bg-red-/.test(token))).toBe(false)
    // The comparison is live: Delete account IS the solid red one.
    expect(screen.getByRole('button', { name: /^delete account$/i })).toHaveClass('bg-red-600')
  })
})
