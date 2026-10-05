import { act, fireEvent, renderWithRouter, screen, userEvent, waitFor, within } from '@/test/utils'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  SIGNED_OUT_SEED,
  type SessionSeed,
  SessionSeedProvider,
} from '../../../context/session-seed'
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
 * exactly its six section links (seven until story 69.2 moved Settings into
 * the account cluster).
 *
 * Why it matters: the GlobalNav suite asserts the nav holds exactly six links.
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
 * ⚠️ The link counts here are 9 since story 96.3 (6 destinations + the two
 * promoted row copies, `hidden lg:block`, story 69.3, + the phone-only
 * Settings sheet row, `sm:hidden`; 8 until 96.3), and they count DOM PRESENCE, not
 * reachability. Since story 59.2 the More destinations sit inside a native
 * `<details>` at EVERY width, and a closed `<details>` hides them from a real
 * browser's accessibility tree. jsdom does not: its default stylesheet has no
 * closed-details rule, so `getAllByRole('link')` still resolves all six.
 * Before 59.2 the reason was that jsdom applies no media queries. The number is
 * the same and the reason is not. "Fixing" these to 4 would turn correct tests
 * red. Which destinations a user can actually reach is a rendered fact; since
 * stories 84.2/84.3 only the screenshots and the server HTML
 * (`GlobalNav.ssr.dom.test.tsx`) pin it. (It was
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
  it('keeps exactly one Primary nav landmark holding exactly the six section links', async () => {
    renderWithRouter(<NavAccountRow />)

    const navs = await screen.findAllByRole('navigation', { name: /primary/i })
    expect(navs).toHaveLength(1)
    // The Sign-in link must not inflate the nav's link set (story 11-1 / 19-2).
    // Nine DOM anchors: six destinations + the two promoted row copies (story
    // 69.3) + the phone-only Settings row (story 96.3; eight until then), which
    // jsdom sees because it applies no stylesheet.
    expect(within(navs[0]).getAllByRole('link')).toHaveLength(9)
  })

  // Story 69.2 (FR109). The same invariant, the other way round: Settings moved
  // OUT of the nav into this row. A signed-out visitor's route to it is the
  // gear link beside "Sign in", which is a sibling of the live region (it is
  // navigation), not inside it and not inside <nav>.
  // ⚠️ AMENDED by story 96.3 (FR163): that is the >= 640px route. Below 640px
  // the nav's More sheet holds Settings (last, `sm:hidden`) and the gear is
  // `max-sm:hidden`. The nav's /settings link is therefore expected, and must be
  // exactly that phone-only sheet row (the per-width rule: see the complement
  // test at the bottom of this file).
  it('puts the signed-out Settings gear in the account row, outside the nav and the live region', async () => {
    const { container } = renderWithRouter(<NavAccountRow />)

    const nav = await screen.findByRole('navigation', { name: /primary/i })
    await screen.findByRole('link', { name: /sign in/i })
    const row = container.querySelector('[data-auth-indicator]') as HTMLElement
    expect(row, 'the account row did not render').not.toBeNull()
    const gear = within(row).getByRole('link', { name: 'Settings' })

    expect(gear).toHaveAttribute('href', '/settings')
    expect(nav.contains(gear), 'the Settings gear was folded into <nav>').toBe(false)
    expect([...gear.classList], 'the gear shows on a phone too').toContain('max-sm:hidden')
    const navSettings = nav.querySelectorAll('a[href="/settings"]')
    expect(navSettings, 'the nav holds more than its phone-only Settings row').toHaveLength(1)
    const navRow = navSettings[0]?.closest('li') as HTMLElement
    expect(
      navRow.closest('details > ul'),
      'the nav Settings link is not a sheet row'
    ).not.toBeNull()
    expect([...navRow.classList], 'the nav Settings row shows at >= 640px').toContain('sm:hidden')
    const status = screen.getByRole('status', { name: /account status/i })
    expect(status.contains(gear), 'the Settings gear is inside the live region').toBe(false)
    expect(gear.closest('[data-auth-indicator]')).not.toBeNull()
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
    // 6 destinations + 2 promoted row copies (story 69.3) + the Settings row
    // (story 96.3; 8 until then).
    expect(within(nav).getAllByRole('link')).toHaveLength(9)
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
      'the More sheet holds something other than its two destinations and Settings'
      // + the phone-only Settings row, last (story 96.3).
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
 * A FREE signed-in user, so the nav's link count is the same six as above:
 * an entitled seed would add the four premium destinations and change the
 * number for a reason unrelated to this invariant.
 */
describe('Nav + account row, signed in (story 59.3)', () => {
  const USER = { userId: 'user-1', email: 'user@example.com', subscriptionStatus: 'free' as const }

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
    // Story 69.2: the panel's Settings link is the signed-in route to /settings
    // (at >= 640px since story 96.3). Scoped to the panel: the nav's phone-only
    // Settings sheet row has the same name.
    const accountPanel = signOut.parentElement as HTMLElement
    const settings = within(accountPanel).getByRole('link', { name: 'Settings' })

    expect(nav.contains(trigger), 'the account menu trigger was folded into <nav>').toBe(false)
    expect(nav.contains(settings), 'the menu’s Settings link was folded into <nav>').toBe(false)
    expect(nav.contains(signOut), 'Sign out was folded into <nav>').toBe(false)
    // The sheet is a nav descendant, so `nav.contains` above already covers it;
    // this pins the tempting SPECIFIC place (story 31.5's sheet) and fails
    // loudly rather than throwing if the sheet stops being the second <ul>.
    const lists = [...nav.querySelectorAll('ul')]
    expect(lists, 'expected the bar list and the nested More sheet').toHaveLength(2)
    expect(lists[1].contains(signOut), 'Sign out was folded into the More sheet').toBe(false)
    // 6 destinations + 2 promoted row copies (story 69.3) + the Settings row
    // (story 96.3; 8 until then).
    expect(within(nav).getAllByRole('link')).toHaveLength(9)
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
    expect(status.contains(settings)).toBe(false)
    // No gear for a signed-in user: the menu is their route, so the cluster
    // holds exactly one link to /settings (the one inside the open panel).
    // ⚠️ TWO in the document since story 96.3 (was exactly one): that panel row,
    // `max-sm:hidden`, and the nav's phone-only sheet row, `sm:hidden`. A
    // real browser renders exactly one of them at any width.
    const all = [...document.querySelectorAll('a[href="/settings"]')]
    expect(all).toHaveLength(2)
    expect(all).toContain(settings)
    expect([...settings.classList]).toContain('max-sm:hidden')
    const navRow = all.find((a) => nav.contains(a))?.closest('li') as HTMLElement
    expect(navRow, 'the nav has no Settings row').toBeTruthy()
    expect([...navRow.classList]).toContain('sm:hidden')
  })
})

/**
 * Two disclosures, one bar (UX record 2026-09-21, §5.4; story 84.3 moved this
 * here from `e2e/account-menu{,.paid}.spec.ts`). Each closes the other when the
 * user PRESSES the other's trigger, in both orders, and focus lands on what was
 * pressed. Each disclosure's own outside-press rule is what does it: the other
 * trigger is outside it. Width was a variable only in the browser (which
 * trigger is visible); the rule below is the same at every width.
 */
describe('Nav + account row, two disclosures (story 59.3)', () => {
  const FREE_USER = { userId: 'user-1', email: 'user@example.com', subscriptionStatus: 'free' }

  function renderSignedIn(subscriptionStatus: 'free' | 'active') {
    const user = { ...FREE_USER, subscriptionStatus }
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('/api/auth/me')) {
        return Promise.resolve(new Response(JSON.stringify({ user }), { status: 200 }))
      }
      return Promise.resolve(new Response('{}', { status: 200 }))
    }) as typeof global.fetch
    renderWithRouter(
      <SessionSeedProvider seed={{ isAuthenticated: true, ...user }}>
        <div className="sm:mx-auto sm:flex sm:max-w-6xl sm:items-center sm:justify-between">
          <GlobalNav />
          <AuthIndicator />
        </div>
      </SessionSeedProvider>
    )
  }

  /**
   * A mouse press on the More `<summary>`, as a browser delivers it.
   * ⚠️ user-event does not move focus to a `<summary>` on mousedown (its
   * focusable set omits it; a browser focuses it), so `user.click(summary)`
   * leaves focus where it was and the press is not the one a user makes. The
   * browser order is reproduced by hand: pointerdown, focus, pointerup, click.
   */
  const pressSummary = async () => {
    const { summary } = more()
    await act(async () => {
      fireEvent.pointerDown(summary)
      fireEvent.mouseDown(summary)
      summary.focus()
      fireEvent.pointerUp(summary)
      fireEvent.mouseUp(summary)
      fireEvent.click(summary)
    })
  }

  const more = () => {
    const nav = screen.getByRole('navigation', { name: /primary/i })
    return {
      details: nav.querySelector('details') as HTMLDetailsElement,
      summary: nav.querySelector('details > summary') as HTMLElement,
      panel: nav.querySelector('details > ul') as HTMLElement,
    }
  }

  it('pressing one trigger closes the other, in both orders, and focus lands on the pressed one', async () => {
    renderSignedIn('free')
    const user = userEvent.setup()
    const trigger = await screen.findByRole('button', { name: 'Account menu' })

    // Nav More open -> press the account trigger.
    await pressSummary()
    await waitFor(() => expect(more().details.open).toBe(true))
    await user.click(trigger)
    await waitFor(() => expect(more().details.open, 'More stayed open').toBe(false))
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(trigger).toHaveFocus()

    // Account menu open -> press More.
    await pressSummary()
    await waitFor(() =>
      expect(trigger, 'the account menu stayed open').toHaveAttribute('aria-expanded', 'false')
    )
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
    await waitFor(() => expect(more().details.open, 'More did not open').toBe(true))
    expect(more().summary).toHaveFocus()
  })

  /**
   * Accepted, not a defect (story 59.2 review): a keyboard user can Tab past the
   * open nav panel, so no pointer event tells the nav the account menu opened.
   * Both are then open, and ONE Escape must close both without a focus fight.
   * No pointer events here: `fireEvent.click` and Enter on a button are what a
   * keyboard produces.
   */
  it('by keyboard both can be open at once, and ONE Escape closes both with focus on the account trigger', async () => {
    renderSignedIn('free')
    const user = userEvent.setup()
    const trigger = await screen.findByRole('button', { name: 'Account menu' })

    fireEvent.click(more().summary)
    await waitFor(() => expect(more().details.open).toBe(true))
    trigger.focus()
    await user.keyboard('{Enter}')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(more().details.open, 'the keyboard case this test is about did not arise').toBe(true)

    await user.keyboard('{Escape}')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await waitFor(() => expect(more().details.open, 'More stayed open after Escape').toBe(false))
    expect(trigger, 'the nav yanked focus to More').toHaveFocus()
  })

  it('a paid user’s four premium routes stay one press away with the account menu open', async () => {
    renderSignedIn('active')
    const user = userEvent.setup()
    const trigger = await screen.findByRole('button', { name: 'Account menu' })

    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await pressSummary()
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'))
    await waitFor(() => expect(more().details.open).toBe(true))

    for (const [label, href] of [
      ['Forecasting', '/forecasting'],
      ['Profiles', '/profiles'],
      ['Report', '/report'],
      ['Categories', '/categories'],
    ] as const) {
      const link = within(more().panel).getByRole('link', { name: label })
      expect(link, `${label} is not reachable in the open panel`).toBeVisible()
      expect(link).toHaveAttribute('href', href)
    }
  })
})

/**
 * Story 96.3 (FR163): per width, a visitor has ONE place for Settings.
 *
 * Below 640px it is the nav's More sheet (last row, `sm:hidden` on its `<li>`);
 * at 640px and up it is the account cluster (the gear, the `<noscript>` gear,
 * the account menu's row, each `max-sm:hidden`). jsdom applies no stylesheet,
 * so it sees every route at once: the rule can only be pinned here as
 * COMPLEMENTARY TOKENS, by `classList` membership (`max-sm:hidden` contains
 * `sm:hidden` as a substring). Which one a browser actually paints is asserted
 * in the 320px screenshot tests before their shots.
 *
 * The `<noscript>` gear is collected from the SERVER HTML: React 19 renders
 * `<noscript>` children on the server only (measured at 69.3), so a client
 * render leaves it empty.
 */
describe('Nav + account row, the per-width Settings route (story 96.3)', () => {
  const FREE = { userId: 'user-1', email: 'user@example.com', subscriptionStatus: 'free' as const }
  const PAID = { ...FREE, subscriptionStatus: 'active' as const }
  type Me = { userId: string; email: string; subscriptionStatus: 'free' | 'active' }

  function stubMe(user: Me | null | 'pending') {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('/api/auth/me')) {
        if (user === 'pending') return new Promise<Response>(() => {})
        return Promise.resolve(new Response(JSON.stringify({ user }), { status: 200 }))
      }
      return Promise.resolve(new Response('{}', { status: 200 }))
    }) as typeof global.fetch
  }

  function Row({ seed }: { seed: SessionSeed | null }) {
    return (
      <SessionSeedProvider seed={seed}>
        <div className="sm:mx-auto sm:flex sm:max-w-6xl sm:items-center sm:justify-between">
          <GlobalNav />
          <AuthIndicator />
        </div>
      </SessionSeedProvider>
    )
  }

  /** The `/settings` anchors inside the SERVER HTML's `<noscript>` elements. */
  async function serverNoscriptRoutes(seed: SessionSeed | null, path: string) {
    const router = createRouter({
      routeTree: createRootRoute({ component: () => <Row seed={seed} /> }),
      history: createMemoryHistory({ initialEntries: [path] }),
    })
    await router.load()
    const html = renderToString(<RouterProvider router={router} />)
    expect(html, 'the server HTML has no nav (unresolved router?)').toContain(
      'aria-label="Primary"'
    )
    const routes: Element[] = []
    for (const match of html.matchAll(/<noscript>([\s\S]*?)<\/noscript>/g)) {
      const template = document.createElement('template')
      template.innerHTML = match[1] as string
      routes.push(...template.content.querySelectorAll('a[href="/settings"]'))
    }
    return routes
  }

  /** Where a route's width classes live: the nav row's `<li>`, else the link itself. */
  const widthScope = (a: Element): Element => a.closest('li[data-nav-settings]') ?? a
  const has = (el: Element, token: string) => el.classList.contains(token)

  const CASES: readonly {
    name: string
    seed: SessionSeed | null
    me: Me | null | 'pending'
    path: string
    openPanel: boolean
    desktopRoute: boolean
  }[] = [
    {
      name: 'signed out',
      seed: SIGNED_OUT_SEED,
      me: null,
      path: '/',
      openPanel: false,
      desktopRoute: true,
    },
    // /login keeps its empty strip (69.2 D3): no >= 640px route there.
    {
      name: 'signed out on /login',
      seed: SIGNED_OUT_SEED,
      me: null,
      path: '/login',
      openPanel: false,
      desktopRoute: false,
    },
    {
      name: 'signed in, free (panel open)',
      seed: { isAuthenticated: true, ...FREE },
      me: FREE,
      path: '/',
      openPanel: true,
      desktopRoute: true,
    },
    {
      name: 'signed in, entitled (panel open)',
      seed: { isAuthenticated: true, ...PAID },
      me: PAID,
      path: '/',
      openPanel: true,
      desktopRoute: true,
    },
    // Unverified seed, session still loading: the cluster renders no route.
    {
      name: 'a null seed, loading',
      seed: null,
      me: 'pending',
      path: '/',
      openPanel: false,
      desktopRoute: false,
    },
  ]

  it.each(CASES)(
    'a phone has exactly one Settings route and a desktop keeps its own: $name',
    async ({ seed, me, path, openPanel, desktopRoute }) => {
      stubMe(me)
      renderWithRouter(<Row seed={seed} />, { path })
      const nav = await screen.findByRole('navigation', { name: /primary/i })
      if (openPanel) {
        await userEvent.setup().click(await screen.findByRole('button', { name: 'Account menu' }))
        // Positive control: the panel really opened (Sign out is in it).
        expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
      } else if (me === null && path === '/') {
        // Positive control: the signed-out cluster really rendered.
        await screen.findByRole('link', { name: /sign in/i })
      } else {
        await screen.findByRole('status', { name: /account status/i })
      }

      const routes = [
        ...document.querySelectorAll('a[href="/settings"]'),
        ...(seed?.isAuthenticated ? await serverNoscriptRoutes(seed, path) : []),
      ]
      const phone = routes.filter((a) => has(widthScope(a), 'sm:hidden'))
      const desktop = routes.filter((a) => has(widthScope(a), 'max-sm:hidden'))

      // Neither, or both, is the defect. Exactly one phone route...
      expect(phone, 'a phone has no Settings route, or more than one').toHaveLength(1)
      expect(nav.contains(phone[0] as Node), 'the phone route is not the nav row').toBe(true)
      // ...and every other route is a >= 640px one, never shown on a phone.
      for (const a of routes) {
        if (a === phone[0]) continue
        expect(
          desktop.includes(a),
          `a /settings route outside the nav shows on a phone: ${a.outerHTML}`
        ).toBe(true)
        expect(has(widthScope(a), 'sm:hidden'), 'a route carries both tokens').toBe(false)
      }
      expect(desktop.length > 0, 'the >= 640px route set is wrong for this session').toBe(
        desktopRoute
      )
      if (seed?.isAuthenticated) {
        // Both signed-in >= 640px routes: the open panel's row and the JS-off gear.
        expect(desktop).toHaveLength(2)
      }
    }
  )
})
