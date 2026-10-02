/**
 * Response compression in the production Node adapter.
 *
 * Production measured 2026-10-02: no response carried `content-encoding`, so
 * the 521 KB entry chunk went out raw. Static files are now precompressed at
 * build time (`scripts/precompress-lib.mjs`) and picked by `Accept-Encoding`;
 * handler responses (SSR HTML, `/api/*` JSON) are compressed on the fly.
 *
 * Requests go through `node:http`, not `fetch()`: fetch decodes the body and
 * picks its own `Accept-Encoding`, which would hide exactly what is asserted.
 */

import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { createServer, request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brotliDecompressSync, gunzipSync } from 'node:zlib'
import { http, passthrough } from 'msw'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { precompressDirectory } from '../../../scripts/precompress-lib.mjs'
import { server as mswServer } from '../../mocks/server'
// @ts-expect-error - .mjs adapter has no type declarations; behaviour is asserted below.
import { createRequestListener, isCompressibleType, negotiateEncoding } from '../node-adapter.mjs'

const BIG_JS = `export const rows = ${JSON.stringify(
  Array.from({ length: 400 }, (_, i) => ({ i, label: `row ${i}` }))
)}\n`
const BIG_HTML = `<!doctype html><html><body>${'<p>Longhand Budget</p>'.repeat(200)}</body></html>`

describe('negotiateEncoding', () => {
  it.each([
    [undefined, null],
    ['', null],
    ['identity', null],
    ['gzip, deflate, br', 'br'],
    ['gzip', 'gzip'],
    ['br', 'br'],
    ['br;q=0, gzip', 'gzip'],
    ['br;q=0.5, gzip;q=0.8', 'gzip'],
    ['gzip;q=0, br;q=0', null],
    ['*', 'br'],
    ['*;q=0, gzip', 'gzip'],
    ['GZIP', 'gzip'],
    ['gzip;q=abc', null],
  ])('%j -> %j', (header, expected) => {
    expect(negotiateEncoding(header)).toBe(expected)
  })
})

describe('isCompressibleType', () => {
  it.each([
    ['text/html; charset=utf-8', true],
    ['application/json', true],
    ['application/manifest+json', true],
    ['image/svg+xml', true],
    ['text/event-stream', false],
    ['image/png', false],
    ['application/octet-stream', false],
    [null, false],
  ])('%j -> %j', (type, expected) => {
    expect(isCompressibleType(type)).toBe(expected)
  })
})

interface RawResponse {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: Buffer
}

function rawRequest(
  url: string,
  headers: Record<string, string> = {},
  method = 'GET'
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method, headers }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) })
      )
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end()
  })
}

describe('compression over a loopback server', () => {
  let clientDir: string
  let baseUrl: string
  let server: ReturnType<typeof createServer>

  beforeAll(async () => {
    clientDir = await mkdtemp(join(tmpdir(), 'web-client-compress-'))
    await mkdir(join(clientDir, 'assets'), { recursive: true })
    await writeFile(join(clientDir, 'assets', 'big-abc123.js'), BIG_JS)
    await writeFile(join(clientDir, 'assets', 'tiny-abc123.js'), 'console.log(1)')
    await writeFile(join(clientDir, 'sw.js'), BIG_JS)
    await writeFile(join(clientDir, 'logo.png'), Buffer.alloc(4096, 7))
    await precompressDirectory(clientDir)

    const fetchHandler = async (request: Request): Promise<Response> => {
      const { pathname } = new URL(request.url)
      if (pathname === '/page') {
        // Streamed in two chunks, like an SSR render.
        const half = BIG_HTML.length / 2
        const body = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(BIG_HTML.slice(0, half)))
            controller.enqueue(new TextEncoder().encode(BIG_HTML.slice(half)))
            controller.close()
          },
        })
        return new Response(body, {
          headers: { 'content-type': 'text/html; charset=utf-8', vary: 'Cookie' },
        })
      }
      if (pathname === '/small') {
        return new Response('{"ok":1}', {
          headers: { 'content-type': 'application/json', 'content-length': '8' },
        })
      }
      if (pathname === '/tiny-unknown-length') {
        // Like Start's `json()`: no content-length, so only reading tells.
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"status":"ok"}'))
              controller.close()
            },
          }),
          { headers: { 'content-type': 'application/json' } }
        )
      }
      if (pathname === '/no-transform') {
        return new Response(BIG_HTML, {
          headers: { 'content-type': 'text/html', 'cache-control': 'no-transform' },
        })
      }
      if (pathname === '/not-modified') {
        return new Response(null, { status: 304, headers: { 'content-type': 'text/html' } })
      }
      return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } })
    }

    server = createServer(createRequestListener({ fetchHandler, clientDir }))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  beforeEach(() => {
    mswServer.use(http.all(/^http:\/\/127\.0\.0\.1:\d+\//, () => passthrough()))
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(clientDir, { recursive: true, force: true })
  })

  describe('static files', () => {
    it('serves the brotli sibling when brotli is accepted', async () => {
      const res = await rawRequest(`${baseUrl}/assets/big-abc123.js`, {
        'accept-encoding': 'gzip, deflate, br',
      })
      expect(res.status).toBe(200)
      expect(res.headers['content-encoding']).toBe('br')
      expect(res.headers.vary).toBe('Accept-Encoding')
      expect(res.headers['content-type']).toBe('text/javascript; charset=utf-8')
      expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable')
      expect(Number(res.headers['content-length'])).toBe(res.body.length)
      expect(res.body.length).toBeLessThan(BIG_JS.length / 3)
      expect(brotliDecompressSync(res.body).toString()).toBe(BIG_JS)
    })

    it('serves the gzip sibling when only gzip is accepted', async () => {
      const res = await rawRequest(`${baseUrl}/assets/big-abc123.js`, {
        'accept-encoding': 'gzip',
      })
      expect(res.headers['content-encoding']).toBe('gzip')
      expect(gunzipSync(res.body).toString()).toBe(BIG_JS)
    })

    it('serves the raw file, still varying, when no encoding is accepted', async () => {
      const res = await rawRequest(`${baseUrl}/assets/big-abc123.js`)
      expect(res.headers['content-encoding']).toBeUndefined()
      expect(res.headers.vary).toBe('Accept-Encoding')
      expect(res.body.toString()).toBe(BIG_JS)
    })

    it('answers HEAD with the encoded length and no body', async () => {
      const head = await rawRequest(
        `${baseUrl}/assets/big-abc123.js`,
        { 'accept-encoding': 'br' },
        'HEAD'
      )
      const brSize = (await stat(join(clientDir, 'assets', 'big-abc123.js.br'))).size
      expect(head.headers['content-encoding']).toBe('br')
      expect(Number(head.headers['content-length'])).toBe(brSize)
      expect(head.body.length).toBe(0)
    })

    it('serves a file under the threshold raw (no sibling is written for it)', async () => {
      const res = await rawRequest(`${baseUrl}/assets/tiny-abc123.js`, { 'accept-encoding': 'br' })
      expect(res.headers['content-encoding']).toBeUndefined()
      expect(res.body.toString()).toBe('console.log(1)')
    })

    it('never compresses an already-compressed format, and does not vary it', async () => {
      const res = await rawRequest(`${baseUrl}/logo.png`, { 'accept-encoding': 'br' })
      expect(res.headers['content-encoding']).toBeUndefined()
      expect(res.headers.vary).toBeUndefined()
      expect(res.body.length).toBe(4096)
    })

    it('ignores a sibling older than its file (a stale earlier build), keeping sw.js no-cache', async () => {
      const future = new Date(Date.now() + 60_000)
      await utimes(join(clientDir, 'sw.js'), future, future)
      const res = await rawRequest(`${baseUrl}/sw.js`, { 'accept-encoding': 'br' })
      expect(res.headers['content-encoding']).toBeUndefined()
      expect(res.headers['cache-control']).toBe('no-cache')
      expect(res.body.toString()).toBe(BIG_JS)
    })
  })

  describe('handler responses', () => {
    it('compresses a streamed HTML response and keeps its own Vary', async () => {
      const res = await rawRequest(`${baseUrl}/page`, { 'accept-encoding': 'br' })
      expect(res.headers['content-encoding']).toBe('br')
      expect(res.headers['content-length']).toBeUndefined()
      expect(res.headers.vary).toBe('Cookie, Accept-Encoding')
      expect(brotliDecompressSync(res.body).toString()).toBe(BIG_HTML)
    })

    it('compresses with gzip when only gzip is accepted', async () => {
      const res = await rawRequest(`${baseUrl}/page`, { 'accept-encoding': 'gzip' })
      expect(res.headers['content-encoding']).toBe('gzip')
      expect(gunzipSync(res.body).toString()).toBe(BIG_HTML)
    })

    it('sends it raw with Vary when no encoding is accepted', async () => {
      const res = await rawRequest(`${baseUrl}/page`)
      expect(res.headers['content-encoding']).toBeUndefined()
      expect(res.headers.vary).toBe('Cookie, Accept-Encoding')
      expect(res.body.toString()).toBe(BIG_HTML)
    })

    it('leaves a body known to be under the threshold alone', async () => {
      const res = await rawRequest(`${baseUrl}/small`, { 'accept-encoding': 'br' })
      expect(res.headers['content-encoding']).toBeUndefined()
      expect(res.headers.vary).toBeUndefined()
      expect(res.body.toString()).toBe('{"ok":1}')
    })

    it('sends a tiny body of unknown length raw, so it does not grow (/api/health measured 15 B -> 19 B)', async () => {
      const res = await rawRequest(`${baseUrl}/tiny-unknown-length`, { 'accept-encoding': 'br' })
      expect(res.headers['content-encoding']).toBeUndefined()
      expect(res.headers['content-length']).toBe('15')
      expect(res.body.toString()).toBe('{"status":"ok"}')
    })

    it('respects Cache-Control: no-transform', async () => {
      const res = await rawRequest(`${baseUrl}/no-transform`, { 'accept-encoding': 'br' })
      expect(res.headers['content-encoding']).toBeUndefined()
      expect(res.body.toString()).toBe(BIG_HTML)
    })

    it('does not encode a 304', async () => {
      const res = await rawRequest(`${baseUrl}/not-modified`, { 'accept-encoding': 'br' })
      expect(res.status).toBe(304)
      expect(res.headers['content-encoding']).toBeUndefined()
    })
  })
})

describe('precompressDirectory', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'web-precompress-'))
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('deletes a stale sibling when its file no longer qualifies', async () => {
    await writeFile(join(dir, 'manifest.webmanifest'), BIG_JS)
    await precompressDirectory(dir)
    await expect(stat(join(dir, 'manifest.webmanifest.br'))).resolves.toBeTruthy()

    await writeFile(join(dir, 'manifest.webmanifest'), '{"name":"x"}')
    await precompressDirectory(dir)
    await expect(stat(join(dir, 'manifest.webmanifest.br'))).rejects.toThrow()
    await expect(stat(join(dir, 'manifest.webmanifest.gz'))).rejects.toThrow()
  })

  it('does not compress its own output or binary formats', async () => {
    await writeFile(join(dir, 'a.js'), BIG_JS)
    await writeFile(join(dir, 'b.png'), Buffer.alloc(4096, 1))
    await precompressDirectory(dir)
    await precompressDirectory(dir)
    await expect(stat(join(dir, 'a.js.br.br'))).rejects.toThrow()
    await expect(stat(join(dir, 'b.png.br'))).rejects.toThrow()
  })
})
