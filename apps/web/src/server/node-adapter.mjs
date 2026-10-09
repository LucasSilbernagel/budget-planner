// @ts-check
/** Serves dist/client files from disk and delegates the rest to the Start fetch handler, which has no listener. */

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, normalize, relative, sep } from 'node:path'
import { pipeline, Readable } from 'node:stream'
import { createBrotliCompress, createGzip, constants as zlibConstants } from 'node:zlib'

/**
 * Nothing on the request path compresses, so static assets use build-time .br/.gz
 * siblings and handler responses are compressed on the fly.
 */

/** @typedef {'br' | 'gzip'} Encoding */

/** Below ~1 KB the encoding overhead outweighs the bytes saved. */
export const MIN_COMPRESS_BYTES = 1024

/** The only extensions whose precompressed siblings are served; images and fonts are already compressed. */
export const PRECOMPRESSED_EXTENSIONS = new Set([
	'.js',
	'.mjs',
	'.css',
	'.html',
	'.json',
	'.svg',
	'.txt',
	'.xml',
	'.webmanifest',
	'.wasm',
])

/** @type {Record<Encoding, string>} */
const ENCODING_SUFFIX = { br: '.br', gzip: '.gz' }

/**
 * Brotli when accepted at least as strongly as gzip; `q=0` refuses, `*` covers unnamed codings.
 * @param {string | string[] | undefined} header
 * @returns {Encoding | null}
 */
export function negotiateEncoding(header) {
	const raw = Array.isArray(header) ? header.join(',') : header
	if (!raw) {
		return null
	}
	/** @type {Map<string, number>} */
	const weights = new Map()
	for (const part of raw.split(',')) {
		const [name, ...params] = part.trim().toLowerCase().split(';')
		if (!name) {
			continue
		}
		let q = 1
		for (const param of params) {
			const [key, value] = param.trim().split('=')
			if (key === 'q') {
				const parsed = Number(value)
				q = Number.isFinite(parsed) ? parsed : 0
			}
		}
		weights.set(name.trim(), q)
	}
	/** @param {string} name */
	const weight = (name) => weights.get(name) ?? weights.get('*') ?? 0
	const br = weight('br')
	const gzip = weight('gzip')
	if (br > 0 && br >= gzip) {
		return 'br'
	}
	if (gzip > 0) {
		return 'gzip'
	}
	return null
}

/**
 * `text/event-stream` is excluded: an encoder would hold events back.
 * @param {string | null} contentType
 */
export function isCompressibleType(contentType) {
	if (!contentType) {
		return false
	}
	const type = (contentType.split(';')[0] ?? '').trim().toLowerCase()
	if (type === 'text/event-stream') {
		return false
	}
	return (
		type.startsWith('text/') ||
		type === 'application/json' ||
		type === 'application/javascript' ||
		type === 'application/xml' ||
		type === 'application/manifest+json' ||
		type === 'image/svg+xml' ||
		type.endsWith('+json') ||
		type.endsWith('+xml')
	)
}

/** @param {string | number | string[] | undefined} existing */
function withVaryAcceptEncoding(existing) {
	const current = Array.isArray(existing) ? existing.join(', ') : existing ? String(existing) : ''
	const names = current
		.split(',')
		.map((name) => name.trim())
		.filter(Boolean)
	if (names.includes('*') || names.some((name) => name.toLowerCase() === 'accept-encoding')) {
		return current
	}
	return [...names, 'Accept-Encoding'].join(', ')
}

/**
 * Every write is flushed so streamed SSR still arrives chunk by chunk; brotli quality 5 (11 is too slow per request).
 * @param {Encoding} encoding
 */
function createEncoder(encoding) {
	if (encoding === 'br') {
		return createBrotliCompress({
			flush: zlibConstants.BROTLI_OPERATION_FLUSH,
			params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 },
		})
	}
	return createGzip({ flush: zlibConstants.Z_SYNC_FLUSH })
}

/** @type {Record<string, string>} */
const CONTENT_TYPES = {
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.html': 'text/html; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.map': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.ico': 'image/x-icon',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.avif': 'image/avif',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.txt': 'text/plain; charset=utf-8',
	'.wasm': 'application/wasm',
	// Browsers reject a manifest served as application/octet-stream.
	'.webmanifest': 'application/manifest+json',
	// Otherwise crawlers get an octet-stream download; e2e runs the Vite dev server, so can't catch it.
	'.xml': 'application/xml; charset=utf-8',
}

/** @param {string} ext file extension including the leading dot */
function contentTypeFor(ext) {
	return CONTENT_TYPES[ext.toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Root-level SW scripts must not get a long cache: a stale service worker keeps an old build alive.
 * @param {string} pathname
 */
function isServiceWorkerScript(pathname) {
	return pathname === '/sw.js' || /^\/workbox-[^/]+\.js$/.test(pathname)
}

/** @param {string} pathname */
function cacheControlFor(pathname) {
	if (isServiceWorkerScript(pathname)) {
		// Always revalidate so a redeploy's new SW is picked up promptly.
		return 'no-cache'
	}
	return pathname.startsWith('/assets/')
		? 'public, max-age=31536000, immutable'
		: 'public, max-age=3600'
}

/** @typedef {{ filePath: string, contentType: string, cacheControl: string, size: number, compressible: boolean, variants: Partial<Record<Encoding, { filePath: string, size: number }>> }} StaticAsset */

/**
 * @param {string} pathname may be percent-encoded
 * @param {string} clientDir
 * @returns {Promise<StaticAsset | null>}
 */
export async function resolveStaticAsset(pathname, clientDir) {
	let decoded
	try {
		decoded = decodeURIComponent(pathname)
	} catch {
		return null
	}

	const root = normalize(clientDir)
	const candidate = normalize(join(root, decoded))
	if (candidate !== root && !candidate.startsWith(root + sep)) {
		return null
	}

	let stats
	try {
		stats = await stat(candidate)
	} catch {
		return null
	}
	if (!stats.isFile()) {
		return null
	}

	// Classify from the resolved path, not the raw pathname: `/assets/..%2fsw.js`
	// resolves to sw.js and must not be tagged immutable.
	const resolvedPathname = `/${relative(root, candidate).split(sep).join('/')}`
	const cacheControl = cacheControlFor(resolvedPathname)

	const compressible = PRECOMPRESSED_EXTENSIONS.has(extname(candidate).toLowerCase())
	/** @type {StaticAsset['variants']} */
	const variants = {}
	if (compressible) {
		for (const encoding of /** @type {Encoding[]} */ (['br', 'gzip'])) {
			const variantPath = candidate + ENCODING_SUFFIX[encoding]
			try {
				const variantStats = await stat(variantPath)
				// A sibling older than its file came from a previous build (sw.js keeps its
				// name), so serve the file itself.
				if (variantStats.isFile() && variantStats.mtimeMs >= stats.mtimeMs) {
					variants[encoding] = { filePath: variantPath, size: variantStats.size }
				}
			} catch {}
		}
	}

	return {
		filePath: candidate,
		contentType: contentTypeFor(extname(candidate)),
		cacheControl,
		size: stats.size,
		compressible,
		variants,
	}
}

/** @param {string | string[] | undefined} value */
function firstForwardedValue(value) {
	if (value === undefined) {
		return
	}
	const raw = Array.isArray(value) ? value[0] : value
	const first = raw?.split(',')[0]?.trim()
	return first || undefined
}

/**
 * Honors X-Forwarded-Proto/Host from the TLS edge so request.url has the public scheme and host.
 * @param {import('node:http').IncomingMessage} nodeReq
 * @param {{ protocol?: string }} [options]
 * @returns {Request}
 */
export function toWebRequest(nodeReq, options = {}) {
	const protocol =
		options.protocol ?? firstForwardedValue(nodeReq.headers['x-forwarded-proto']) ?? 'http'
	const host =
		firstForwardedValue(nodeReq.headers['x-forwarded-host']) ?? nodeReq.headers.host ?? 'localhost'
	const url = `${protocol}://${host}${nodeReq.url ?? '/'}`

	const headers = new Headers()
	for (const [key, value] of Object.entries(nodeReq.headers)) {
		if (Array.isArray(value)) {
			for (const item of value) {
				headers.append(key, item)
			}
		} else if (value !== undefined) {
			headers.set(key, value)
		}
	}

	const method = nodeReq.method ?? 'GET'
	/** @type {RequestInit} */
	const init = { method, headers }
	if (method !== 'GET' && method !== 'HEAD') {
		init.body = /** @type {ReadableStream} */ (Readable.toWeb(nodeReq))
		// Required for a streaming request body.
		init.duplex = 'half'
	}
	return new Request(url, init)
}

/**
 * Set-Cookie is written as discrete headers: Headers.forEach comma-joins them, corrupting cookies.
 * @param {import('node:http').ServerResponse} nodeRes
 * @param {Response} webResponse
 * @param {Encoding | null} [encoding]
 */
async function applyWebResponse(nodeRes, webResponse, encoding = null) {
	nodeRes.statusCode = webResponse.status

	const setCookies =
		typeof webResponse.headers.getSetCookie === 'function' ? webResponse.headers.getSetCookie() : []
	webResponse.headers.forEach((value, key) => {
		if (key.toLowerCase() === 'set-cookie') {
			return
		}
		nodeRes.setHeader(key, value)
	})
	if (setCookies.length > 0) {
		nodeRes.setHeader('set-cookie', setCookies)
	}

	if (webResponse.body && isEligibleForCompression(webResponse)) {
		nodeRes.setHeader('vary', withVaryAcceptEncoding(nodeRes.getHeader('vary')))
		if (encoding) {
			const source = Readable.fromWeb(/** @type {any} */ (webResponse.body))
			// Most responses carry no content-length, so read up to MIN_COMPRESS_BYTES first:
			// a tiny body would grow when encoded.
			const head = await readHead(source, MIN_COMPRESS_BYTES)
			if (head.ended) {
				const body = Buffer.concat(head.chunks)
				nodeRes.setHeader('content-length', body.length)
				nodeRes.end(body)
				return
			}
			// The encoded length is unknown up front; Node falls back to chunked.
			nodeRes.removeHeader('content-length')
			nodeRes.setHeader('content-encoding', encoding)
			const encoder = createEncoder(encoding)
			for (const chunk of head.chunks) {
				encoder.write(chunk)
			}
			pipeline(source, encoder, nodeRes, onStreamDone)
			return
		}
	}

	if (webResponse.body) {
		// `pipeline`, not `.pipe`, so the source is destroyed when the client aborts.
		pipeline(Readable.fromWeb(/** @type {any} */ (webResponse.body)), nodeRes, onStreamDone)
	} else {
		nodeRes.end()
	}
}

/** @param {Response} webResponse */
function isEligibleForCompression(webResponse) {
	const { headers, status } = webResponse
	if (status === 204 || status === 206 || status === 304) {
		return false
	}
	if (headers.has('content-encoding') || !isCompressibleType(headers.get('content-type'))) {
		return false
	}
	if (/\bno-transform\b/i.test(headers.get('cache-control') ?? '')) {
		return false
	}
	const length = headers.get('content-length')
	return length === null || Number(length) >= MIN_COMPRESS_BYTES
}

/**
 * On a non-ended result the stream is left paused with the rest unread, for the caller to pipe on.
 * @param {import('node:stream').Readable} source
 * @param {number} min
 * @returns {Promise<{ chunks: Uint8Array[], ended: boolean }>}
 */
function readHead(source, min) {
	return new Promise((resolve, reject) => {
		/** @type {Uint8Array[]} */
		const chunks = []
		let size = 0
		const cleanup = () => {
			source.off('data', onData)
			source.off('end', onEnd)
			source.off('error', onError)
		}
		/** @param {Uint8Array} chunk */
		const onData = (chunk) => {
			chunks.push(chunk)
			size += chunk.length
			if (size >= min) {
				cleanup()
				source.pause()
				resolve({ chunks, ended: false })
			}
		}
		const onEnd = () => {
			cleanup()
			resolve({ chunks, ended: true })
		}
		/** @param {Error} error */
		const onError = (error) => {
			cleanup()
			reject(error)
		}
		source.on('data', onData)
		source.on('end', onEnd)
		source.on('error', onError)
	})
}

/**
 * Client disconnects are expected and noisy, so only genuine errors are logged.
 * @param {NodeJS.ErrnoException | null} err
 */
function onStreamDone(err) {
	if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE' && err.code !== 'ECONNRESET') {
		console.error('[server-entry] response stream failed:', err)
	}
}

/**
 * @param {import('node:http').ServerResponse} nodeRes
 * @param {StaticAsset} asset
 * @param {boolean} isHead
 * @param {Encoding | null} encoding
 */
function serveStaticFile(nodeRes, asset, isHead, encoding) {
	const variant = encoding ? asset.variants[encoding] : undefined
	nodeRes.statusCode = 200
	nodeRes.setHeader('content-type', asset.contentType)
	nodeRes.setHeader('cache-control', asset.cacheControl)
	if (asset.compressible) {
		nodeRes.setHeader('vary', 'Accept-Encoding')
	}
	if (variant && encoding) {
		nodeRes.setHeader('content-encoding', encoding)
	}
	nodeRes.setHeader('content-length', variant ? variant.size : asset.size)
	if (isHead) {
		nodeRes.end()
		return
	}
	pipeline(createReadStream(variant ? variant.filePath : asset.filePath), nodeRes, onStreamDone)
}

/** @param {{ fetchHandler: (request: Request) => Promise<Response> | Response, clientDir: string }} args */
export function createRequestListener({ fetchHandler, clientDir }) {
	/** @type {(nodeReq: import('node:http').IncomingMessage, nodeRes: import('node:http').ServerResponse) => Promise<void>} */
	return async function listener(nodeReq, nodeRes) {
		try {
			const method = nodeReq.method ?? 'GET'
			const encoding = negotiateEncoding(nodeReq.headers['accept-encoding'])
			if (method === 'GET' || method === 'HEAD') {
				// Collapse leading `/` and `\` runs first: a `//` or `/\` prefix parses as
				// protocol-relative (the rest becomes the authority) or throws ERR_INVALID_URL.
				const rawTarget = nodeReq.url ?? '/'
				const requestTarget = rawTarget.replace(/^[/\\]+/, '/')
				const { pathname } = new URL(requestTarget, 'http://localhost')
				const asset = await resolveStaticAsset(pathname, clientDir)
				if (asset) {
					serveStaticFile(nodeRes, asset, method === 'HEAD', encoding)
					return
				}
			}

			const webResponse = await fetchHandler(toWebRequest(nodeReq))
			await applyWebResponse(nodeRes, webResponse, method === 'HEAD' ? null : encoding)
		} catch (error) {
			// Never leak internals to the client; surface to container logs.
			console.error('[server-entry] request handling failed:', error)
			if (nodeRes.headersSent) {
				// Response already in flight: a body would corrupt it, so tear the socket down.
				nodeRes.destroy()
				return
			}
			nodeRes.statusCode = 500
			nodeRes.setHeader('content-type', 'text/plain; charset=utf-8')
			nodeRes.end('Internal Server Error')
		}
	}
}
