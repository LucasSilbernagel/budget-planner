import { renderWithRouter, screen, within } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SessionSeedProvider } from '../../../context/session-seed'
import { AuthIndicator } from '../../auth/auth-indicator'
import { GlobalNav } from '../GlobalNav'

/**
 * Nav + account row composition (story 19-3).
 *
 * On desktop the primary nav (`GlobalNav`) and the account/sign-in indicator
 * (`AuthIndicator`) share one visual bar, laid out by the `__root.tsx` wrapper
 * (nav leading, indicator trailing); on mobile `GlobalNav` becomes a fixed
 * bottom tab bar while `AuthIndicator` stays a top strip. This test co-renders
 * the two — the way `__root` does — and locks the STRUCTURAL invariant the merge
 * must never break, in BOTH of GlobalNav's `<nav>` branches: the "Sign in"
 * affordance is NEVER a descendant of the single `<nav aria-label="Primary">`
 * landmark, so the nav always holds exactly its eight section links.
 *
 * Why both branches: the GlobalNav suite asserts the nav holds exactly eight
 * links. A future refactor could nest `AuthIndicator`'s `<Link to="/login">`
 * inside `<nav>` to co-locate sign-in — and the most tempting place to do that is
 * the *mobile* bottom bar (the exact "don't crowd the 320px tab bar" trade-off
 * Story 13-2 guards). jsdom has no `matchMedia`, so `useIsNarrowViewport` is
 * mocked here to drive each branch explicitly; without the mock only the desktop
 * branch would ever render and a mobile-only regression would escape.
 *
 * The signed-out state is seeded (SSR seed, story UX-1) so "Sign in" paints
 * synchronously without waiting on the post-mount `/api/auth/me` fetch, which is
 * stubbed to the signed-out shape for good measure.
 */

// Mutable branch selector: false → desktop top-bar <nav>, true → mobile
// fixed-bottom <nav>. Named `mock*` so Vitest permits referencing it inside the
// hoisted `vi.mock` factory. Reset per test in beforeEach (desktop default).
const mockIsNarrow = vi.fn(() => false)
vi.mock('../../../hooks/useIsNarrowViewport', () => ({
  useIsNarrowViewport: () => mockIsNarrow(),
  NARROW_VIEWPORT_MAX_WIDTH: 639.98,
}))

const originalFetch = global.fetch

beforeEach(() => {
  vi.clearAllMocks()
  mockIsNarrow.mockReturnValue(false)
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    if (String(input).includes('/api/auth/me')) {
      return Promise.resolve(new Response(JSON.stringify({ user: null }), { status: 200 }))
    }
    return Promise.resolve(new Response('{}', { status: 200 }))
  }) as typeof global.fetch
})
afterEach(() => {
  global.fetch = originalFetch
  vi.restoreAllMocks()
})

/** Mirror the `__root.tsx` desktop row: nav leading, account indicator trailing. */
function NavAccountRow() {
  return (
    <SessionSeedProvider
      seed={{ isAuthenticated: false, userId: null, email: null, subscriptionStatus: null }}
    >
      <div className="sm:border-b sm:bg-white">
        <div className="sm:mx-auto sm:flex sm:max-w-6xl sm:items-center sm:justify-between">
          <GlobalNav />
          <AuthIndicator />
        </div>
      </div>
    </SessionSeedProvider>
  )
}

describe('Nav + account row (story 19-3)', () => {
  it('keeps exactly one Primary nav landmark holding exactly the eight section links (desktop branch)', async () => {
    renderWithRouter(<NavAccountRow />)

    const navs = await screen.findAllByRole('navigation', { name: /primary/i })
    expect(navs).toHaveLength(1)
    // The Sign-in link must not inflate the nav's link set (story 11-1 / 19-2).
    expect(within(navs[0]).getAllByRole('link')).toHaveLength(8)
  })

  it('renders the "Sign in" affordance OUTSIDE the nav landmark — sibling, not descendant (desktop branch)', async () => {
    renderWithRouter(<NavAccountRow />)

    const nav = await screen.findByRole('navigation', { name: /primary/i })
    const signIn = await screen.findByRole('link', { name: /sign in/i })

    expect(signIn).toHaveAttribute('href', '/login')
    // The invariant: Sign-in lives in the account `status` region, never in <nav>.
    expect(nav.contains(signIn)).toBe(false)
    const status = screen.getByRole('status', { name: /account status/i })
    expect(status.contains(signIn)).toBe(true)
  })

  it('keeps the "Sign in" affordance OUT of the mobile fixed-bottom <nav> too (story 13-2 crowding guard)', async () => {
    // Drive GlobalNav's narrow branch: the fixed bottom tab bar. This is the
    // branch most tempting for a future dev to fold sign-in into (to surface it
    // on mobile), which would push the primary landmark to nine links.
    mockIsNarrow.mockReturnValue(true)
    renderWithRouter(<NavAccountRow />)

    const nav = await screen.findByRole('navigation', { name: /primary/i })
    const signIn = await screen.findByRole('link', { name: /sign in/i })

    // Still exactly the eight sections in the mobile nav — Sign-in is not one of
    // them — and it remains a sibling in the account `status` region.
    expect(within(nav).getAllByRole('link')).toHaveLength(8)
    expect(nav.contains(signIn)).toBe(false)
    const status = screen.getByRole('status', { name: /account status/i })
    expect(status.contains(signIn)).toBe(true)
  })
})
