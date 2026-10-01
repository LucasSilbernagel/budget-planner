import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router'
import { act } from '@testing-library/react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type SessionSeed, SessionSeedProvider } from '../../../context/session-seed'
import { AuthIndicator } from '../auth-indicator'

/**
 * The account cluster as the SERVER sends it (story 84.3, FR137).
 *
 * Replaces the e2e tests that loaded pages with JavaScript off
 * (`settings-route{,.paid}.spec.ts`) or read the raw response
 * (`account-menu.paid.spec.ts` › "the SSR seed paints the account trigger in
 * the first frame"). With JavaScript off, the chrome IS this HTML, so the
 * claim is that the route to `/settings` and the collapsed account trigger
 * are in it. How the server resolves the seed (the root loader) is the
 * server's half and is not claimed here.
 *
 * ⚠️ `router.load()` before `renderToString`, or the router emits an
 * unresolved Suspense boundary and every assertion passes on nothing.
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
  email: 'e2e-paid@example.test',
  subscriptionStatus: 'active',
}

/** Renders differently on the server and the client: the designed-RED control. */
let renderingOnClient = false
function Mismatch() {
  return renderingOnClient ? <i>client</i> : <b>server</b>
}

async function makeRouter(seed: SessionSeed, path: string, withMismatch = false) {
  const rootRoute = createRootRoute({
    component: () => (
      <SessionSeedProvider seed={seed}>
        <AuthIndicator />
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

async function serverHtml(seed: SessionSeed, path: string) {
  const html = renderToString(<RouterProvider router={await makeRouter(seed, path)} />)
  const container = document.createElement('div')
  container.innerHTML = html
  const row = container.querySelector('[data-auth-indicator]')
  expect(row, 'the server HTML has no account row (unresolved router?)').not.toBeNull()
  return { html, row: row as HTMLElement }
}

beforeEach(() => {
  // The post-mount session fetch is never reached by `renderToString`; the
  // hydration test holds it open so the seeded state is what hydrates.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => {}))
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AuthIndicator — server HTML, signed out (story 69.2, JS off)', () => {
  it.each(['/', '/income'])(
    'serves the Settings gear on %s as a real link outside the live region',
    async (path) => {
      const { row } = await serverHtml(SIGNED_OUT, path)
      const gear = row.querySelectorAll('a[href="/settings"]')
      expect(gear, `no server-rendered gear on ${path}`).toHaveLength(1)
      expect(gear[0]).toHaveAttribute('aria-label', 'Settings')
      expect(row.querySelector('[role="status"]')?.contains(gear[0] as Node)).toBe(false)
      // Not wrapped in <noscript>: this is the live link, for every visitor.
      expect(gear[0]?.closest('noscript')).toBeNull()
    }
  )
})

describe('AuthIndicator — server HTML on /login (story 69.2 D3)', () => {
  it('serves no gear on /login, while / serves one (contrast)', async () => {
    const { row: onHome } = await serverHtml(SIGNED_OUT, '/')
    expect(onHome.querySelectorAll('a[href="/settings"]')).toHaveLength(1)
    const { row: onLogin } = await serverHtml(SIGNED_OUT, '/login')
    expect(
      onLogin.querySelector('a[href="/settings"]'),
      'the server sent a gear on /login'
    ).toBeNull()
  })
})

describe('AuthIndicator — server HTML, signed in (stories 59.3, 69.3)', () => {
  it('paints the account trigger collapsed in the first frame, with no panel', async () => {
    const { html, row } = await serverHtml(ENTITLED, '/')
    const trigger = row.querySelector('button[aria-label="Account menu"]')
    expect(trigger, 'the trigger is not in the server HTML').not.toBeNull()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    // No dangling IDREF while closed, and the panel is not rendered.
    expect(trigger).not.toHaveAttribute('aria-controls')
    expect(html).not.toContain('Sign out')
    // The seeded identity is announced from the first frame.
    expect(row.querySelector('[role="status"]')?.textContent).toContain('e2e-paid@example.test')
  })

  /**
   * React 19 renders `<noscript>` children on the SERVER only (measured at
   * 69.3); a client render leaves it empty. So this server render is where the
   * JS-off route lives. In a parsed DOM the `<noscript>` content is TEXT when
   * scripting is enabled, so the check is on the HTML string, scoped to the
   * `<noscript>` element.
   */
  it('serves a signed-in visitor’s JS-off Settings gear inside <noscript>', async () => {
    const { html } = await serverHtml(ENTITLED, '/income')
    const noscripts = html.match(/<noscript>[\s\S]*?<\/noscript>/g) ?? []
    expect(noscripts, 'expected exactly one <noscript> in the cluster').toHaveLength(1)
    expect(noscripts[0]).toMatch(/<a [^>]*href="\/settings"/)
    expect(noscripts[0]).toMatch(/aria-label="Settings"/)
    // And no live /settings link outside it while the menu is closed.
    expect(html.replace(noscripts[0] as string, '')).not.toContain('href="/settings"')
  })
})

/**
 * Server-render the signed-in cluster, then hydrate it, collecting every
 * recoverable error and every console hydration report.
 */
async function hydrateSignedIn(withMismatch: boolean) {
  renderingOnClient = false
  const container = document.createElement('div')
  container.innerHTML = renderToString(
    <RouterProvider router={await makeRouter(ENTITLED, '/income', withMismatch)} />
  )
  document.body.appendChild(container)
  renderingOnClient = true
  const clientRouter = await makeRouter(ENTITLED, '/income', withMismatch)

  const recoverable: string[] = []
  const consoleErrors: string[] = []
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args.map(String).join(' '))
  })
  let root: ReturnType<typeof hydrateRoot> | undefined
  await act(async () => {
    root = hydrateRoot(container, <RouterProvider router={clientRouter} />, {
      onRecoverableError: (error) => recoverable.push(String(error)),
    })
  })
  spy.mockRestore()
  renderingOnClient = false
  return {
    container,
    recoverable,
    consoleErrors,
    cleanup: () => {
      act(() => root?.unmount())
      container.remove()
    },
  }
}

describe('AuthIndicator — hydrating the signed-in cluster (story 69.3 review)', () => {
  /**
   * ⚠️ DESIGNED RED (84.3 code review): the same harness, with one element
   * that differs between server and client. Without it, "no recoverable
   * error" below could mean this harness cannot see a mismatch at all (React 19
   * tolerates extra nodes directly under the hydration root, MEASURED).
   */
  it('reports a mismatch when the server and client trees differ (control)', async () => {
    const { recoverable, cleanup } = await hydrateSignedIn(true)
    try {
      expect(recoverable.length, 'the harness cannot see a hydration mismatch').toBeGreaterThan(0)
    } finally {
      cleanup()
    }
  })

  it('the <noscript> gear causes no hydration error and leaves no live link', async () => {
    const { container, recoverable, consoleErrors, cleanup } = await hydrateSignedIn(false)

    try {
      // Anti-vacuity: the cluster hydrated (React owns the trigger).
      const trigger = container.querySelector('button[aria-label="Account menu"]') as HTMLElement
      expect(trigger).not.toBeNull()
      expect(Object.keys(trigger).some((k) => k.startsWith('__reactFiber'))).toBe(true)

      expect(recoverable, `recoverable errors: ${recoverable.join(' | ')}`).toEqual([])
      expect(
        consoleErrors.filter((e) => /hydrat|did not match|mismatch/i.test(e)),
        'React reported a hydration mismatch'
      ).toEqual([])
      expect(container.querySelector('a[href="/settings"]'), 'a live gear leaked').toBeNull()
    } finally {
      cleanup()
    }
  })
})
