/**
 * Tests for the production Node server adapter (Story 5-2, AC-1).
 *
 * The adapter bridges Node's `http` server to the web-standard `fetch` handler
 * exported by the TanStack Start build, and serves the static `dist/client/`
 * assets that the SSR handler does not. These tests exercise the pure helpers
 * plus an end-to-end pass over a real loopback (127.0.0.1) server with a stub
 * fetch handler — no external network, no real build artifact required.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { http, passthrough } from 'msw'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { server as mswServer } from '../../mocks/server'
// @ts-expect-error - .mjs adapter has no type declarations; behaviour is asserted below.
import { createRequestListener, resolveStaticAsset, toWebRequest } from '../node-adapter.mjs'

let clientDir: string

beforeAll(async () => {
  clientDir = await mkdtemp(join(tmpdir(), 'web-client-'))
  await mkdir(join(clientDir, 'assets'), { recursive: true })
  await writeFile(join(clientDir, 'assets', 'app-abc123.js'), 'console.log(1)')
  await writeFile(join(clientDir, 'favicon.svg'), '<svg></svg>')
  // Binary favicon fallbacks added in story 6-5 — assert the adapter serves
  // them with the correct image MIME type (contents are irrelevant here).
  await writeFile(join(clientDir, 'favicon-32.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  await writeFile(join(clientDir, 'favicon.ico'), Buffer.from([0x00, 0x00, 0x01, 0x00]))
})

afterAll(async () => {
  await rm(clientDir, { recursive: true, force: true })
})

describe('resolveStaticAsset', () => {
  it('returns null for a path with no matching file', async () => {
    expect(await resolveStaticAsset('/does-not-exist.js', clientDir)).toBeNull()
  })

  it('returns null for the root path (SSR must handle it, no index.html)', async () => {
    expect(await resolveStaticAsset('/', clientDir)).toBeNull()
  })

  it('serves hashed /assets/* files as immutable', async () => {
    const asset = await resolveStaticAsset('/assets/app-abc123.js', clientDir)
    expect(asset).not.toBeNull()
    expect(asset.contentType).toBe('text/javascript; charset=utf-8')
    expect(asset.cacheControl).toBe('public, max-age=31536000, immutable')
  })

  it('serves non-hashed root files with a short cache lifetime', async () => {
    const asset = await resolveStaticAsset('/favicon.svg', clientDir)
    expect(asset).not.toBeNull()
    expect(asset.contentType).toBe('image/svg+xml')
    expect(asset.cacheControl).toBe('public, max-age=3600')
  })

  it('serves the PNG favicon fallback with the image/png MIME type', async () => {
    const asset = await resolveStaticAsset('/favicon-32.png', clientDir)
    expect(asset).not.toBeNull()
    expect(asset.contentType).toBe('image/png')
    expect(asset.cacheControl).toBe('public, max-age=3600')
  })

  it('serves the legacy .ico favicon with the image/x-icon MIME type', async () => {
    const asset = await resolveStaticAsset('/favicon.ico', clientDir)
    expect(asset).not.toBeNull()
    expect(asset.contentType).toBe('image/x-icon')
    expect(asset.cacheControl).toBe('public, max-age=3600')
  })

  it('rejects path traversal escaping the client dir', async () => {
    expect(await resolveStaticAsset('/../../../../etc/passwd', clientDir)).toBeNull()
    expect(await resolveStaticAsset('/assets/../../secret', clientDir)).toBeNull()
  })

  it('returns null for malformed percent-encoding rather than throwing', async () => {
    expect(await resolveStaticAsset('/%E0%A4%A', clientDir)).toBeNull()
  })
})

describe('toWebRequest', () => {
  it('builds an absolute URL from the Host header and preserves method + headers', () => {
    const req = {
      method: 'GET',
      url: '/api/thing?q=1',
      headers: { host: 'example.test', 'x-custom': 'yes' },
    }
    const webReq = toWebRequest(req as never)
    expect(webReq.url).toBe('http://example.test/api/thing?q=1')
    expect(webReq.method).toBe('GET')
    expect(webReq.headers.get('x-custom')).toBe('yes')
  })

  it('falls back to localhost when no Host header is present', () => {
    const req = { method: 'GET', url: '/', headers: {} }
    const webReq = toWebRequest(req as never)
    expect(webReq.url).toBe('http://localhost/')
  })

  it('honors X-Forwarded-Proto / X-Forwarded-Host from the proxy', () => {
    const req = {
      method: 'GET',
      url: '/x',
      headers: {
        host: 'internal:8080',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'app.example.com',
      },
    }
    const webReq = toWebRequest(req as never)
    expect(webReq.url).toBe('https://app.example.com/x')
  })

  it('takes the first hop of a comma-joined X-Forwarded-Proto', () => {
    const req = {
      method: 'GET',
      url: '/',
      headers: { host: 'h', 'x-forwarded-proto': 'https, http' },
    }
    const webReq = toWebRequest(req as never)
    expect(webReq.url).toBe('https://h/')
  })

  it('streams a POST body through to the web Request', async () => {
    // A real Readable stands in for the Node IncomingMessage so `Readable.toWeb`
    // + `duplex: 'half'` are exercised (the most fragile conversion branch).
    const req = Readable.from([Buffer.from('{"a":1}')]) as unknown as {
      method: string
      url: string
      headers: Record<string, string>
    }
    req.method = 'POST'
    req.url = '/api/thing'
    req.headers = { host: 'example.test', 'content-type': 'application/json' }
    const webReq = toWebRequest(req as never)
    expect(webReq.method).toBe('POST')
    expect(await webReq.text()).toBe('{"a":1}')
  })
})

describe('createRequestListener (loopback integration)', () => {
  let baseUrl: string
  let server: ReturnType<typeof createServer>
  let lastDelegatedPath: string | null = null

  beforeAll(async () => {
    const fetchHandler = async (request: Request): Promise<Response> => {
      lastDelegatedPath = new URL(request.url).pathname
      if (lastDelegatedPath === '/boom') {
        throw new Error('kaboom-internal-detail')
      }
      if (lastDelegatedPath === '/set-cookies') {
        const headers = new Headers()
        headers.append('set-cookie', 'a=1; Path=/')
        headers.append('set-cookie', 'b=2; Path=/')
        return new Response('cookies', { status: 200, headers })
      }
      return new Response('ssr-body', {
        status: 201,
        headers: { 'content-type': 'text/plain', 'x-ssr': 'hit' },
      })
    }

    const listener = createRequestListener({ fetchHandler, clientDir })
    server = createServer(listener)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${port}`
  })

  // The global MSW setup errors on any unhandled request; let real loopback
  // calls to our test server through. Re-applied each test because the global
  // afterEach resets runtime handlers.
  beforeEach(() => {
    mswServer.use(http.all(/^http:\/\/127\.0\.0\.1:\d+\//, () => passthrough()))
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    )
  })

  it('delegates a non-static request to the fetch handler', async () => {
    const res = await fetch(`${baseUrl}/api/calc`)
    expect(res.status).toBe(201)
    expect(res.headers.get('x-ssr')).toBe('hit')
    expect(await res.text()).toBe('ssr-body')
    expect(lastDelegatedPath).toBe('/api/calc')
  })

  it('serves an existing static asset without invoking the fetch handler', async () => {
    lastDelegatedPath = null
    const res = await fetch(`${baseUrl}/assets/app-abc123.js`)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(await res.text()).toBe('console.log(1)')
    // The SSR handler must NOT have been consulted for a real asset.
    expect(lastDelegatedPath).toBeNull()
  })

  it('preserves multiple Set-Cookie headers as distinct cookies', async () => {
    const res = await fetch(`${baseUrl}/set-cookies`)
    const cookies = res.headers.getSetCookie()
    expect(cookies).toContain('a=1; Path=/')
    expect(cookies).toContain('b=2; Path=/')
  })

  it('returns a generic 500 without leaking internals when the handler throws', async () => {
    const res = await fetch(`${baseUrl}/boom`)
    expect(res.status).toBe(500)
    const body = await res.text()
    expect(body).toBe('Internal Server Error')
    expect(body).not.toContain('kaboom') // the thrown error detail must not leak
  })
})
