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

  return {
    filePath: candidate,
    contentType: contentTypeFor(extname(candidate)),
    cacheControl,
    size: stats.size,
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
 * @param {import('node:http').ServerResponse} nodeRes
 * @param {Response} webResponse
 * @returns {Promise<void>}
 */
export async function applyWebResponse(nodeRes, webResponse) {
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

  if (webResponse.body) {
    // `pipeline` (not `.pipe`) so the source stream is destroyed when the client
    // aborts mid-response — a bare `.pipe` leaks the open handle / keeps pulling.
    pipeline(Readable.fromWeb(/** @type {any} */ (webResponse.body)), nodeRes, onStreamDone)
  } else {
    nodeRes.end()
  }
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
 */
function serveStaticFile(nodeRes, asset, isHead) {
  nodeRes.statusCode = 200
  nodeRes.setHeader('content-type', asset.contentType)
  nodeRes.setHeader('cache-control', asset.cacheControl)
  nodeRes.setHeader('content-length', asset.size)
  if (isHead) {
    nodeRes.end()
    return
  }
  // `pipeline` destroys the file stream on client abort / write error (no fd leak).
  pipeline(createReadStream(asset.filePath), nodeRes, onStreamDone)
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
      if (method === 'GET' || method === 'HEAD') {
        // `URL` resolves any `..` segments, so static matching uses the
        // normalized pathname (query string excluded).
        const { pathname } = new URL(nodeReq.url ?? '/', 'http://localhost')
        const asset = await resolveStaticAsset(pathname, clientDir)
        if (asset) {
          serveStaticFile(nodeRes, asset, method === 'HEAD')
          return
        }
      }

      const webResponse = await fetchHandler(toWebRequest(nodeReq))
      await applyWebResponse(nodeRes, webResponse)
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
