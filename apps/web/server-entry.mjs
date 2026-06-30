// @ts-check
/**
 * Production server entrypoint (Story 5-2, AC-1).
 *
 * The `vite build` output (`dist/server/server.js`) is a web-standard `fetch`
 * handler with NO socket listener, and it does not serve the static
 * `dist/client/` assets. DanubeData Rapids (Knative) routes requests to a
 * container that MUST listen on `$PORT` (default 8080). This entry produces that
 * self-listening process: it binds `0.0.0.0:$PORT`, serves `dist/client/`
 * assets, and delegates SSR + `/api/*` to the built fetch handler.
 *
 * Approach (b) from AC-1: a thin entry over the exported `server.fetch` default,
 * served via a zero-dependency `node:http` ⇄ web-fetch adapter
 * (`src/server/node-adapter.mjs`). No extra runtime dependency, no transpile
 * step — `node server-entry.mjs` runs as-is.
 *
 * Run locally:
 *   pnpm --filter web build && PORT=8080 pnpm --filter web start
 */

import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// Default export is the Start server object: `{ fetch(request) => Response }`.
import server from './dist/server/server.js'
import { createRequestListener } from './src/server/node-adapter.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const clientDir = join(here, 'dist', 'client')

const DEFAULT_PORT = 8080
const SHUTDOWN_TIMEOUT_MS = 10_000

/**
 * Parse `$PORT` to a valid TCP port, falling back to 8080. Guards two failure
 * modes Knative would route straight into: a non-numeric/empty value (which makes
 * `listen()` throw `ERR_SOCKET_BAD_PORT` at boot) and `PORT=0` (which silently
 * binds a random ephemeral port the platform never probes).
 *
 * @param {string | undefined} raw
 * @returns {number}
 */
function parsePort(raw) {
  const parsed = Number(raw)
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) {
    return parsed
  }
  if (raw !== undefined && raw !== '') {
    console.warn(`[server-entry] invalid PORT "${raw}"; falling back to ${DEFAULT_PORT}`)
  }
  return DEFAULT_PORT
}

const port = parsePort(process.env['PORT'])
const host = process.env['HOST'] || '0.0.0.0'

const listener = createRequestListener({
  fetchHandler: (request) => server.fetch(request),
  clientDir,
})

const httpServer = createServer(listener)

// Surface bind failures (EADDRINUSE / EACCES) as a controlled, logged exit
// rather than an opaque unhandled 'error' event.
httpServer.on('error', (err) => {
  console.error('[server-entry] HTTP server error:', err)
  process.exit(1)
})

httpServer.listen(port, host, () => {
  // Plain console: the structured logger (5-5) wraps request/app logs; this is a
  // one-time boot line for container/platform startup visibility.
  console.log(`[server-entry] budget-planner listening on http://${host}:${port}`)
})

// Graceful shutdown so Rapids scale-to-zero / rolling deploys drain cleanly.
let shuttingDown = false
for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM'])) {
  process.on(signal, () => {
    if (shuttingDown) {
      return
    }
    shuttingDown = true
    console.log(`[server-entry] ${signal} received; draining…`)
    httpServer.close(() => process.exit(0))
    // Close idle keep-alive sockets so `close()`'s callback can actually fire,
    // and hard-cap the drain so a stuck request can't outlast the grace window.
    httpServer.closeIdleConnections()
    setTimeout(() => {
      console.warn('[server-entry] drain timed out; forcing exit')
      process.exit(1)
    }, SHUTDOWN_TIMEOUT_MS).unref()
  })
}
