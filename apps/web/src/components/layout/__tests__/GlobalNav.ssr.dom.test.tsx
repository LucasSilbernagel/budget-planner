import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router'
import { act, fireEvent } from '@testing-library/react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'

import { type SessionSeed, SessionSeedProvider } from '@/context/session-seed'
import { GlobalNav } from '../GlobalNav'

/**
 * GlobalNav as the SERVER sends it (story 84.3, FR137).
 *
 * With JavaScript off, the nav is exactly this HTML, and the only way into the
 * More panel is the native `<details>` toggle. These tests replace the e2e
 * JS-off reachability tests (`nav-more-disclosure{,.paid}.spec.ts`): what they
 * pin is that every destination is a real `<a href>` in the server HTML, inside
 * a `<details>` the server renders CLOSED, or (at `lg`) a row anchor. The
 * native toggle opening that `<details>` is the browser's (84.3 D4).
 *
 * `renderToString` runs no effects, so it sees exactly the first paint.
 * ⚠️ `router.load()` first: without it the router emits an unresolved Suspense
 * boundary and every assertion here would pass on empty HTML
 * (`auth-indicator.test.tsx` › `serverRenderAt`).
 */

const SIGNED_OUT: SessionSeed = {
  isAuthenticated: false,
  userId: null,
  email: null,
  subscriptionStatus: null,
}
const ENTITLED: SessionSeed = {
  isAuthenticated: true,
  userId: 'u1',
  email: 'u1@example.test',
  subscriptionStatus: 'active',
}

/** Renders differently on the server and the client: the designed-RED control. */
let renderingOnClient = false
function Mismatch() {
  return renderingOnClient ? <i>client</i> : <b>server</b>
}

async function makeRouter(seed: SessionSeed | null, path: string, withMismatch = false) {
  const rootRoute = createRootRoute({
    component: () => (
      <SessionSeedProvider seed={seed}>
        <GlobalNav />
        {withMismatch && (
          <div>
            <Mismatch />
          </div>
        )}
      </SessionSeedProvider>
    ),
  })
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  await router.load()
  return router
}

/** The server HTML, parsed into a detached container for querying. */
async function serverNav(seed: SessionSeed | null, path = '/') {
  const router = await makeRouter(seed, path)
  const html = renderToString(<RouterProvider router={router} />)
  const container = document.createElement('div')
  container.innerHTML = html
  const nav = container.querySelector('nav[aria-label="Primary"]')
  expect(nav, 'the server HTML has no Primary nav (unresolved router?)').not.toBeNull()
  return { html, nav: nav as HTMLElement }
}

const panelHrefs = (nav: HTMLElement) =>
  [...nav.querySelectorAll('details > ul > li > a')].map((a) => a.getAttribute('href'))

describe('GlobalNav — the server HTML (JavaScript off, story 59.2 AC-4)', () => {
  it('renders the More disclosure CLOSED, with a summary and its panel inside', async () => {
    const { nav } = await serverNav(SIGNED_OUT)
    const details = nav.querySelector('details')
    expect(details, 'no <details> in the server HTML').not.toBeNull()
    expect(details, 'the server rendered the disclosure open').not.toHaveAttribute('open')
    expect(details?.firstElementChild?.tagName, 'the <summary> is not the first child').toBe(
      'SUMMARY'
    )
    expect(
      details?.querySelector(':scope > ul'),
      'the panel is not inside the <details>'
    ).not.toBeNull()
  })

  it('puts every free More destination in the server HTML as a real link inside the disclosure', async () => {
    const { nav } = await serverNav(SIGNED_OUT)
    // + `/settings`, last: the phone-only Settings row (was
    // ['/balance', '/retirement'] until story 96.3).
    expect(panelHrefs(nav)).toEqual(['/balance', '/retirement', '/settings'])
    // Not a React-only control: plain anchors, no button anywhere in the nav.
    expect(nav.querySelectorAll('button')).toHaveLength(0)
  })

  it('also serves Balances and Retirement as lg row anchors (story 69.3)', async () => {
    const { nav } = await serverNav(SIGNED_OUT)
    const rows = [...nav.querySelectorAll(':scope > ul > li[data-nav-promoted] > a')]
    expect(rows.map((a) => a.getAttribute('href'))).toEqual(['/balance', '/retirement'])
    // And no row copy lives inside the disclosure.
    expect(nav.querySelector('details li[data-nav-promoted]')).toBeNull()
  })

  it('serves all six destinations in an entitled session’s panel', async () => {
    const { nav } = await serverNav(ENTITLED)
    expect(panelHrefs(nav)).toEqual([
      '/balance',
      '/retirement',
      '/forecasting',
      '/profiles',
      '/financial-summary',
      '/categories',
      // The phone-only Settings row, last (story 96.3).
      '/settings',
    ])
    expect(nav.querySelector('details')).not.toHaveAttribute('open')
  })

  /**
   * Story 96.3 (FR163, AC 4): with JavaScript off on a phone, every visitor
   * reaches `/settings` through the native More `<details>`. The nav does not
   * read the session for this row, so it is the same for a signed-out, an
   * entitled and an UNVERIFIED (`null` seed) visitor; the last one is the state
   * in which the account cluster renders neither "Sign in" nor a gear.
   * The native toggle and the click are the browser's: the one-off JS-off
   * probe is recorded in the story's Debug Log.
   */
  it.each([
    ['a signed-out', SIGNED_OUT],
    ['an entitled', ENTITLED],
    ['an unverified (null seed)', null],
  ] as const)(
    'serves %s visitor the Settings row as a real link, last in the closed disclosure',
    async (_who, seed) => {
      const { nav } = await serverNav(seed)
      const details = nav.querySelector('details') as HTMLDetailsElement
      expect(details, 'no <details> in the server HTML').not.toBeNull()
      expect(details).not.toHaveAttribute('open')
      const last = details.querySelector(':scope > ul > li:last-child') as HTMLElement
      expect(last, 'the panel has no rows').not.toBeNull()
      const link = last.querySelector(':scope > a')
      expect(link, 'the last row is not a link').not.toBeNull()
      expect(link).toHaveAttribute('href', '/settings')
      expect(link?.textContent).toBe('Settings')
      // Phones only, as a token (jsdom applies no stylesheet).
      expect([...last.classList]).toContain('sm:hidden')
      expect([...last.classList]).not.toContain('max-sm:hidden')
      // The only /settings link in the server nav.
      expect(nav.querySelectorAll('a[href="/settings"]')).toHaveLength(1)
    }
  )
})

describe('GlobalNav — a panel opened BEFORE hydration (story 59.2 AC-5)', () => {
  let cleanup: (() => void) | undefined
  afterEach(() => {
    cleanup?.()
    cleanup = undefined
  })

  /**
   * The server sends the `<details>` closed and the native toggle works before
   * React runs. A user who opens More in that window leaves the DOM `open` while
   * React hydrates `isMoreOpen` as false, and the native `toggle` event has
   * already fired with no handler attached. Only the mount effect's read of the
   * DOM arms Escape and the outside-press listeners. The macrotask wait below is
   * what lets that `toggle` fire BEFORE hydration, as it does in a browser.
   */
  it('is still dismissible with Escape once hydrated', async () => {
    const serverRouter = await makeRouter(SIGNED_OUT, '/')
    const container = document.createElement('div')
    container.innerHTML = renderToString(<RouterProvider router={serverRouter} />)
    document.body.appendChild(container)

    const details = container.querySelector('nav details') as HTMLDetailsElement
    details.open = true
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(details.open, 'the pre-hydration open did not take').toBe(true)

    const clientRouter = await makeRouter(SIGNED_OUT, '/')
    const recoverable: string[] = []
    let root: ReturnType<typeof hydrateRoot> | undefined
    await act(async () => {
      root = hydrateRoot(container, <RouterProvider router={clientRouter} />, {
        onRecoverableError: (error) => recoverable.push(String(error)),
      })
    })
    cleanup = () => {
      act(() => root?.unmount())
      container.remove()
    }
    // Anti-vacuity: React really hydrated this node (it owns it now).
    expect(
      Object.keys(container.querySelector('nav details') as object).some((k) =>
        k.startsWith('__reactFiber')
      ),
      'React never hydrated the <details>'
    ).toBe(true)
    // The adopted `open` is the one attribute mismatch React is told to ignore
    // (`suppressHydrationWarning` on the <details>); nothing else may differ.
    expect(recoverable, `hydration errors: ${recoverable.join(' | ')}`).toEqual([])
    const hydrated = container.querySelector('nav details') as HTMLDetailsElement
    expect(hydrated.open, 'hydration closed a panel the user had opened').toBe(true)

    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    expect(hydrated.open, 'Escape never closed a panel opened before hydration').toBe(false)
  })
})

/**
 * The nav hydrates cleanly for every tier (84.3 code review). The server reads
 * the seed through a `useState` initializer, so the first client render must
 * produce the same anchors; a client-only read of the tier would regenerate the
 * whole nav on every load. Hydrated here directly, with a designed-RED control
 * proving the harness reports a mismatch (React 19 tolerates extra nodes
 * directly under the hydration root, MEASURED, so a control is required).
 */
describe('GlobalNav — hydration', () => {
  async function hydrate(seed: SessionSeed | null, withMismatch: boolean) {
    renderingOnClient = false
    const container = document.createElement('div')
    container.innerHTML = renderToString(
      <RouterProvider router={await makeRouter(seed, '/', withMismatch)} />
    )
    document.body.appendChild(container)
    renderingOnClient = true
    const clientRouter = await makeRouter(seed, '/', withMismatch)
    const recoverable: string[] = []
    let root: ReturnType<typeof hydrateRoot> | undefined
    await act(async () => {
      root = hydrateRoot(container, <RouterProvider router={clientRouter} />, {
        onRecoverableError: (error) => recoverable.push(String(error)),
      })
    })
    renderingOnClient = false
    const anchors = container.querySelectorAll('nav[aria-label="Primary"] a').length
    act(() => root?.unmount())
    container.remove()
    return { recoverable, anchors }
  }

  // 9 / 13 anchors: was 8 / 12 until story 96.3 added the phone-only Settings
  // sheet row, which is session-independent (so the null seed has it too).
  it.each([
    ['a signed-out', SIGNED_OUT, 9],
    ['an entitled', ENTITLED, 13],
    ['an unverified (null seed)', null, 9],
  ] as const)(
    'hydrates %s session’s nav with no recoverable error',
    async (_tier, seed, anchors) => {
      const result = await hydrate(seed, false)
      expect(result.recoverable, `hydration errors: ${result.recoverable.join(' | ')}`).toEqual([])
      expect(result.anchors, 'the hydrated nav lost or gained anchors').toBe(anchors)
    }
  )

  it('reports a mismatch when the server and client trees differ (control)', async () => {
    const result = await hydrate(ENTITLED, true)
    expect(
      result.recoverable.length,
      'the harness cannot see a hydration mismatch'
    ).toBeGreaterThan(0)
  })
})
