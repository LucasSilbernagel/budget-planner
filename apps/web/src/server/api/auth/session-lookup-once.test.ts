import { describe, expect, it, vi } from 'vitest'
import { lookupSessionOnce } from './session-lookup-once'

describe('lookupSessionOnce', () => {
  it('reuses the lookup for the same request (root loader + /login guard during SSR)', async () => {
    const request = new Request('http://localhost/login')
    const lookup = vi.fn(async () => ({ success: true }))

    const first = lookupSessionOnce(request, lookup)
    const second = lookupSessionOnce(request, lookup)

    expect(lookup).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)
    expect(await second).toEqual({ success: true })
  })

  it('looks up again for a different request (each client navigation is fresh)', async () => {
    const lookup = vi.fn(async () => ({ success: true }))

    await lookupSessionOnce(new Request('http://localhost/'), lookup)
    await lookupSessionOnce(new Request('http://localhost/login'), lookup)

    expect(lookup).toHaveBeenCalledTimes(2)
  })
})
