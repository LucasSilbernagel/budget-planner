import { renderWithRouter, screen, within } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SessionSeedProvider } from '../../../context/session-seed'
import { AuthIndicator } from '../../auth/auth-indicator'
import { GlobalNav } from '../GlobalNav'

/**
 * Nav + account row composition (story 19-3; updated for the 31.4 CSS switch).
 *
 * On desktop the primary nav (`GlobalNav`) and the account/sign-in indicator
 * (`AuthIndicator`) share one visual bar, laid out by the `__root.tsx` wrapper
 * (nav leading, indicator trailing); below `sm` `GlobalNav` becomes a fixed
 * bottom tab bar while `AuthIndicator` stays a top strip. This test co-renders
 * the two — the way `__root` does — and locks the STRUCTURAL invariant that
 * composition must never break: the "Sign in" affordance is NEVER a descendant
 * of the single `<nav aria-label="Primary">` landmark, so the nav always holds
 * exactly its eight section links.
 *
 * Why it matters: the GlobalNav suite asserts the nav holds exactly eight links.
 * A future refactor could nest `AuthIndicator`'s `<Link to="/login">` inside
 * `<nav>` to co-locate sign-in — and the most tempting place to do that is the
 * *mobile* bottom bar (the exact "don't crowd the 320px tab bar" trade-off Story
 * 13-2 guards).
 *
 * ⚠️ Story 31.5 makes that temptation strictly WORSE, and adds a second place to
 * yield to it. The bar now has only FIVE slots — four destinations and a "More"
 * trigger — so "there is no room, put Sign in behind More" is the natural next
 * thought. The sheet is a nav descendant like any other, so folding sign-in into
 * it would break this same invariant just as thoroughly as folding it into the
 * bar. Both are asserted below.
 *
 * ⚠️ The link counts here STAY 8. jsdom applies no media queries, so all eight
 * anchors resolve regardless of which four sit behind the More trigger in a real
 * browser; "fixing" these to 5 would turn correct tests red. Which four are in
 * the bar is a rendered fact, asserted in `e2e/chrome-320.spec.ts`.
 *
 * ⚠️ Since 31.4 there is no `useIsNarrowViewport` branch to mock: one DOM
 * subtree carries both layouts, switched by `max-sm:` utilities. Mocking the
 * hook here would select nothing, and re-asserting the link count on a second
 * render would be a byte-for-byte duplicate of the two tests above it. The third
 * test therefore pins the mobile claim the other two cannot make — that the nav
 * excluding Sign-in is the SAME element that becomes the fixed bottom bar.
 *
 * The signed-out state is seeded (SSR seed, story UX-1) so "Sign in" paints
 * synchronously without waiting on the post-mount `/api/auth/me` fetch, which is
 * stubbed to the signed-out shape for good measure.
 */

const originalFetch = global.fetch

beforeEach(() => {
  vi.clearAllMocks()
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
  it('keeps exactly one Primary nav landmark holding exactly the eight section links', async () => {
    renderWithRouter(<NavAccountRow />)

    const navs = await screen.findAllByRole('navigation', { name: /primary/i })
    expect(navs).toHaveLength(1)
    // The Sign-in link must not inflate the nav's link set (story 11-1 / 19-2).
    expect(within(navs[0]).getAllByRole('link')).toHaveLength(8)
  })

  it('renders the "Sign in" affordance OUTSIDE the nav landmark — sibling, not descendant', async () => {
    renderWithRouter(<NavAccountRow />)

    const nav = await screen.findByRole('navigation', { name: /primary/i })
    const signIn = await screen.findByRole('link', { name: /sign in/i })

    expect(signIn).toHaveAttribute('href', '/login')
    // The invariant: Sign-in lives in the account `status` region, never in <nav>.
    expect(nav.contains(signIn)).toBe(false)
    const status = screen.getByRole('status', { name: /account status/i })
    expect(status.contains(signIn)).toBe(true)
  })

  it('keeps the "Sign in" affordance OUT of the element that BECOMES the mobile fixed-bottom bar (story 13-2 crowding guard)', async () => {
    renderWithRouter(<NavAccountRow />)

    const nav = await screen.findByRole('navigation', { name: /primary/i })
    const signIn = await screen.findByRole('link', { name: /sign in/i })

    // The claim the two tests above cannot make: the landmark that excludes
    // Sign-in is the SAME element that becomes the fixed bottom tab bar below
    // `sm` — the layout a future dev is most tempted to fold sign-in into, which
    // would push the primary landmark to nine links. Before 31.4 this was a
    // separate `useIsNarrowViewport` branch reached by mocking the hook; now the
    // bottom bar IS this element, so pinning `max-sm:fixed` on it is what keeps
    // the guard about mobile rather than a duplicate of the desktop assertions.
    expect(nav.className.split(/\s+/), 'this nav is not the mobile bottom bar').toContain(
      'max-sm:fixed'
    )
    expect(within(nav).getAllByRole('link')).toHaveLength(8)
    expect(nav.contains(signIn)).toBe(false)
    const status = screen.getByRole('status', { name: /account status/i })
    expect(status.contains(signIn)).toBe(true)
  })

  it('keeps the "Sign in" affordance OUT of the mobile "More" sheet too (story 31.5)', async () => {
    renderWithRouter(<NavAccountRow />)

    const nav = await screen.findByRole('navigation', { name: /primary/i })
    const signIn = await screen.findByRole('link', { name: /sign in/i })

    // The 31.5 shape: an outer bar list plus a nested sheet list inside its
    // fifth <li>. With only five bar slots, the sheet is the new tempting place
    // to fold sign-in into — and it is a nav descendant, so doing so would push
    // the primary landmark to nine links exactly as the bar would.
    const lists = nav.querySelectorAll('ul')
    expect(lists, 'expected the outer bar list and the nested sheet list').toHaveLength(2)
    const sheet = [...lists][1]

    expect(sheet.contains(signIn), 'Sign in was folded into the More sheet').toBe(false)
    expect(
      [...sheet.querySelectorAll('a')].map((a) => a.getAttribute('href')),
      'the More sheet holds something other than its four destinations'
    ).toEqual(['/balance', '/net-worth-projection', '/retirement', '/settings'])
  })
})
