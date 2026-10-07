/**
 * The /login page's own card, beside the account strip (stories 21-2, 41.3;
 * moved below the browser by story 84.3 from `e2e/auth-indicator.spec.ts`).
 *
 * The page keeps its card affordances: the "Sign in" heading, Terms and
 * Privacy inside the consent line, "Continue without account", and NOT the
 * redundant page-level "All rights reserved" line story 21-2 removed (the
 * global Footer's copyright reads differently). The strip renders WITH the
 * card, as it does on the real page, so the 41.3 contrast is measured here:
 * the strip offers "Sign in" on `/` and drops it on `/login`.
 *
 * The page is reached through `Route.options.component`, as the router invokes
 * it. Its `Route.useSearch()` needs the file route's match, which a throwaway
 * router cannot give it, so that one hook is stubbed to the no-error search.
 */

import { SessionSeedProvider } from '@/context/session-seed'
import { renderWithRouter, screen, waitFor, within } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthIndicator } from '../../components/auth/auth-indicator'
import { Route } from '../login'

const LoginPage = Route.options.component as () => React.ReactElement
const SIGNED_OUT = { isAuthenticated: false, userId: null, email: null, subscriptionStatus: null }

function renderChrome(path: string, withPage: boolean) {
  return renderWithRouter(
    <SessionSeedProvider seed={SIGNED_OUT}>
      <AuthIndicator />
      {withPage && <LoginPage />}
    </SessionSeedProvider>,
    { path }
  )
}

const strip = () => screen.findByRole('status', { name: /account status/i })

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify({ user: null }), { status: 200 })))
  )
  vi.spyOn(Route, 'useSearch').mockReturnValue({ error: undefined } as never)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('/login — the sign-in card beside the strip', () => {
  it('keeps its heading, consent links and "Continue without account", and no "All rights reserved"', async () => {
    renderChrome('/login', true)

    // The sign-in card rendered. Scoped to the card's <h2> by ROLE deliberately
    // (carried over from the e2e original, story 21-2). Story 41.3
    // removed the AuthIndicator's "Sign in" link FROM THIS ROUTE, so an
    // unscoped /^sign in$/i text match would succeed on the heading alone and
    // stop distinguishing the card from the strip. The role scope keeps this
    // assertion saying what it always said: the CARD is here.
    expect(await screen.findByRole('heading', { name: /^sign in$/i })).toBeInTheDocument()

    const consent = screen.getByText(/by signing in, you agree to our/i)
    expect(within(consent).getByRole('link', { name: /terms of service/i })).toHaveAttribute(
      'href',
      '/terms'
    )
    expect(within(consent).getByRole('link', { name: /privacy policy/i })).toHaveAttribute(
      'href',
      '/privacy'
    )

    expect(screen.getByRole('link', { name: /continue without account/i })).toHaveAttribute(
      'href',
      '/'
    )
    expect(screen.queryByText(/all rights reserved/i)).toBeNull()
  })

  /**
   * The contrast, in one test (story 41.3): the strip offers "Sign in" on `/`
   * and, on `/login`, keeps its region but drops the link, while the page's
   * own card is untouched. A bare absence on `/login` alone could not tell a
   * dropped link from a strip that never rendered.
   */
  it('drops the strip’s "Sign in" on /login while the Overview keeps it, and the card stays', async () => {
    const home = renderChrome('/', false)
    expect(await within(await strip()).findByRole('link', { name: /sign in/i })).toHaveAttribute(
      'href',
      '/login'
    )
    home.unmount()

    renderChrome('/login', true)
    expect(await screen.findByRole('heading', { name: /^sign in$/i })).toBeInTheDocument()
    // Resolved (no loading placeholder), and still no link in the region.
    const region = await strip()
    await waitFor(() => expect(region.children).toHaveLength(0))
    expect(within(region).queryByRole('link', { name: /sign in/i })).toBeNull()
  })

  it('is exactly one <main> landmark (story 116.1, FR184)', async () => {
    renderChrome('/login', true)
    expect(await screen.findByRole('heading', { name: /^sign in$/i })).toBeInTheDocument()
    expect(screen.getAllByRole('main')).toHaveLength(1)
  })
})
