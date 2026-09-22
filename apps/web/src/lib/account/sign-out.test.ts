/**
 * signOut tests (story 59.3, AC-7).
 *
 * The ONE sign-out implementation, shared by `/settings` (`AccountSection`) and
 * the chrome's account menu (`AuthIndicator`). What it must guarantee:
 *  - it POSTs `/api/auth/logout` BEFORE leaving, so the server clears the
 *    session cookies and revokes the session;
 *  - it then leaves with a FULL DOCUMENT LOAD to `/` (see the module docblock
 *    for why a client-side navigation is wrong here);
 *  - it leaves even when the POST fails, and never rejects: it runs from click
 *    handlers, where a rejection would be an unhandled promise — including when
 *    the navigation itself throws;
 *  - it gives the POST a deadline, so a hung request cannot strand the user
 *    (review: a hang disabled Sign out for the rest of the session);
 *  - it is ONE sign-out per app: a second call while the first is in flight
 *    joins it instead of sending a second POST, whichever control made it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSignOutStateForTests, returnToSignedOutHome, signOut } from './sign-out'

const assign = vi.fn()
const originalFetch = global.fetch

beforeEach(() => {
  vi.clearAllMocks()
  // `clearAllMocks` clears CALLS, not implementations: the "navigation throws"
  // test below would otherwise leave `assign` throwing for every later test.
  assign.mockReset()
  resetSignOutStateForTests()
  // jsdom's `location.assign` is not implemented (it logs "Not implemented:
  // navigation"), so it is replaced rather than spied. Same as
  // `account-section.test.tsx`.
  vi.stubGlobal('location', { ...globalThis.location, assign })
})
afterEach(() => {
  global.fetch = originalFetch
  vi.unstubAllGlobals()
})

describe('signOut', () => {
  it('POSTs the logout endpoint, THEN does a document load to /', async () => {
    const order: string[] = []
    global.fetch = vi.fn(async () => {
      order.push('fetch')
      return new Response('{"success":true}', { status: 200 })
    }) as typeof global.fetch
    assign.mockImplementation(() => order.push('assign'))

    await signOut()

    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({ method: 'POST' })
    )
    expect(assign).toHaveBeenCalledWith('/')
    expect(order).toEqual(['fetch', 'assign'])
  })

  it('still leaves when the POST rejects, and does not reject itself', async () => {
    global.fetch = vi.fn(() => Promise.reject(new TypeError('network down'))) as typeof global.fetch

    await expect(signOut()).resolves.toBeUndefined()
    expect(assign).toHaveBeenCalledWith('/')
  })

  it('gives the POST a deadline so a hung request cannot strand the user', async () => {
    let seen: RequestInit | undefined
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen = init
      return new Response('{}', { status: 200 })
    }) as typeof global.fetch

    await signOut()

    expect(seen?.signal, 'no AbortSignal was passed').toBeInstanceOf(AbortSignal)
  })

  it('joins an in-flight sign-out instead of sending a second POST', async () => {
    // The two controls (chrome menu + /settings) used to guard themselves
    // separately, so pressing one while the other was in flight sent a second
    // POST and raced a second navigation.
    let calls = 0
    global.fetch = vi.fn(() => {
      calls += 1
      return new Promise<Response>(() => {})
    }) as typeof global.fetch

    void signOut()
    void signOut()
    await Promise.resolve()

    expect(calls, 'a second sign-out sent a second POST').toBe(1)
  })

  it('does not reject when the navigation itself throws', async () => {
    global.fetch = vi.fn(async () => new Response('{}', { status: 200 })) as typeof global.fetch
    assign.mockImplementation(() => {
      throw new Error('navigation blocked')
    })

    await expect(signOut()).resolves.toBeUndefined()
    expect(assign).toHaveBeenCalledWith('/')
  })

  it('still leaves when the server answers with an error status', async () => {
    global.fetch = vi.fn(
      async () => new Response('{"success":false}', { status: 500 })
    ) as typeof global.fetch

    await signOut()
    expect(assign).toHaveBeenCalledWith('/')
  })
})

describe('returnToSignedOutHome', () => {
  it('is a document load to /, not a router navigation', () => {
    returnToSignedOutHome()
    expect(assign).toHaveBeenCalledWith('/')
  })
})
