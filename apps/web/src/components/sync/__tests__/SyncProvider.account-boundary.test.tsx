/**
 * `SyncProvider` applies the account boundary when the root could not (story
 * 90.1, AC 3): the SSR seed was `null` or untrusted, so `StoreHydration` removed
 * nothing, and the session is only known once `/api/auth/me` answers.
 *
 * Real stores and the real `dropAnotherAccountsLocalData`; only the sync engine's
 * internals are mocked, and the engine chunk itself is made to FAIL to load, so
 * the removal is shown not to depend on it (86.2 review LOW).
 */

import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../ActiveSync', () => {
  throw new Error('chunk failed to load')
})

import { resetAccountBoundaryForTests } from '@/lib/sync/accountBoundary'
import { useIncomeStore } from '@/stores/incomeStore'
import { useProfileStore } from '@/stores/profileStore'
import { SyncProvider } from '../SyncProvider'

const ACCOUNT_A = 'aaaaaaaa-0000-4000-8000-000000000902'
const ACCOUNT_B = 'bbbbbbbb-0000-4000-8000-000000000902'
const A_MAIN = 'aaaaaaaa-1111-4111-8111-111111111902'
const ISO = '2026-10-01T00:00:00.000Z'

function income(id: string, userId: string | number) {
  return {
    id,
    userId,
    profileId: A_MAIN,
    name: id,
    amount: 100,
    frequency: 'monthly' as const,
    categoryId: null,
    sortOrder: 0,
    createdAt: ISO,
    updatedAt: ISO,
  }
}

function stubMe(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status }))
  )
}

function incomeIds(): string[] {
  return useIncomeStore.getState().incomeSources.map((row) => row.id)
}

beforeEach(() => {
  resetAccountBoundaryForTests()
  document.cookie = 'has_session=1'
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  useProfileStore.setState({
    profiles: [{ id: A_MAIN, userId: ACCOUNT_A, name: 'A', isDefault: true, currency: 'NONE' }],
    activeProfileId: A_MAIN,
  })
  useIncomeStore.setState({ incomeSources: [income('a-salary', ACCOUNT_A), income('free-row', 0)] })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.cookie = 'has_session=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
})

describe('SyncProvider applies the account boundary on a verified session (story 90.1)', () => {
  it('signed out ({ user: null } with a 200): removes A’s rows', async () => {
    stubMe({ user: null })
    render(<SyncProvider />)
    await waitFor(() => expect(incomeIds()).toEqual(['free-row']))
  })

  it('paid B, with the sync engine chunk failing to load: still removes A’s rows', async () => {
    stubMe({ user: { userId: ACCOUNT_B, subscriptionStatus: 'active' } })
    render(<SyncProvider />)
    await waitFor(() => expect(incomeIds()).toEqual(['free-row']))
    expect(useProfileStore.getState().profiles.some((p) => p.userId === ACCOUNT_A)).toBe(false)
  })

  it('A itself: keeps everything', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ user: { userId: ACCOUNT_A, subscriptionStatus: 'free' } }), {
          status: 200,
        })
    )
    vi.stubGlobal('fetch', fetchMock)
    render(<SyncProvider />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(incomeIds()).toEqual(['a-salary', 'free-row'])
  })

  it('a resolver error (503) is not an answer: removes nothing', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<SyncProvider />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(incomeIds()).toEqual(['a-salary', 'free-row'])
  })

  it('offline (fetch rejects) is not an answer: removes nothing', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<SyncProvider />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(incomeIds()).toEqual(['a-salary', 'free-row'])
  })

  it('no marker cookie: signed out without a request, and A’s rows go', () => {
    document.cookie = 'has_session=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<SyncProvider />)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(incomeIds()).toEqual(['free-row'])
  })
})
