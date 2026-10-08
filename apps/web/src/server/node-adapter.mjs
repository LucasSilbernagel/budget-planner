// @ts-check
/**
 * Node `http` ⇄ web-`fetch` adapter for the production server entrypoint
 * (Story 5-2, AC-1).
 *
 * The TanStack Start build (`dist/server/server.js`) exports a web-standard
 * `fetch(Request) => Response` handler with NO socket listener, and it does not
 * serve the static `dist/client/` assets. DanubeData Rapids (Knative) routes
 * traffic to a container that must listen on `$PORT`. This module bridges the
 * two: it serves real `dist/client/` files from disk and delegates everything
 * else to the Start fetch handler, so a plain `node:http` server can front the
 * whole app.
 *
 * Authored as runtime ESM (`.mjs`) so the production entrypoint runs with no
 * build/transpile step; `@ts-check` + JSDoc keep it type-safe. The pure helpers
 * are exported for unit testing.
 */

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, normalize, relative, sep } from 'node:path'
import { Readable, pipeline } from 'node:stream'
import { constants as zlibConstants, createBrotliCompress, createGzip } from 'node:zlib'

/**
 * Response compression. Production measured 2026-10-02: nothing on the request
 * path compresses (no `content-encoding` from the app or the Envoy edge), so the
 * 521 KB entry chunk went out raw where gzip makes it 159 KB.
 *
 * Static assets are compressed ONCE at build time (`scripts/precompress.mjs`
 * writes `.br` / `.gz` siblings) and picked here by `Accept-Encoding`. Responses
 * from the Start handler (SSR HTML, `/api/*` JSON) are compressed on the fly.
 */

/** @typedef {'br' | 'gzip'} Encoding */

/**
 * Bodies smaller than this are sent as-is: below ~1 KB the encoding overhead
 * and CPU outweigh the bytes saved.
 */
export const MIN_COMPRESS_BYTES = 1024

/**
 * Extensions `scripts/precompress.mjs` writes `.br` / `.gz` siblings for, and
 * the only ones whose siblings the adapter will serve. Images and fonts are
 * already compressed formats.
 */
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
 * Pick the response encoding from an `Accept-Encoding` header: brotli when the
 * client accepts it at least as strongly as gzip, else gzip, else none. A `q=0`
 * refuses a coding; `*` covers any coding not named. A missing header means
 * identity (what every client that cannot decode gets).
 *
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
 * Whether a response with this content type is worth compressing on the fly.
 * `text/event-stream` is excluded: an encoder would hold events back.
 *
 * @param {string | null} contentType
 * @returns {boolean}
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

/**
 * Add `Accept-Encoding` to a `Vary` value, keeping what is already there.
 *
 * @param {string | number | string[] | undefined} existing
 * @returns {string}
 */
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
 * A streaming encoder for an on-the-fly response. Every write is flushed so a
 * streamed SSR document still reaches the browser chunk by chunk instead of
 * waiting in the encoder's buffer. Brotli runs at quality 5, not the default
 * 11, which is built for one-off static compression and far too slow per
 * request.
 *
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

/**
 * Content types for the asset extensions the client build emits. Anything not
 * listed falls back to `application/octet-stream`.
 *
 * @type {Record<string, string>}
 */
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
  // PWA web app manifest (story 7-1). Browsers reject the manifest unless it is
  // served as JSON/manifest+json; without this it would fall back to
  // application/octet-stream and the install prompt would never appear.
  '.webmanifest': 'application/manifest+json',
  // sitemap.xml (story seo-1). Without this a crawler is handed an
  // application/octet-stream download. e2e cannot catch it — it runs the Vite
  // dev server, not this adapter.
  '.xml': 'application/xml; charset=utf-8',
}

/**
 * @param {string} ext file extension including the leading dot
 * @returns {string}
 */
function contentTypeFor(ext) {
  return CONTENT_TYPES[ext.toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Root-level service-worker scripts emitted by vite-plugin-pwa / Workbox
 * (`/sw.js` and the `/workbox-<hash>.js` runtime). These must NOT be pinned by a
 * long cache: a stale service worker can otherwise keep an old build alive and
 * defeat the auto-update / no-stale-build guarantee (story 7-1, AC-4). Matched
 * at the client root only — hashed `/assets/*` chunks stay immutable.
 *
 * @param {string} pathname URL pathname
 * @returns {boolean}
 */
function isServiceWorkerScript(pathname) {
  return pathname === '/sw.js' || /^\/workbox-[^/]+\.js$/.test(pathname)
}

/**
 * Resolve the Cache-Control header for a static asset path.
 *
 * @param {string} pathname URL pathname
 * @returns {string}
 */
function cacheControlFor(pathname) {
  if (isServiceWorkerScript(pathname)) {
    // Always revalidate so a redeploy's new SW is picked up promptly (AC-4).
    return 'no-cache'
  }
  return pathname.startsWith('/assets/')
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=3600'
}

/**
 * @typedef {Object} StaticAsset
 * @property {string} filePath absolute path to the file on disk
 * @property {string} contentType resolved MIME type
 * @property {string} cacheControl Cache-Control header value
 * @property {number} size byte length (for Content-Length)
 * @property {boolean} compressible whether the type has precompressed siblings,
 *   so the response varies by `Accept-Encoding`
 * @property {Partial<Record<Encoding, { filePath: string, size: number }>>} variants
 *   precompressed siblings that exist and are not older than the file itself
 */

/**
 * Resolve a request path to a concrete static file under `clientDir`, or `null`
 * if there is no safe matching file (so the caller falls back to SSR).
 *
 * Defense in depth against path traversal: the decoded path is joined to the
 * client dir, normalized, and rejected unless it stays within the client dir.
 * Hashed `/assets/*` files are immutable; other files get a short cache.
 *
 * @param {string} pathname URL pathname (may be percent-encoded)
 * @param {string} clientDir absolute path to `dist/client`
 * @returns {Promise<StaticAsset | null>}
 */
export async function resolveStaticAsset(pathname, clientDir) {
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    // Malformed percent-encoding — never a valid asset path.
    return null
  }

  const root = normalize(clientDir)
  const candidate = normalize(join(root, decoded))
  // Must be the root itself or strictly contained within it.
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

  // Classify cache-control from the RESOLVED path (relative to the client root),
  // never the raw request pathname. An encoded-slash request like
  // `/assets/..%2fsw.js` decodes+normalizes to `sw.js` on disk, but its raw
  // pathname still starts with `/assets/` — classifying off that would mis-tag the
  // service worker as `immutable` and defeat the AC-4 no-stale guarantee for any
  // shared/CDN cache. Deriving from `candidate` keeps the header consistent with
  // the bytes actually served.
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
        // A sibling older than its file was compressed from a previous build's
        // bytes (e.g. `sw.js`, which keeps its name across builds): serving it
        // would ship stale content, so fall back to the file itself.
        if (variantStats.isFile() && variantStats.mtimeMs >= stats.mtimeMs) {
          variants[encoding] = { filePath: variantPath, size: variantStats.size }
        }
      } catch {
        // No sibling for this encoding.
      }
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

/**
 * First hop of a possibly multi-valued / comma-joined forwarded header.
 *
 * @param {string | string[] | undefined} value
 * @returns {string | undefined}
 */
function firstForwardedValue(value) {
  if (value === undefined) {
    return undefined
  }
  const raw = Array.isArray(value) ? value[0] : value
  const first = raw?.split(',')[0]?.trim()
  return first || undefined
}

/**
 * Convert a Node `IncomingMessage` into a web-standard `Request`.
 *
 * Behind the DanubeData Rapids / Knative TLS terminator the edge proxy sets
 * `X-Forwarded-Proto` / `X-Forwarded-Host`; honor them so `request.url` reflects
 * the real public scheme + host (matters for cookie-`Secure`, canonical-URL, and
 * redirect logic). Fall back to the direct connection's scheme/`Host` when the
 * forwarded headers are absent.
 *
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
    // Stream the request body through; `duplex: 'half'` is required by the spec
    // when sending a streaming body (not yet in the lib DOM types).
    init.body = /** @type {ReadableStream} */ (Readable.toWeb(nodeReq))
    // @ts-expect-error duplex is valid at runtime but missing from RequestInit
    init.duplex = 'half'
  }
  return new Request(url, init)
}

/**
 * Write a web-standard `Response` back to a Node `ServerResponse`.
 *
 * Set-Cookie is emitted as discrete headers — `Headers.forEach` collapses
 * multiple Set-Cookie values into one comma-joined string, which corrupts
 * cookies (notably the signed session cookie from stories 5-7/5-8).
 *
 * When `encoding` is given and the response is compressible text of unknown or
 * at least `MIN_COMPRESS_BYTES` length, the body is compressed on the fly.
 *
 * @param {import('node:http').ServerResponse} nodeRes
 * @param {Response} webResponse
 * @param {Encoding | null} [encoding] the client's negotiated encoding
 * @returns {Promise<void>}
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
      // Most responses (Start's `json()` included) carry no content-length, so
      // read until MIN_COMPRESS_BYTES before deciding: a tiny body such as
      // `/api/health`'s 15 bytes would otherwise GROW when encoded.
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
    // `pipeline` (not `.pipe`) so the source stream is destroyed when the client
    // aborts mid-response — a bare `.pipe` leaks the open handle / keeps pulling.
    pipeline(Readable.fromWeb(/** @type {any} */ (webResponse.body)), nodeRes, onStreamDone)
  } else {
    nodeRes.end()
  }
}

/**
 * Whether a handler response may be compressed: compressible type, not already
 * encoded, not forbidden by `no-transform`, a status that carries a full body,
 * and not known to be under `MIN_COMPRESS_BYTES`.
 *
 * @param {Response} webResponse
 * @returns {boolean}
 */
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
 * Read from `source` until at least `min` bytes arrived or it ended. On a
 * non-ended result the stream is left paused with the rest unread, for the
 * caller to pipe on.
 *
 * @param {Readable} source
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
 * `pipeline` completion callback. It destroys both streams on error/abort
 * (fixing the bare-`.pipe` leak); client disconnects are expected and noisy, so
 * only genuine errors are surfaced to the container logs.
 *
 * @param {NodeJS.ErrnoException | null} err
 */
function onStreamDone(err) {
  if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE' && err.code !== 'ECONNRESET') {
    console.error('[server-entry] response stream failed:', err)
  }
}

/**
 * Stream a resolved static file to the response.
 *
 * @param {import('node:http').ServerResponse} nodeRes
 * @param {StaticAsset} asset
 * @param {boolean} isHead
 * @param {Encoding | null} encoding the client's negotiated encoding
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
  // `pipeline` destroys the file stream on client abort / write error (no fd leak).
  pipeline(createReadStream(variant ? variant.filePath : asset.filePath), nodeRes, onStreamDone)
}

/**
 * Build a Node request listener that serves `dist/client/` static assets and
 * delegates everything else to the provided web-`fetch` handler.
 *
 * @param {Object} args
 * @param {(request: Request) => Promise<Response> | Response} args.fetchHandler
 * @param {string} args.clientDir absolute path to `dist/client`
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>}
 */
export function createRequestListener({ fetchHandler, clientDir }) {
  return async function listener(nodeReq, nodeRes) {
    try {
      const method = nodeReq.method ?? 'GET'
      const encoding = negotiateEncoding(nodeReq.headers['accept-encoding'])
      if (method === 'GET' || method === 'HEAD') {
        // `URL` resolves any `..` segments, so static matching uses the
        // normalized pathname (query string excluded).
        //
        // ⚠️ Leading `/` and `\` runs are collapsed to a single `/` FIRST.
        // Resolved against a base, a target that starts with `//` (or `/\`, or
        // `\\` — WHATWG treats `\` as `/` for special schemes) is parsed as
        // PROTOCOL-RELATIVE: what follows becomes the AUTHORITY, not the path.
        // So `new URL('//evil.example/x', base)` yields pathname `/x` — matching
        // a static file the client never requested — and `//` / `/\` alone
        // throw ERR_INVALID_URL, a 500 reachable by anyone.
        //
        // Found in production 2026-09-09: a trailing slash on SITE_URL made the
        // smoke check request `//`, and EVERY such request was a 500. The first
        // fix (2026-09-10) only handled a literal leading `//` and only stripped
        // `/`, so `\` variants still got through — caught in review the same day.
        // `[/\\]+` covers `//`, `/\`, `\\`, `//\…` in one unconditional pass.
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
        // Response already in flight — appending a body would corrupt it; just
        // tear the socket down.
        nodeRes.destroy()
        return
      }
      nodeRes.statusCode = 500
      nodeRes.setHeader('content-type', 'text/plain; charset=utf-8')
      nodeRes.end('Internal Server Error')
    }
  }
}
