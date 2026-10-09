import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { connect } from 'node:net'
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
	await writeFile(join(clientDir, 'favicon-32.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
	await writeFile(join(clientDir, 'favicon.ico'), Buffer.from([0x00, 0x00, 0x01, 0x00]))
	await writeFile(join(clientDir, 'manifest.webmanifest'), '{"name":"Budget Planner"}')
	await writeFile(join(clientDir, 'sw.js'), '/* service worker */')
	await writeFile(join(clientDir, 'workbox-abc123.js'), '/* workbox runtime */')
	await writeFile(
		join(clientDir, 'sitemap.xml'),
		'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"/>'
	)
})

afterAll(async () => {
	await rm(clientDir, { recursive: true, force: true })
})

describe('resolveStaticAsset', () => {
	it.each([
		['a path with no matching file', { path: '/does-not-exist.js' }],
		['the root path (SSR must handle it, no index.html)', { path: '/' }],
		['malformed percent-encoding rather than throwing', { path: '/%E0%A4%A' }],
	])('returns null for %s', async (_title, { path }) => {
		expect(await resolveStaticAsset(path, clientDir)).toBeNull()
	})

	it.each([
		[
			'serves hashed /assets/* files as immutable',
			{
				path: '/assets/app-abc123.js',
				contentType: 'text/javascript; charset=utf-8',
				cacheControl: 'public, max-age=31536000, immutable',
			},
		],
		[
			'serves non-hashed root files with a short cache lifetime',
			{
				path: '/favicon.svg',
				contentType: 'image/svg+xml',
				cacheControl: 'public, max-age=3600',
			},
		],
		[
			'serves the PNG favicon fallback with the image/png MIME type',
			{
				path: '/favicon-32.png',
				contentType: 'image/png',
				cacheControl: 'public, max-age=3600',
			},
		],
		[
			'serves the legacy .ico favicon with the image/x-icon MIME type',
			{
				path: '/favicon.ico',
				contentType: 'image/x-icon',
				cacheControl: 'public, max-age=3600',
			},
		],
		[
			'serves the PWA manifest as application/manifest+json',
			{
				path: '/manifest.webmanifest',
				contentType: 'application/manifest+json',
				cacheControl: 'public, max-age=3600',
			},
		],
		[
			'serves the sitemap as application/xml, not a binary download',
			{
				path: '/sitemap.xml',
				contentType: 'application/xml; charset=utf-8',
				cacheControl: 'public, max-age=3600',
			},
		],
		[
			'serves the service worker (/sw.js) with no-cache so redeploys are not stale',
			{
				path: '/sw.js',
				contentType: 'text/javascript; charset=utf-8',
				cacheControl: 'no-cache',
			},
		],
		// `/assets/..%2fsw.js` resolves to sw.js on disk; following the `/assets/` prefix instead
		// would serve the service worker immutable.
		[
			'classifies cache-control from the resolved file, not the raw pathname (encoded-slash)',
			{
				path: '/assets/..%2fsw.js',
				contentType: 'text/javascript; charset=utf-8',
				cacheControl: 'no-cache',
			},
		],
	])('%s', async (_title, { path, contentType, cacheControl }) => {
		const asset = await resolveStaticAsset(path, clientDir)
		expect(asset).not.toBeNull()
		expect(asset.contentType).toBe(contentType)
		expect(asset.cacheControl).toBe(cacheControl)
	})

	it('serves the Workbox runtime (/workbox-*.js) with no-cache', async () => {
		const asset = await resolveStaticAsset('/workbox-abc123.js', clientDir)
		expect(asset).not.toBeNull()
		expect(asset.cacheControl).toBe('no-cache')
	})

	it('keeps hashed /assets/* immutable even for a .js like sw.js name', async () => {
		const asset = await resolveStaticAsset('/assets/app-abc123.js', clientDir)
		expect(asset).not.toBeNull()
		expect(asset.cacheControl).toBe('public, max-age=31536000, immutable')
	})

	it('rejects path traversal escaping the client dir', async () => {
		expect(await resolveStaticAsset('/../../../../etc/passwd', clientDir)).toBeNull()
		expect(await resolveStaticAsset('/assets/../../secret', clientDir)).toBeNull()
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

	it.each([
		[
			'falls back to localhost when no Host header is present',
			{
				url: '/',
				headers: {},
				expected: 'http://localhost/',
			},
		],
		[
			'honors X-Forwarded-Proto / X-Forwarded-Host from the proxy',
			{
				url: '/x',
				headers: {
					host: 'internal:8080',
					'x-forwarded-proto': 'https',
					'x-forwarded-host': 'app.example.com',
				},
				expected: 'https://app.example.com/x',
			},
		],
		[
			'takes the first hop of a comma-joined X-Forwarded-Proto',
			{
				url: '/',
				headers: { host: 'h', 'x-forwarded-proto': 'https, http' },
				expected: 'https://h/',
			},
		],
	])('%s', (_title, { url, headers, expected }) => {
		const webReq = toWebRequest({ method: 'GET', url, headers } as never)
		expect(webReq.url).toBe(expected)
	})

	it('streams a POST body through to the web Request', async () => {
		// A real Readable so `Readable.toWeb` + `duplex: 'half'` are exercised.
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

	// The global MSW setup errors on unhandled requests; re-applied each test because the global
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
		expect(body).not.toContain('kaboom')
	})
})

/**
 * `fetch()`/`new URL()` normalize `\` and `//` client-side, so only a raw socket can send a
 * target that reaches the server as `/\…`.
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
		// Without this MSW answers loopback requests and the assertions measure the mock.
		mswServer.use(http.all(/^http:\/\/127\.0\.0\.1:\d+\//, () => passthrough()))
	})

	it('serves `//` instead of throwing ERR_INVALID_URL', async () => {
		expect(await rawRequestStatus(host, port, '//')).toBe(200)
	})

	// WHATWG `URL` treats `\` as `/`, so an uncollapsed `/\host/x` would resolve to another host
	// (or throw). Must go over a raw socket since fetch normalizes it client-side.
	it.each(['/\\', '/\\evil.example/x', '//\\evil.example/x', '/\\\\double'])(
		'does not 500 on a backslash-prefixed target (%j)',
		async (target) => {
			expect(await rawRequestStatus(host, port, target)).toBe(200)
		}
	)

	it('treats `//host/path` as a PATH, never as an authority', async () => {
		// Uncollapsed, `new URL('//evil.example/x', base)` yields host evil.example, so the static
		// matcher would match a path the client never asked for.
		const slashRes = await fetch(`${baseUrl}//evil.example/x`)
		expect(slashRes.status).toBe(200)
		expect(seenPaths.at(-1)).toBe('//evil.example/x')
	})

	it('a `\\host/asset` target is not served as that static asset (no authority confusion)', async () => {
		// The stub answers 200 with no cache-control; a served file would set it.
		seenPaths.length = 0
		expect(await rawRequestStatus(host, port, '/\\evil.example/favicon.svg')).toBe(200)
		expect(seenPaths).toHaveLength(1)
	})

	it('still serves an ordinary static asset from disk (not a handler fall-through)', async () => {
		seenPaths.length = 0
		const asset = await fetch(`${baseUrl}/assets/app-abc123.js`)
		expect(asset.status).toBe(200)
		// Only serveStaticFile sets immutable cache-control, distinguishing a real serve from the stub.
		expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
		expect(await asset.text()).toBe('console.log(1)')
		expect(seenPaths).toHaveLength(0)

		expect((await fetch(`${baseUrl}/`)).status).toBe(200)
	})
})
