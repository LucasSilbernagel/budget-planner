/**
 * Paddle webhook IP allowlist (defense-in-depth, live-migration follow-up).
 *
 * NFR8: `checkWebhookIp`/`isPaddleWebhookIp` fetch `https://api.paddle.com/ips`
 * for real — `global.fetch` is stubbed here rather than left to MSW's generic
 * Paddle catch-all, which returns no `ipv4_cidrs` and would make every case
 * fail closed regardless of what it's meant to test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkWebhookIp,
  isPaddleWebhookIp,
  resetPaddleIpCacheForTests,
} from '../webhook-ip-allowlist'

const originalFetch = global.fetch
const originalEnv = process.env['PADDLE_WEBHOOK_ENFORCE_IP_ALLOWLIST']

const ENFORCE_KEY = 'PADDLE_WEBHOOK_ENFORCE_IP_ALLOWLIST'
/** `delete process.env[ENFORCE_KEY]` directly trips Biome's noDelete rule (a
 * literal-keyed delete); routing through a variable, as the other env-var
 * test files in this repo already do, does not. */
function unsetEnforceFlag() {
  delete process.env[ENFORCE_KEY]
}

function stubIpsEndpoint(cidrs: string[] | null) {
  global.fetch = vi.fn(() =>
    cidrs
      ? Promise.resolve(
          new Response(JSON.stringify({ data: { ipv4_cidrs: cidrs } }), { status: 200 })
        )
      : Promise.resolve(new Response('', { status: 500 }))
  ) as typeof global.fetch
}

beforeEach(() => {
  resetPaddleIpCacheForTests()
})

afterEach(() => {
  global.fetch = originalFetch
  if (originalEnv === undefined) {
    unsetEnforceFlag()
  } else {
    process.env['PADDLE_WEBHOOK_ENFORCE_IP_ALLOWLIST'] = originalEnv
  }
})

describe('isPaddleWebhookIp', () => {
  it('matches an IP inside a /24 range', async () => {
    stubIpsEndpoint(['34.194.127.0/24'])
    expect(await isPaddleWebhookIp('34.194.127.42')).toBe(true)
  })

  it('rejects an IP outside every range', async () => {
    stubIpsEndpoint(['34.194.127.0/24'])
    expect(await isPaddleWebhookIp('9.9.9.9')).toBe(false)
  })

  it('matches an exact /32 entry', async () => {
    stubIpsEndpoint(['1.2.3.4/32'])
    expect(await isPaddleWebhookIp('1.2.3.4')).toBe(true)
    expect(await isPaddleWebhookIp('1.2.3.5')).toBe(false)
  })

  it('fails closed (false) when the IPs endpoint errors', async () => {
    stubIpsEndpoint(null)
    expect(await isPaddleWebhookIp('1.2.3.4')).toBe(false)
  })

  it('fails closed (false) for a non-IPv4 value', async () => {
    stubIpsEndpoint(['34.194.127.0/24'])
    expect(await isPaddleWebhookIp('::1')).toBe(false)
  })

  it('caches the fetched ranges — a second call does not re-fetch', async () => {
    stubIpsEndpoint(['34.194.127.0/24'])
    await isPaddleWebhookIp('34.194.127.1')
    await isPaddleWebhookIp('34.194.127.2')
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })
})

describe('checkWebhookIp', () => {
  function requestWithIp(ip: string | null): Request {
    return new Request('https://app.test/api/webhooks/paddle', {
      method: 'POST',
      headers: ip ? { 'x-forwarded-for': ip } : {},
    })
  }

  it('is observe-only by default: reports allowed:false but never blocks the caller', async () => {
    unsetEnforceFlag()
    stubIpsEndpoint(['34.194.127.0/24'])
    const result = await checkWebhookIp(requestWithIp('9.9.9.9'))
    expect(result).toEqual({ allowed: false, ip: '9.9.9.9', enforced: false })
  })

  it('reports allowed:true for a matching IP even when not enforced', async () => {
    unsetEnforceFlag()
    stubIpsEndpoint(['34.194.127.0/24'])
    const result = await checkWebhookIp(requestWithIp('34.194.127.1'))
    expect(result).toEqual({ allowed: true, ip: '34.194.127.1', enforced: false })
  })

  it('with enforcement on, reports allowed:false for a non-matching IP (caller should reject)', async () => {
    process.env['PADDLE_WEBHOOK_ENFORCE_IP_ALLOWLIST'] = 'true'
    stubIpsEndpoint(['34.194.127.0/24'])
    const result = await checkWebhookIp(requestWithIp('9.9.9.9'))
    expect(result).toEqual({ allowed: false, ip: '9.9.9.9', enforced: true })
  })

  it('with enforcement on and no derivable IP, fails closed (allowed:false)', async () => {
    process.env['PADDLE_WEBHOOK_ENFORCE_IP_ALLOWLIST'] = 'true'
    stubIpsEndpoint(['34.194.127.0/24'])
    const result = await checkWebhookIp(requestWithIp(null))
    expect(result).toEqual({ allowed: false, ip: null, enforced: true })
  })
})
