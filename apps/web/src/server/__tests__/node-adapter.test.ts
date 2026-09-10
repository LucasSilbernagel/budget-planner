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
import { connect } from 'node:net'
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
  // PWA artifacts emitted by vite-plugin-pwa (story 7-1): the manifest must be
  // served as application/manifest+json, and the service-worker scripts must not
  // be long-cached (AC-1/AC-4).
  await writeFile(join(clientDir, 'manifest.webmanifest'), '{"name":"Budget Planner"}')
  await writeFile(join(clientDir, 'sw.js'), '/* service worker */')
  await writeFile(join(clientDir, 'workbox-abc123.js'), '/* workbox runtime */')
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

  it('serves the PWA manifest as application/manifest+json (story 7-1)', async () => {
    const asset = await resolveStaticAsset('/manifest.webmanifest', clientDir)
    expect(asset).not.toBeNull()
    expect(asset.contentType).toBe('application/manifest+json')
    // A plain root file — short cache, not the SW no-cache treatment.
    expect(asset.cacheControl).toBe('public, max-age=3600')
  })

  it('serves the service worker (/sw.js) with no-cache so redeploys are not stale (AC-4)', async () => {
    const asset = await resolveStaticAsset('/sw.js', clientDir)
    expect(asset).not.toBeNull()
    expect(asset.contentType).toBe('text/javascript; charset=utf-8')
    expect(asset.cacheControl).toBe('no-cache')
  })

  it('serves the Workbox runtime (/workbox-*.js) with no-cache (AC-4)', async () => {
    const asset = await resolveStaticAsset('/workbox-abc123.js', clientDir)
    expect(asset).not.toBeNull()
    expect(asset.cacheControl).toBe('no-cache')
  })

  it('keeps hashed /assets/* immutable even for a .js like sw.js name', async () => {
    // The no-cache rule is root-scoped: a hashed chunk under /assets stays
    // immutable (never matched as a service worker).
    const asset = await resolveStaticAsset('/assets/app-abc123.js', clientDir)
    expect(asset).not.toBeNull()
    expect(asset.cacheControl).toBe('public, max-age=31536000, immutable')
  })

  it('classifies cache-control from the resolved file, not the raw pathname (encoded-slash)', async () => {
    // `/assets/..%2fsw.js` decodes+normalizes to sw.js on disk. Cache-control must
    // follow the resolved file (no-cache for the SW), not the raw `/assets/` prefix
    // — otherwise the service worker could be served immutable and defeat AC-4.
    const asset = await resolveStaticAsset('/assets/..%2fsw.js', clientDir)
    expect(asset).not.toBeNull()
    expect(asset.contentType).toBe('text/javascript; charset=utf-8')
    expect(asset.cacheControl).toBe('no-cache')
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

/**
 * Send a request target verbatim over a raw socket. `fetch()` / `new URL()`
 * normalize `\` → `/` and collapse `//` on the CLIENT before anything is sent,
 * so they cannot exercise a target that reaches Node's http server as `/\…`.
 * A raw client (an attacker's socket, `curl --path-as-is`, or an edge proxy
 * that forwards the target unmodified) can. Returns the numeric status.
 */
function rawRequestStatus(host: string, port: number, target: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, host, () => {
      socket.write(`GET ${target} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`)
    })
    let buf = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => {
      buf += chunk
    })
    socket.on('end', () => {
      const match = buf.match(/^HTTP\/1\.\d (\d{3})/)
      if (!match) {
        reject(new Error(`no status line in response: ${JSON.stringify(buf.slice(0, 200))}`))
        return
      }
      resolve(Number(match[1]))
    })
    socket.on('error', reject)
  })
}

describe('malformed request targets (production 500, 2026-09-09)', () => {
  // A trailing slash on SITE_URL made the smoke check request `//`. The static
  // matcher did `new URL('//', 'http://localhost')`, which parses `//` as a
  // PROTOCOL-RELATIVE url — the segment after it becomes the AUTHORITY, and an
  // empty one throws ERR_INVALID_URL. Every request to `https://site//` was a
  // 500, reachable by anyone, and the trailing slash only revealed it.
  let baseUrl: string
  let host: string
  let port: number
  let server: ReturnType<typeof createServer>
  let seenPaths: string[]

  beforeAll(async () => {
    seenPaths = []
    const fetchHandler = async (request: Request): Promise<Response> => {
      seenPaths.push(new URL(request.url).pathname)
      return new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } })
    }
    server = createServer(createRequestListener({ fetchHandler, clientDir }))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    host = '127.0.0.1'
    port = (server.address() as AddressInfo).port
    baseUrl = `http://${host}:${port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  beforeEach(() => {
    seenPaths = []
    // Loopback requests must reach the real server; without this MSW answers
    // them and the assertions measure the mock, not the adapter.
    mswServer.use(http.all(/^http:\/\/127\.0\.0\.1:\d+\//, () => passthrough()))
  })

  it('serves `//` instead of throwing ERR_INVALID_URL', async () => {
    expect(await rawRequestStatus(host, port, '//')).toBe(200)
  })

  // WHATWG `URL` treats `\` as `/` for special schemes, so the first fix (a
  // `startsWith('//')` guard that stripped only `/`) left `/\` and `//\…`
  // reaching `new URL(target, base)` unchanged: `/\` threw ERR_INVALID_URL (the
  // same anyone-reachable 500) and `/\host/x` resolved to pathname `/x`. Caught
  // in the 2026-09-10 review; the guard is now an unconditional
  // `replace(/^[/\\]+/, '/')`. `fetch()`/`new URL()` normalize these on the
  // client, so this must go over a raw socket to reach the server. (A target
  // that does not start with `/` — e.g. `\\x` — is rejected by Node's HTTP
  // parser with a 400 before the listener runs, so it is not covered here.)
  it.each(['/\\', '/\\evil.example/x', '//\\evil.example/x', '/\\\\double'])(
    'does not 500 on a backslash-prefixed target (%j)',
    async (target) => {
      expect(await rawRequestStatus(host, port, target)).toBe(200)
    }
  )

  it('treats `//host/path` as a PATH, never as an authority', async () => {
    // Without collapsing, `new URL('//evil.example/x', base)` yields host
    // evil.example and pathname '/x' — the static matcher would then match on a
    // path the client never asked for. The fetch-handler path is unaffected
    // (its base already carries a host), so it still sees the raw target.
    const slashRes = await fetch(`${baseUrl}//evil.example/x`)
    expect(slashRes.status).toBe(200)
    expect(seenPaths.at(-1)).toBe('//evil.example/x')
  })

  it('a `\\host/asset` target is not served as that static asset (no authority confusion)', async () => {
    // Pre-fix: `new URL('/\\evil.example/favicon.svg', base)` → host
    // evil.example, pathname `/favicon.svg` → the static matcher serves the real
    // favicon for a request the client never made. Post-fix the leading `/\`
    // collapses to `/`, so the pathname keeps `evil.example` as a segment, no
    // file matches, and the request falls through to the SSR handler (the stub
    // answers 200 with no cache-control — a served file would set it).
    seenPaths.length = 0
    expect(await rawRequestStatus(host, port, '/\\evil.example/favicon.svg')).toBe(200)
    expect(seenPaths).toHaveLength(1) // reached the handler, not served from disk
  })

  it('still serves an ordinary static asset from disk (not a handler fall-through)', async () => {
    seenPaths.length = 0
    const asset = await fetch(`${baseUrl}/assets/app-abc123.js`)
    expect(asset.status).toBe(200)
    // Distinguishes a real static serve from the always-200 stub: only
    // serveStaticFile sets immutable cache-control and the file's actual body.
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(await asset.text()).toBe('console.log(1)')
    expect(seenPaths).toHaveLength(0)

    expect((await fetch(`${baseUrl}/`)).status).toBe(200)
  })
})
