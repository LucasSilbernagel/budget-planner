/**
 * The served-app harness (story 84.4, FR137): the app's OWN dev server, booted
 * in-process inside Vitest, answering real HTTP requests.
 *
 * It is the same server the `chromium` e2e project starts (`vite.config.ts`:
 * the Start plugin, the `start.ts` request middleware, SSR, `public/`, the PWA
 * plugin's dev manifest), so a claim about what the server SENDS (status,
 * headers, the bytes of a page) can be pinned here without a browser.
 *
 * ⚠️ Traps, each MEASURED at story 84.4's context time or review:
 * - `port: 0` is NOT an ephemeral port in Vite 7: it binds 5173, the e2e dev
 *   server's port. A free port is reserved first and passed with `strictPort`.
 * - MSW DOES intercept `node:http` (`vitest.setup.ts` starts it with
 *   `onUnhandledRequest: 'error'`; MSW 2.x patches `http.request` on the CJS
 *   `http` object when `server.listen()` runs). The requests below escape it
 *   only because the ESM NAMED import `request` binds the ORIGINAL function at
 *   module load, before `beforeAll` patches the object (84.4 review, MEASURED:
 *   `import { request }` → 200; `http.request` via a namespace/default import →
 *   `[MSW] Cannot bypass a request…`; `fetch` → the same). Keep the named
 *   import; do not "tidy" it into `import http from 'node:http'` or `fetch`.
 * - `middlewareMode` serves no pages (the Start SSR handler is not in that
 *   stack), so the server really listens.
 * - It must not share Vite's dependency cache with the e2e dev servers (see
 *   `cacheDir` below).
 * - The Vitest env is `NODE_ENV=test`, not `development`: `start.ts`'s dev-only
 *   CORS is off here, unlike the e2e dev server. Nothing pinned here reads it.
 * - `import.meta.env.DEV` IS true in this serve-mode server, so the dev-only
 *   session seam (`server/api/auth/session-seed.ts`, `E2E_SESSION_SEED`) is
 *   live: an exported seed in the shell would render a PAID session here (the
 *   `>Premium Features</h2>` fence would go red with no hint why). It is
 *   blanked before boot, as `playwright.config.ts` does for the free server.
 *
 * One boot per test FILE (`beforeAll`, ~1 s boot + ~3 s first SSR), so keep
 * the served-response tests in a few files. Use with `// @vitest-environment node`.
 */

import { request } from 'node:http'
import { type AddressInfo, createServer as createNetServer } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type ViteDevServer, createServer } from 'vite'

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** Boot + first SSR measured at ~4 s; the slack covers a loaded gate run. */
export const SERVED_APP_TIMEOUT_MS = 60_000

/**
 * Per-test timeout for served-response files (`vi.setConfig`): a route's first
 * render compiles its own chunks, which can pass Vitest's 5 s default when the
 * gate runs e2e's servers and the prod build at the same time.
 */
export const SERVED_TEST_TIMEOUT_MS = 30_000

/**
 * Per-request socket timeout: a hanging SSR would otherwise hold the socket to
 * the test timeout and then stall `vite.close()` in `afterAll` (two reds for
 * one cause). Under the test timeout so the request error is the one reported.
 */
const REQUEST_TIMEOUT_MS = 25_000

export interface ServedResponse {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: string
}

export interface ServedApp {
  origin: string
  get(path: string): Promise<ServedResponse>
  close(): Promise<void>
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createNetServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo
      probe.close(() => resolvePort(port))
    })
  })
}

function get(origin: string, path: string): Promise<ServedResponse> {
  return new Promise((resolveResponse, reject) => {
    const req = request(
      new URL(path, origin),
      { method: 'GET', timeout: REQUEST_TIMEOUT_MS },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () =>
          resolveResponse({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        )
        res.on('error', reject)
      }
    )
    req.on('timeout', () =>
      req.destroy(new Error(`served app: no response to GET ${path} in ${REQUEST_TIMEOUT_MS} ms`))
    )
    req.on('error', reject)
    req.end()
  })
}

export async function startServedApp(): Promise<ServedApp> {
  // The dev-only session seam reads this at request time (see the header).
  process.env['E2E_SESSION_SEED'] = ''
  const port = await freePort()
  const vite: ViteDevServer = await createServer({
    configFile: resolve(WEB_ROOT, 'vite.config.ts'),
    root: WEB_ROOT,
    logLevel: 'warn',
    // ⚠️ Its OWN dependency cache (MEASURED at 84.4's close): sharing
    // `node_modules/.vite` let this test-mode server rewrite the dev server's
    // optimized deps (different config hash), so the e2e dev servers then
    // re-optimized and reloaded pages mid-test (`forecasting-seed.paid` red
    // even under `pnpm gates --sequential`).
    cacheDir: resolve(WEB_ROOT, 'node_modules/.vite-served-app'),
    server: { port, strictPort: true, host: '127.0.0.1', hmr: false, ws: false },
  })
  const origin = `http://127.0.0.1:${port}`
  try {
    await vite.listen()
    // Warm-up: the FIRST server render compiles the whole SSR graph (~3 s alone,
    // 5 s+ under a concurrent `pnpm gates`, MEASURED at 84.4's close), which
    // would otherwise land inside the first test's timeout. A 5xx here is a
    // boot failure (an SSR throw), not something for the first test to trip on.
    const warmUp = await get(origin, '/')
    if (warmUp.status >= 500) {
      throw new Error(
        `served app: warm-up GET / answered ${warmUp.status}: ${warmUp.body.slice(0, 300)}`
      )
    }
  } catch (error) {
    // `beforeAll` failed, so `afterAll`'s `app?.close()` has nothing to close:
    // release the listener and the watchers here, or they outlive the file.
    await vite.close().catch(() => {})
    throw error
  }
  return {
    origin,
    get: (path) => get(origin, path),
    close: () => vite.close(),
  }
}

/** A single response header as one string (Node lower-cases header names). */
export function header(response: ServedResponse, name: string): string | undefined {
  const value = response.headers[name.toLowerCase()]
  return Array.isArray(value) ? value.join(', ') : value
}

/** The `<head>…</head>` of a served document, so a body phrase can't match the head. */
export function headOf(html: string): string {
  // `<head(\s…)?>`, not `<head[^>]*>`: the latter also opens on `<header …>`.
  const match = html.match(/<head(\s[^>]*)?>([\s\S]*?)<\/head>/)
  if (!match?.[2]) throw new Error('served document has no <head>')
  return match[2]
}

/** Everything after `<body…>`, so a head phrase (meta description) can't match the body. */
export function bodyOf(html: string): string {
  const index = html.search(/<body[\s>]/)
  if (index === -1) throw new Error('served document has no <body>')
  return html.slice(index)
}
