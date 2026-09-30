/**
 * `/profiles` resolves to the locked upgrade surface for a signed-out visitor,
 * through the REAL `usePremiumAccess` (story 13-3; moved from
 * `e2e/profiles-premium.spec.ts` by story 82.3).
 *
 * `profiles-page.test.tsx` mocks the hook, so it proves the page's reaction to a
 * status, not how a real signed-out session becomes one. Here nothing is mocked
 * but the network: the route's component is rendered under the signed-out SSR
 * seed (`SIGNED_OUT_SEED`, the SAME constant the server resolver returns for a
 * request with no session cookie), and under NO seed, where the hook re-checks
 * `GET /api/auth/me` and gets its signed-out answer `{ user: null }`
 * (`routes/api/auth/me.ts`). What stays unproven here is the HTTP layer itself
 * (a real cookie-less request); the route handler has its own tests.
 */

import { SIGNED_OUT_SEED, type SessionSeed, SessionSeedProvider } from '@/context/session-seed'
import { Route } from '@/routes/profiles'
import { renderWithRouter, screen } from '@/test/utils'
import type { ComponentType } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const originalFetch = global.fetch

afterEach(() => {
  global.fetch = originalFetch
})

async function expectLockedSurface(seed: SessionSeed | null): Promise<void> {
  const Page = Route.options.component as ComponentType
  expect(Page).toBeTypeOf('function')

  renderWithRouter(
    <SessionSeedProvider seed={seed}>
      <Page />
    </SessionSeedProvider>,
    { path: '/profiles' }
  )

  expect(await screen.findByRole('heading', { name: /go premium/i })).toBeInTheDocument()
  expect(screen.getAllByText(/custom profiles/i).length).toBeGreaterThan(0)
  expect(screen.getByRole('link', { name: /upgrade to premium/i })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /new profile/i })).not.toBeInTheDocument()
}

describe('/profiles for a signed-out visitor', () => {
  it('renders the locked upgrade surface under the signed-out SSR seed', async () => {
    await expectLockedSurface({ ...SIGNED_OUT_SEED })
  })

  it('renders the locked upgrade surface when there is no seed and /api/auth/me says signed out', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('/api/auth/me')
        ? new Response(JSON.stringify({ user: null }), { status: 200 })
        : new Response('{}', { status: 200 })
    )
    global.fetch = fetchMock as typeof global.fetch

    await expectLockedSurface(null)
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/auth/me'))).toBe(true)
  })
})
