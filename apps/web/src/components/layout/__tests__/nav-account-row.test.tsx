import { renderWithRouter, screen, userEvent, within } from '@/test/utils'
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
 * exactly its seven section links.
 *
 * Why it matters: the GlobalNav suite asserts the nav holds exactly seven links.
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
 * ⚠️ The link counts here STAY 7, and they count DOM PRESENCE, not
 * reachability. Since story 59.2 the three More destinations sit inside a native
 * `<details>` at EVERY width, and a closed `<details>` hides them from a real
 * browser's accessibility tree. jsdom does not: its default stylesheet has no
 * closed-details rule, so `getAllByRole('link')` still resolves all seven.
 * Before 59.2 the reason was that jsdom applies no media queries. The number is
 * the same and the reason is not. "Fixing" these to 4 would turn correct tests
 * red. Which destinations a user can actually reach is a rendered fact, asserted
 * in `e2e/nav-more-disclosure.spec.ts` and `e2e/chrome-320.spec.ts`. (It was
 * EIGHT until story 43.3 removed `/net-worth-projection`; the count tracks the
 * nav.)
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
  it('keeps exactly one Primary nav landmark holding exactly the seven section links', async () => {
    renderWithRouter(<NavAccountRow />)

    const navs = await screen.findAllByRole('navigation', { name: /primary/i })
    expect(navs).toHaveLength(1)
    // The Sign-in link must not inflate the nav's link set (story 11-1 / 19-2).
    expect(within(navs[0]).getAllByRole('link')).toHaveLength(7)
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
    expect(within(nav).getAllByRole('link')).toHaveLength(7)
    expect(nav.contains(signIn)).toBe(false)
    const status = screen.getByRole('status', { name: /account status/i })
    expect(status.contains(signIn)).toBe(true)
  })

  it('keeps the "Sign in" affordance OUT of the mobile "More" sheet too (story 31.5)', async () => {
    renderWithRouter(<NavAccountRow />)

    const nav = await screen.findByRole('navigation', { name: /primary/i })
    const signIn = await screen.findByRole('link', { name: /sign in/i })

    // The 31.5 shape: an outer bar list plus a nested sheet list inside its
    // fifth <li> (inside that cell's `<details>` since story 59.2, at every
    // width). With only five bar slots, the sheet is the new tempting place
    // to fold sign-in into — and it is a nav descendant, so doing so would push
    // the primary landmark to nine links exactly as the bar would.
    const lists = nav.querySelectorAll('ul')
    expect(lists, 'expected the outer bar list and the nested sheet list').toHaveLength(2)
    const sheet = [...lists][1]

    expect(sheet.contains(signIn), 'Sign in was folded into the More sheet').toBe(false)
    expect(
      [...sheet.querySelectorAll('a')].map((a) => a.getAttribute('href')),
      'the More sheet holds something other than its three destinations'
    ).toEqual(['/balance', '/retirement', '/settings'])
  })
})

/**
 * The signed-in row (story 59.3). The account menu is the newest temptation to
 * fold an account affordance into the nav: it is a disclosure, like More, and
 * sits in the same bar. It must stay OUTSIDE `<nav>` (so the landmark still
 * holds exactly its section links) and OUTSIDE the More sheet, and its Sign out
 * must never become a nav row (UX record 2026-09-21, §3: "Do not put Sign out
 * in the More sheet").
 *
 * A FREE signed-in user, so the nav's link count is the same seven as above:
 * an entitled seed would add the four premium destinations and change the
 * number for a reason unrelated to this invariant.
 */
describe('Nav + account row, signed in (story 59.3)', () => {
  const USER = { userId: 'user-1', email: 'user@example.com', subscriptionStatus: 'free' }

  it('keeps the account menu and its Sign out out of the nav and out of the More sheet', async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('/api/auth/me')) {
        return Promise.resolve(new Response(JSON.stringify({ user: USER }), { status: 200 }))
      }
      return Promise.resolve(new Response('{}', { status: 200 }))
    }) as typeof global.fetch
    const user = userEvent.setup()
    renderWithRouter(
      <SessionSeedProvider seed={{ isAuthenticated: true, ...USER }}>
        <div className="sm:mx-auto sm:flex sm:max-w-6xl sm:items-center sm:justify-between">
          <GlobalNav />
          <AuthIndicator />
        </div>
      </SessionSeedProvider>
    )

    const nav = await screen.findByRole('navigation', { name: /primary/i })
    const trigger = await screen.findByRole('button', { name: 'Account menu' })
    await user.click(trigger)
    const signOut = screen.getByRole('button', { name: 'Sign out' })

    expect(nav.contains(trigger), 'the account menu trigger was folded into <nav>').toBe(false)
    expect(nav.contains(signOut), 'Sign out was folded into <nav>').toBe(false)
    // The sheet is a nav descendant, so `nav.contains` above already covers it;
    // this pins the tempting SPECIFIC place (story 31.5's sheet) and fails
    // loudly rather than throwing if the sheet stops being the second <ul>.
    const lists = [...nav.querySelectorAll('ul')]
    expect(lists, 'expected the bar list and the nested More sheet').toHaveLength(2)
    expect(lists[1].contains(signOut), 'Sign out was folded into the More sheet').toBe(false)
    expect(within(nav).getAllByRole('link')).toHaveLength(7)
    // ZERO, and that is the right number. The nav's only control, More, is a
    // `<summary>`, which has NO role in testing-library (story 59.2, measured),
    // so it is not counted. Both account-menu controls are real `<button>`s, so
    // either one inside the nav would make this 1 or 2.
    expect(within(nav).queryAllByRole('button')).toHaveLength(0)

    // And outside the live region: an interactive control there announces
    // spuriously on every navigation.
    const status = screen.getByRole('status', { name: /account status/i })
    expect(status.contains(trigger)).toBe(false)
    expect(status.contains(signOut)).toBe(false)
  })
})
