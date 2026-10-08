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
