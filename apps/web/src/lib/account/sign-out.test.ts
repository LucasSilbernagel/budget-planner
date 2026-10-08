import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_SHELL_PURGE_TIMEOUT_MS } from '../pwa/app-shell-cache'
import { resetSignOutStateForTests, returnToSignedOutHome, signOut } from './sign-out'

const assign = vi.fn()
const originalFetch = global.fetch

beforeEach(() => {
  vi.clearAllMocks()
  // `clearAllMocks` keeps implementations, so reset `assign` or a throwing one leaks into later tests.
  assign.mockReset()
  resetSignOutStateForTests()
  // jsdom does not implement `location.assign`, so it is replaced rather than spied.
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

describe('signOut purges the app-shell page cache', () => {
  function stubCaches(remove: (name: string) => Promise<boolean>) {
    const del = vi.fn(remove)
    vi.stubGlobal('caches', { delete: del })
    return del
  }

  afterEach(() => {
    vi.useRealTimers()
  })

  it('POST, then the purge SETTLES, then the document load', async () => {
    const order: string[] = []
    global.fetch = vi.fn(async () => {
      order.push('fetch')
      return new Response('{"success":true}', { status: 200 })
    }) as typeof global.fetch
    const del = stubCaches(async () => {
      order.push('purge-start')
      // Settle on a later task, so a purge that is not awaited shows up as `assign` first.
      await new Promise((resolve) => setTimeout(resolve, 0))
      order.push('purge-settled')
      return true
    })
    assign.mockImplementation(() => order.push('assign'))

    await expect(signOut()).resolves.toBeUndefined()

    expect(del).toHaveBeenCalledWith('app-shell')
    expect(order).toEqual(['fetch', 'purge-start', 'purge-settled', 'assign'])
  })

  it('purges even when the POST rejects (offline), then leaves', async () => {
    global.fetch = vi.fn(() => Promise.reject(new TypeError('network down'))) as typeof global.fetch
    const del = stubCaches(async () => true)

    await expect(signOut()).resolves.toBeUndefined()

    expect(del).toHaveBeenCalledWith('app-shell')
    expect(assign).toHaveBeenCalledWith('/')
    expect(del.mock.invocationCallOrder[0]).toBeLessThan(assign.mock.invocationCallOrder[0])
  })

  it('purges when the server answers with an error status, then leaves', async () => {
    global.fetch = vi.fn(
      async () => new Response('{"success":false}', { status: 500 })
    ) as typeof global.fetch
    const del = stubCaches(async () => true)

    await expect(signOut()).resolves.toBeUndefined()

    expect(del).toHaveBeenCalledWith('app-shell')
    expect(assign).toHaveBeenCalledWith('/')
  })

  it('leaves at the bound, not before, when the purge never settles', async () => {
    vi.useFakeTimers()
    global.fetch = vi.fn(async () => new Response('{}', { status: 200 })) as typeof global.fetch
    stubCaches(() => new Promise<boolean>(() => {}))
    let resolved = false
    void signOut().then(() => {
      resolved = true
    })

    await vi.advanceTimersByTimeAsync(APP_SHELL_PURGE_TIMEOUT_MS - 1)
    expect(assign, 'left before the purge bound').not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(assign).toHaveBeenCalledWith('/')
    expect(resolved).toBe(true)
  })

  it('leaves when the purge rejects', async () => {
    global.fetch = vi.fn(async () => new Response('{}', { status: 200 })) as typeof global.fetch
    stubCaches(() => Promise.reject(new Error('quota')))

    await expect(signOut()).resolves.toBeUndefined()
    expect(assign).toHaveBeenCalledWith('/')
  })

  it('leaves when there is no Cache Storage API', async () => {
    global.fetch = vi.fn(async () => new Response('{}', { status: 200 })) as typeof global.fetch
    expect(typeof (globalThis as { caches?: unknown }).caches).toBe('undefined')

    await expect(signOut()).resolves.toBeUndefined()
    expect(assign).toHaveBeenCalledWith('/')
  })
})

describe('returnToSignedOutHome', () => {
  it('is a document load to /, not a router navigation', () => {
    returnToSignedOutHome()
    expect(assign).toHaveBeenCalledWith('/')
  })
})
