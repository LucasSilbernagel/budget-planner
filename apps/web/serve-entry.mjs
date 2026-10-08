// @ts-check
// The built server is a fetch handler with no listener and no static serving; this binds
// $PORT, serves dist/client and delegates the rest to it.

// Reached only through server-entry's dynamic import, so the migrate process never
// loads the app server.

import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import server from './dist/server/server.js'
import { createRequestListener } from './src/server/node-adapter.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const clientDir = join(here, 'dist', 'client')

const DEFAULT_PORT = 8080
const SHUTDOWN_TIMEOUT_MS = 10_000

// Guards a non-numeric PORT (listen() throws at boot) and PORT=0 (a random port the
// platform never probes).
/**
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

httpServer.on('error', (err) => {
  console.error('[server-entry] HTTP server error:', err)
  process.exit(1)
})

httpServer.listen(port, host, () => {
  console.log(`[server-entry] budget-planner listening on http://${host}:${port}`)
})

let shuttingDown = false
for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM'])) {
  process.on(signal, () => {
    if (shuttingDown) {
      return
    }
    shuttingDown = true
    console.log(`[server-entry] ${signal} received; draining…`)
    httpServer.close(() => process.exit(0))
    // Close idle keep-alive sockets so close()'s callback can fire; hard-cap the drain.
    httpServer.closeIdleConnections()
    setTimeout(() => {
      console.warn('[server-entry] drain timed out; forcing exit')
      process.exit(1)
    }, SHUTDOWN_TIMEOUT_MS).unref()
  })
}
